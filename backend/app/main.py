from __future__ import annotations

import asyncio
import copy
import ipaddress
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import urlparse

from docx import Document
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.middleware.gzip import GZipMiddleware
from pypdf import PdfReader

from .crewai_engine import available as crewai_available, run_optional_crew
from .data import DEMO_CANDIDATE, DEMO_JOBS
from .documents import build_docx, build_pdf, export_readiness
from .evidence import build_cover_letter, build_interview, build_safe_patches, cover_letter_evidence_ids, extract_evidence_from_resume, score_job, validate_patches
from .schemas import CandidateInput, EventPayload, ManualJobInput, MatchCreate, PublicBoardInput, RunCreate, RunStatus
from .sources import extract_skills, fetch_arbeitnow, fetch_greenhouse, fetch_lever, fetch_remotive, matches_query

app = FastAPI(
    title="HireSwarm API",
    description="Evidence-locked reverse recruiting and simulated interview engine",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
# The Railway image serves exported Next assets through this same FastAPI app.
# Compress substantial text, CSS, and JS responses at the edge-facing origin so
# users on slower mobile connections do not pay the raw static-bundle cost.
# Starlette deliberately leaves event streams uncompressed, preserving live run
# updates and their timely flush behaviour.
app.add_middleware(GZipMiddleware, minimum_size=700, compresslevel=5)

# Railway's production image can package the exported Next.js frontend beside
# this API. Local/API-only operation remains unchanged when the directory is
# absent. Never let an API failure silently turn into a frontend HTML response.
STATIC_DIR = Path(os.getenv("HIRESWARM_STATIC_DIR", "")).resolve() if os.getenv("HIRESWARM_STATIC_DIR") else None


@app.middleware("http")
async def production_response_guards(request: Request, call_next):
    response: Response = await call_next(request)
    path = request.url.path
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        "form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;"
    )
    content_type = response.headers.get("content-type", "")
    # The application shell can render applicant-specific state after hydration;
    # never permit a CDN/browser to reuse it as a long-lived shared response.
    if path == "/" or path.startswith("/api/") or path == "/healthz" or content_type.startswith("text/html"):
        response.headers["Cache-Control"] = "private, no-store, max-age=0, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    elif response.status_code < 400 and (path.startswith("/_next/") or path.endswith((".js", ".css", ".svg", ".png", ".ico", ".woff2"))):
        response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
    elif response.status_code >= 400:
        response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


# Keep discovery payloads useful on mobile without shipping dozens of long
# third-party descriptions into the browser. The server retains the source job
# record for the selected evidence workflow; API list responses are compact.
PUBLIC_RESULT_LIMIT = 12
CLIENT_DESCRIPTION_LIMIT = 4_000

RUNS: dict[str, RunStatus] = {}
# Protect approval's check-and-transition sequence across duplicate clicks,
# browser tabs, and threaded/multi-request test clients.
APPROVAL_LOCK = Lock()
JOBS: dict[str, dict[str, Any]] = {job["id"]: copy.deepcopy(job) for job in DEMO_JOBS}
# Remotive asks clients to poll sparingly. Cache its unfiltered public feed so
# later searches can be correctly filtered without re-fetching or leaking jobs
# from another provider into a source-specific result.
REMOTIVE_CACHE: list[dict[str, Any]] = []
REMOTIVE_CACHE_AT: datetime | None = None
REMOTIVE_CACHE_ERROR: str | None = None
# Remotive publishes one broad feed, so it is safely cached and filtered locally.
LIVE_CACHE_TTL = timedelta(hours=6)
# Other public calls are requested only after an applicant asks for them. Keep
# short, bounded server-side caches so repeated searches/boards do not wait on
# external providers or flood their free APIs.
ARBEITNOW_QUERY_CACHE_TTL = timedelta(minutes=10)
PUBLIC_BOARD_CACHE_TTL = timedelta(minutes=20)
ARBEITNOW_QUERY_CACHE: dict[str, tuple[datetime, list[dict[str, Any]]]] = {}
PUBLIC_BOARD_CACHE: dict[tuple[str, str], tuple[datetime, list[dict[str, Any]]]] = {}
MAX_PUBLIC_CACHE_ENTRIES = 32


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def event(run: RunStatus, type_: str, title: str, message: str | None = None, agent: str | None = None, payload: dict[str, Any] | None = None) -> None:
    run.events.append(EventPayload(type=type_, title=title, message=message, agent=agent, payload=payload or {}, at=now()))


def candidate_as_dict(candidate: CandidateInput | None) -> dict[str, Any]:
    # Only an omitted candidate opts into the explicitly labeled practice profile.
    # Never replace an applicant-supplied (possibly incomplete) profile with demo evidence.
    if candidate is None:
        return copy.deepcopy(DEMO_CANDIDATE)
    return candidate.model_dump()


def normalized_job(job: dict[str, Any]) -> dict[str, Any]:
    """Return a full, display-safe job record only when a user opens a role."""
    response = dict(job)
    response.pop("interview_questions", None)
    origin = response.get("origin")
    response.setdefault("retrieved_at", None)
    response.setdefault("cache_state", "fixture" if origin == "demo_fixture" else "candidate" if origin == "user_pasted" else "fresh")
    description = str(response.get("description", "")).strip()
    if len(description) > CLIENT_DESCRIPTION_LIMIT:
        response["description"] = f"{description[:CLIENT_DESCRIPTION_LIMIT - 1].rstrip()}…"
    response["detail_loaded"] = True
    return response


def job_summary(job: dict[str, Any]) -> dict[str, Any]:
    """Return the tiny list payload used by user-requested live discovery.

    Descriptions are intentionally excluded. The browser asks for the full
    record only after the applicant explicitly reviews a role, keeping public
    discovery fast on slower connections and avoiding a feed's large body in
    every role card.
    """
    origin = job.get("origin")
    skills = list(dict.fromkeys([
        *[str(skill) for skill in job.get("must_have", []) if str(skill).strip()],
        *[str(skill) for skill in job.get("preferred", []) if str(skill).strip()],
    ]))[:8]
    return {
        "id": str(job.get("id", "")),
        "origin": origin,
        "source": str(job.get("source", "Published public listing")),
        "title": str(job.get("title", "Untitled role")),
        "company": str(job.get("company", "Company not disclosed")),
        "location": str(job.get("location", "Location not specified")),
        "type": str(job.get("type", "Not specified")),
        "url": str(job.get("url", "")),
        "skills": skills,
        "posted": str(job.get("posted", "not disclosed")),
        "retrieved_at": job.get("retrieved_at"),
        "cache_state": job.get("cache_state", "fixture" if origin == "demo_fixture" else "candidate" if origin == "user_pasted" else "fresh"),
        "detail_loaded": False,
    }


def checked_application_url(value: str) -> str:
    """Keep manual listing links HTTPS and browser-safe without server-side fetching.

    Manual links are applicant-controlled and are never fetched by HireSwarm,
    which prevents SSRF by design. We additionally reject credentials, local
    hosts, and literal non-public IP addresses before the browser can open one.
    """
    url = value.strip()
    if not url:
        return ""
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if parsed.scheme != "https" or not parsed.netloc or not hostname:
        raise HTTPException(status_code=422, detail="Use a full https:// official listing URL, or leave it blank.")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="Listing URLs cannot contain embedded credentials.")
    if hostname == "localhost" or hostname.endswith(".localhost") or hostname.endswith(".local"):
        raise HTTPException(status_code=422, detail="Listing URLs must use a public HTTPS host, not localhost or a local network host.")
    try:
        address = ipaddress.ip_address(hostname)
        if not address.is_global:
            raise HTTPException(status_code=422, detail="Listing URLs must use a public HTTPS host, not a private or loopback address.")
    except ValueError:
        # A DNS name is not resolved or fetched by this service. The final URL
        # remains a user-controlled browser navigation only.
        pass
    return url


def required_manual_text(value: str, field: str, minimum: int = 2) -> str:
    cleaned = value.strip()
    if len(cleaned) < minimum:
        raise HTTPException(status_code=422, detail=f"{field} needs at least {minimum} non-space characters.")
    return cleaned


def required_live_query(value: str) -> str:
    query = value.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="Enter at least 2 characters to search published roles.")
    if len(query) > 120:
        raise HTTPException(status_code=422, detail="Keep a live-role query to 120 characters or fewer.")
    return query


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False, response_model=None)
async def root() -> Response | dict[str, str]:
    """Serve the bundled app in Railway, otherwise keep API-only health simple."""
    index = STATIC_DIR / "index.html" if STATIC_DIR else None
    if index and index.is_file():
        return FileResponse(index, media_type="text/html")
    return {"service": "HireSwarm API", "mode": "evidence_lab"}


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "HireSwarm application workspace",
        "mode": "deterministic evidence engine",
        # This reports usable provider-backed CrewAI, not merely an opt-in flag.
        "optional_crewai": crewai_available(),
        "time": now(),
    }


@app.get("/api/candidate/demo")
async def demo_candidate() -> dict[str, Any]:
    return copy.deepcopy(DEMO_CANDIDATE)


@app.post("/api/candidate/normalize")
async def normalize_candidate(payload: CandidateInput) -> dict[str, Any]:
    candidate = payload.model_dump()
    resume_text = str(candidate.get("resume_text", "")).strip()
    if not resume_text:
        raise HTTPException(status_code=422, detail="Add resume text before refreshing the evidence ledger.")
    # A refresh must never retain stale proof from an older resume. Empty or
    # non-evidentiary text is not represented as a successful normalization.
    evidence = extract_evidence_from_resume(resume_text)
    if not evidence:
        raise HTTPException(status_code=422, detail="No reviewable evidence was found in that resume text. Add literal work, project, or outcome statements and try again.")
    candidate["evidence"] = evidence
    return candidate


MAX_UPLOAD_BYTES = 6 * 1024 * 1024


_LOCATION_LABEL = re.compile(r"^(?:location|based\s+in|based)\s*[:\-]?\s*(?P<value>.+)$", re.I)
_PAKISTAN_CITY_LOCATION = re.compile(r"^(?P<value>[A-Za-z][A-Za-z .'-]{1,70},\s*Pakistan)\b", re.I)


def _location_from_resume_lines(lines: list[str]) -> str:
    """Read an explicit, human-written location without guessing from a name.

    The parser intentionally limits itself to common CV forms rather than using
    geocoding or inference: ``Rawalpindi, Pakistan``, ``Location: Rawalpindi``,
    and ``Based in: Rawalpindi`` are all literal applicant text.
    """
    for raw_line in lines[:16]:
        line = re.sub(r"^[\s•\-–—]+", "", raw_line).strip()
        if not line:
            continue
        labelled = _LOCATION_LABEL.match(line)
        if labelled:
            value = re.split(r"\s*(?:\||•|·)\s*", labelled.group("value"), maxsplit=1)[0].strip(" ,;-")
            if 2 <= len(value) <= 90:
                return value
        pakistan_city = _PAKISTAN_CITY_LOCATION.match(line)
        if pakistan_city:
            return pakistan_city.group("value").strip()
    return "Location not specified"


def _candidate_from_text(text: str, filename: str) -> CandidateInput:
    clean_lines = [line.strip() for line in text.replace("\r", "").split("\n") if line.strip()]
    if len(text.strip()) < 80:
        raise ValueError("We could not extract enough readable text. If this is a scanned PDF, upload a text-based PDF, DOCX, or TXT file instead.")
    first = clean_lines[0] if clean_lines else "Imported applicant"
    # Resumes conventionally start with a name; avoid treating a long section heading as one.
    name = first[:90] if 1 < len(first.split()) <= 6 and len(first) < 70 else "Imported applicant"
    headline = clean_lines[1][:140] if len(clean_lines) > 1 and len(clean_lines[1]) < 160 else "Your profile"
    evidence = extract_evidence_from_resume(text)
    if not evidence:
        raise ValueError("Readable text was found, but no reviewable experience statements could be safely extracted. You can paste and edit the text instead.")
    return CandidateInput(
        name=name,
        headline=headline,
        location=_location_from_resume_lines(clean_lines),
        preferences=["Imported CV"],
        resume_text=text[:50000],
        evidence=evidence,
    )


@app.post("/api/candidate/upload")
async def upload_candidate_cv(file: UploadFile = File(...)) -> dict[str, Any]:
    """Parse a local applicant document in-memory. The original binary is not retained."""
    filename = file.filename or "candidate-document"
    extension = Path(filename).suffix.lower()
    if extension not in {".pdf", ".docx", ".txt"}:
        raise HTTPException(status_code=415, detail="Upload a .pdf, .docx, or .txt resume.")
    blob = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(blob) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Keep the resume under 6 MB. The file is processed only for this session.")
    try:
        if extension == ".pdf":
            text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(blob)).pages)
        elif extension == ".docx":
            text = "\n".join(paragraph.text for paragraph in Document(BytesIO(blob)).paragraphs)
        else:
            text = blob.decode("utf-8", errors="replace")
        candidate = _candidate_from_text(text, filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail="We could not read that document. Try a text-based PDF, DOCX, or TXT version.") from exc
    return {
        "candidate": candidate.model_dump(),
        "import": {
            "filename": filename,
            "format": extension.lstrip("."),
            "characters_read": len(text),
            "evidence_count": len(candidate.evidence),
            "retention": "The source file is parsed in memory and is not stored by HireSwarm.",
        },
    }


@app.get("/api/jobs")
async def list_jobs(mode: str = "demo", query: str = "") -> dict[str, Any]:
    """Return visibly-labelled fixtures or a bounded, user-requested public result."""
    if mode != "live":
        return {
            "mode": "demo_fixture",
            "jobs": [normalized_job(job) for job in JOBS.values() if job.get("origin") == "demo_fixture"],
            "provenance": {"label": "Demo roles", "retrieved_at": None, "cache_state": "fixture"},
        }
    return await public_jobs(query=required_live_query(query))


async def _remotive_results(query: str, limit: int = PUBLIC_RESULT_LIMIT) -> tuple[list[dict[str, Any]], str, list[str]]:
    """Return query-filtered Remotive jobs from a cache of the raw public feed."""
    global REMOTIVE_CACHE_AT, REMOTIVE_CACHE_ERROR
    cache_valid = bool(REMOTIVE_CACHE and REMOTIVE_CACHE_AT and datetime.now(timezone.utc) - REMOTIVE_CACHE_AT < LIVE_CACHE_TTL)
    if not cache_valid:
        try:
            # Fetch the source once without a search restriction; every later
            # query is evaluated locally against this same complete cache.
            fresh = await fetch_remotive(query="", limit=50)
            retrieved_at = now()
            for job in fresh:
                job["retrieved_at"] = retrieved_at
                job["cache_state"] = "fresh"
            REMOTIVE_CACHE[:] = fresh
            REMOTIVE_CACHE_AT = datetime.now(timezone.utc)
            REMOTIVE_CACHE_ERROR = None
        except Exception:
            REMOTIVE_CACHE_ERROR = "Remotive is temporarily unavailable. No simulated listing was substituted."
            return [], "unavailable", [REMOTIVE_CACHE_ERROR]

    cache_state = "cached" if cache_valid else "fresh"
    filtered = [dict(job, cache_state=cache_state) for job in REMOTIVE_CACHE if matches_query(job, query)]
    errors = [REMOTIVE_CACHE_ERROR] if REMOTIVE_CACHE_ERROR else []
    return filtered[:limit], cache_state, errors


def _prune_timed_cache(cache: dict[Any, tuple[datetime, list[dict[str, Any]]]], ttl: timedelta) -> None:
    """Bound volatile public-source caches even under many distinct searches."""
    current = datetime.now(timezone.utc)
    for key, (cached_at, _value) in list(cache.items()):
        if current - cached_at >= ttl:
            cache.pop(key, None)
    while len(cache) > MAX_PUBLIC_CACHE_ENTRIES:
        oldest = min(cache, key=lambda item: cache[item][0])
        cache.pop(oldest, None)


async def _arbeitnow_results(query: str, limit: int = PUBLIC_RESULT_LIMIT) -> tuple[list[dict[str, Any]], str, list[str]]:
    cache_key = query.casefold().strip()
    _prune_timed_cache(ARBEITNOW_QUERY_CACHE, ARBEITNOW_QUERY_CACHE_TTL)
    cached = ARBEITNOW_QUERY_CACHE.get(cache_key)
    if cached:
        jobs = [dict(job, cache_state="cached") for job in cached[1]]
        return jobs[:limit], "cached", []
    try:
        jobs = await fetch_arbeitnow(query=query, limit=limit)
        retrieved_at = now()
        stored = [dict(job, retrieved_at=retrieved_at, cache_state="fresh") for job in jobs]
        ARBEITNOW_QUERY_CACHE[cache_key] = (datetime.now(timezone.utc), stored)
        _prune_timed_cache(ARBEITNOW_QUERY_CACHE, ARBEITNOW_QUERY_CACHE_TTL)
        return stored[:limit], "fresh", []
    except Exception:
        return [], "unavailable", ["Arbeitnow is temporarily unavailable. You can still paste a role or connect a public company board."]


async def public_jobs(query: str = "", source: str = "all") -> dict[str, Any]:
    """Fetch user-requested public roles concurrently and return list summaries."""
    providers = []
    if source in {"all", "remotive"}:
        providers.append(_remotive_results(query))
    if source in {"all", "arbeitnow"}:
        providers.append(_arbeitnow_results(query))

    # Isolate each provider: a timeout or unexpected source adapter failure
    # must not discard results that the other public feed already returned.
    results = await asyncio.gather(*providers, return_exceptions=True) if providers else []
    jobs: list[dict[str, Any]] = []
    errors: list[str] = []
    cache_states: list[str] = []
    for result in results:
        if isinstance(result, Exception):
            cache_states.append("unavailable")
            errors.append("One public job source is temporarily unavailable. You can still use the available listings or paste a role.")
            continue
        provider_jobs, state, provider_errors = result
        jobs.extend(provider_jobs)
        cache_states.append(state)
        errors.extend(provider_errors)

    deduped = list({job["id"]: job for job in jobs}.values())[:PUBLIC_RESULT_LIMIT]
    # Keep the complete source record in volatile server memory for the explicit
    # detail request and evidence run. Only job_summary leaves this endpoint.
    JOBS.update({job["id"]: job for job in deduped})
    available_states = {state for state in cache_states if state != "unavailable"}
    cache_state = "mixed" if len(available_states) > 1 else next(iter(available_states), "unavailable")
    retrieved_values = [job.get("retrieved_at") for job in deduped if job.get("retrieved_at")]
    return {
        "mode": "live_public" if deduped else "live_unavailable",
        "jobs": [job_summary(job) for job in deduped],
        "provenance": {
            "label": "Published public job feeds",
            "retrieved_at": max(retrieved_values) if retrieved_values else None,
            "cache_state": cache_state,
            "polling_policy": "Remotive is cached for six hours. Arbeitnow query results are cached for ten minutes. HireSwarm never submits an application.",
        },
        "source_errors": errors,
    }


@app.get("/api/jobs/live")
async def list_live_jobs(query: str = "", source: str = "all") -> dict[str, Any]:
    if source not in {"all", "remotive", "arbeitnow"}:
        raise HTTPException(status_code=422, detail="Use all, remotive, or arbeitnow for public feed discovery.")
    return await public_jobs(query=required_live_query(query), source=source)


@app.get("/api/jobs/{job_id}")
async def get_job_detail(job_id: str) -> dict[str, Any]:
    """Return full role text only after an applicant explicitly opens a role."""
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(
            status_code=404,
            detail="That role is no longer available in this session. Search again or paste the role description.",
        )
    return normalized_job(job)


async def _public_board_results(source: str, board: str) -> tuple[list[dict[str, Any]], str]:
    cache_key = (source, board.casefold().strip())
    _prune_timed_cache(PUBLIC_BOARD_CACHE, PUBLIC_BOARD_CACHE_TTL)
    cached = PUBLIC_BOARD_CACHE.get(cache_key)
    if cached:
        return [dict(job, cache_state="cached") for job in cached[1]], "cached"
    jobs = await (fetch_greenhouse(board, limit=PUBLIC_RESULT_LIMIT) if source == "greenhouse" else fetch_lever(board, limit=PUBLIC_RESULT_LIMIT))
    retrieved_at = now()
    stored = [dict(job, retrieved_at=retrieved_at, cache_state="fresh") for job in jobs]
    PUBLIC_BOARD_CACHE[cache_key] = (datetime.now(timezone.utc), stored)
    _prune_timed_cache(PUBLIC_BOARD_CACHE, PUBLIC_BOARD_CACHE_TTL)
    return stored, "fresh"


@app.post("/api/jobs/public-board")
async def import_public_board(payload: PublicBoardInput) -> dict[str, Any]:
    """Read a user-selected public board only after request, with a bounded cache."""
    try:
        jobs, cache_state = await _public_board_results(payload.source, payload.board)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="That public board could not be reached. Check the public board URL or paste the job description instead.") from exc
    if not jobs:
        raise HTTPException(status_code=404, detail="No published roles were found on that public board.")
    JOBS.update({job["id"]: job for job in jobs})
    retrieved_values = [job.get("retrieved_at") for job in jobs if job.get("retrieved_at")]
    return {
        "mode": "live_public_board",
        "jobs": [job_summary(job) for job in jobs],
        "provenance": {
            "label": f"Official {payload.source.title()} public board",
            "retrieved_at": max(retrieved_values) if retrieved_values else None,
            "cache_state": cache_state,
            "board": payload.board,
            "polling_policy": "This public board is cached for twenty minutes after you request it. HireSwarm only reads listings.",
        },
    }


@app.post("/api/jobs/manual")
async def manual_job(payload: ManualJobInput) -> dict[str, Any]:
    """Create an applicant-controlled target from pasted role text.

    We infer only controlled taxonomy terms, then label generic fallbacks rather
    than pretending an unknown phrase is a verified technical requirement.
    """
    title = required_manual_text(payload.title, "Role title")
    company = required_manual_text(payload.company, "Company")
    official_url = checked_application_url(payload.url)
    description = required_manual_text(payload.description, "Role description", minimum=20)
    location = payload.location.strip() or "Not specified"
    required = extract_skills(description, limit=12)
    if not required:
        required = ["Communication", "Relevant project experience"]
    job_id = f"manual-{uuid.uuid4().hex[:8]}"
    job = {
        "id": job_id,
        "origin": "user_pasted",
        "source": "User-pasted description",
        "title": title,
        "company": company,
        "location": location,
        "type": "Not specified",
        "salary": "Not disclosed",
        "posted": "Just added",
        "retrieved_at": now(),
        "cache_state": "candidate",
        "url": official_url,
        "description": description,
        "must_have": required[:5],
        "preferred": required[5:],
        "interview_questions": [],
    }
    JOBS[job_id] = job
    return normalized_job(job)


async def execute_mission(run: RunStatus, job: dict[str, Any], candidate: dict[str, Any], mode: str) -> None:
    """Run optional provider-backed CrewAI enrichment, then the authoritative evidence flow."""
    if mode == "crewai":
        if crewai_available():
            event(run, "agent_active", "CrewAI relay connected", "A free-provider CrewAI narrative pass is running before evidence validation.", "Mission Conductor", {"phase": "crewai_enrichment"})
            try:
                narrative = await asyncio.to_thread(run_optional_crew, job, candidate)
                event(run, "crewai_enrichment", "CrewAI relay returned", "Provider narrative is available; deterministic evidence rules remain authoritative.", "Mission Conductor", {"provider": narrative.get("provider", "configured provider")})
            except Exception as exc:
                event(run, "crewai_fallback", "Guided review unavailable", f"Continuing with standard evidence checks: {str(exc)[:120]}", "Application guide")
        else:
            event(run, "crewai_fallback", "Guided review is not enabled", "Continuing with standard evidence checks. Your work examples and approval safeguards stay the same.", "Application guide")
    await execute_evidence_lab(run, job, candidate)


async def execute_evidence_lab(run: RunStatus, job: dict[str, Any], candidate: dict[str, Any]) -> None:
    try:
        run.status = "running"
        event(run, "run_started", "Fit check started", "Matching your work examples with this job’s requirements.", "Application guide")
        await asyncio.sleep(0.55)

        event(run, "agent_active", "Market Scout scanning", "Extracting must-have skills and checking source-linked evidence.", "Market Scout", {"phase": "mapping"})
        await asyncio.sleep(0.85)
        match = score_job(job, candidate)
        event(run, "market_report", "Opportunity map generated", f"{job['title']} scored {match['score']}% evidence fit.", "Market Scout", {
            "job_id": job["id"],
            "score": match["score"],
            "coverage": match["coverage"],
            "verified_strengths": match["verified_strengths"],
            "adjacent_strengths": match["adjacent_strengths"],
            "gaps": match["gaps"],
        })
        await asyncio.sleep(0.55)

        event(run, "agent_active", "Candidate Twin assembling", "Binding answers to the evidence ledger. Unsupported claims will be blocked.", "Candidate Twin", {"phase": "evidence_binding"})
        await asyncio.sleep(0.8)
        evidence_count = len(candidate.get("evidence", []))
        event(run, "candidate_twin_ready", "Digital Twin verified", f"{evidence_count} evidence nodes are available for interview responses.", "Candidate Twin", {
            "name": candidate.get("name", "Candidate"),
            "headline": candidate.get("headline", ""),
            "evidence_count": evidence_count,
        })
        await asyncio.sleep(0.55)

        interview = build_interview(job, candidate, match)
        verdicts = []
        for index, turn in enumerate(interview[:4], start=1):
            event(run, "agent_active", f"HR round {index} of {min(4, len(interview))}", f"Testing {turn['requirement']} against verified evidence.", "HR Interrogator", {"round": index})
            await asyncio.sleep(0.45)
            event(run, "interview_question", f"Question {index}: {turn['requirement']}", turn["question"], "HR Interrogator", {
                "round": index,
                "requirement": turn["requirement"],
                "question": turn["question"],
            })
            await asyncio.sleep(0.75)
            event(run, "candidate_answer", turn["status"], turn["answer"], "Candidate Twin", {
                "round": index,
                "status": turn["status"],
                "answer": turn["answer"],
                "evidence_ids": turn.get("evidence_ids", []),
            })
            await asyncio.sleep(0.55)
            event_type = "gap_detected" if turn["status"] != "SUPPORTED" else "interview_verdict"
            event(run, event_type, "Evidence verdict", turn["verdict"], "HR Interrogator", {
                "round": index,
                "requirement": turn["requirement"],
                "status": turn["status"],
                "evidence_ids": turn.get("evidence_ids", []),
                "verdict": turn["verdict"],
            })
            verdicts.append(turn)
            await asyncio.sleep(0.45)

        event(run, "agent_active", "Resume Surgeon preparing patch", "Converting verified evidence into job-relevant document edits.", "Resume Surgeon", {"phase": "patching"})
        await asyncio.sleep(0.75)
        patches = build_safe_patches(job, candidate, match)
        validation = validate_patches(patches, candidate)
        # Tailoring improves clarity, not the amount of direct evidence. Keep the metric honest.
        coverage_after = match["coverage"]
        cover_letter = build_cover_letter(job, candidate, match)
        cover_letter_ids = cover_letter_evidence_ids(job, candidate, match)
        safe_patches = validation["safe_patches"]
        patch_title = "Truth-preserving edits ready" if safe_patches else "No safe role-specific edits"
        patch_message = (
            f"{len(safe_patches)} evidence-linked edits are ready for human review. Evidence coverage is unchanged by rewriting."
            if safe_patches
            else "No source-linked sentence directly supports this target yet. HireSwarm will keep the gap visible instead of exporting a generic packet."
        )
        event(run, "resume_patch", patch_title, patch_message, "Resume Surgeon", {
            "patches": safe_patches,
            "cover_letter": cover_letter,
            "cover_letter_evidence_ids": cover_letter_ids,
            "coverage_before": match["coverage"],
            "coverage_after": coverage_after,
            "unresolved_gaps": [item["skill"] for item in match["gaps"] if item.get("severity") in {"must_have", "preferred"}],
        })
        await asyncio.sleep(0.65)
        blocked_count = len(validation["blocked_patches"])
        event(run, "validation_result", "Evidence firewall passed", "Every proposed sentence has source-linked evidence." if not blocked_count else f"{blocked_count} unsupported edits were blocked.", "Evidence Validator", {
            "all_claims_linked": validation["all_claims_linked"],
            "safe_count": len(validation["safe_patches"]),
            "blocked_count": blocked_count,
        })
        await asyncio.sleep(0.5)
        if not safe_patches:
            run.result = {
                "job": normalized_job(job),
                "candidate": {k: candidate.get(k) for k in ["name", "headline", "location"]},
                "candidate_full": candidate,
                "match": match,
                "interview": verdicts,
                "patches": [],
                "cover_letter": cover_letter,
                "cover_letter_evidence_ids": cover_letter_ids,
                "coverage_before": match["coverage"],
                "coverage_after": coverage_after,
            }
            run.status = "needs_evidence"
            event(run, "evidence_needed", "More direct evidence is needed", "No safe, role-specific document revision was found. Add a literal project/experience statement or select a better-matched role before export.", "Evidence Validator", {
                "gaps": [item["skill"] for item in match["gaps"]],
                "coverage": match["coverage"],
            })
            return
        run.result = {
            "job": normalized_job(job),
            "candidate": {k: candidate.get(k) for k in ["name", "headline", "location"]},
            # Kept in volatile run memory only so an approved export can render a real document.
            "candidate_full": candidate,
            "match": match,
            "interview": verdicts,
            "patches": validation["safe_patches"],
            "cover_letter": cover_letter,
            "cover_letter_evidence_ids": cover_letter_ids,
            "coverage_before": match["coverage"],
            "coverage_after": coverage_after,
        }
        readiness = refresh_export_readiness(run)
        event(run, "export_readiness", "Export readiness checked", "A generated one-column PDF was text-extracted to verify the document can be read back.", "Document QA", readiness)
        if not readiness["passed"]:
            run.status = "failed"
            event(run, "run_failed", "Document QA blocked release", "The draft did not satisfy the server-side export checks, so approval and export remain locked.", "Evidence Validator", readiness)
            return
        run.status = "awaiting_approval"
        event(run, "approval_required", "Human approval required", "Review evidence tags, accept the truthful patch, then export the application packet.", "HITL Release Custodian", {
            "safe_patches": len(validation["safe_patches"]),
            "unresolved_gaps": [item["skill"] for item in match["gaps"]],
        })
    except Exception as exc:
        run.status = "failed"
        event(run, "run_failed", "Mission paused", str(exc), "Mission Conductor")


def packet_integrity_check(result: dict[str, Any]) -> dict[str, Any]:
    """Ensure every released revision still maps to a verified ledger node."""
    patches = result.get("patches") or []
    candidate = result.get("candidate_full")
    if not isinstance(candidate, dict):
        return {
            "label": "Server-side evidence integrity",
            "passed": False,
            "detail": "The full candidate evidence ledger is missing, so this packet cannot be approved.",
        }
    validation = validate_patches(patches, candidate)
    intact = bool(patches) and len(validation["safe_patches"]) == len(patches)
    return {
        "label": "Server-side evidence integrity",
        "passed": intact,
        "detail": "Every export revision still maps to a verified candidate evidence ID." if intact else "One or more revisions are missing verified evidence links, so release is blocked.",
    }


def refresh_export_readiness(run: RunStatus) -> dict[str, Any]:
    """Recompute QA from the packet; never trust an old client-visible flag."""
    try:
        readiness = export_readiness(run.result)
    except Exception as exc:
        readiness = {
            "passed": False,
            "checks": [{"label": "Document generation", "passed": False, "detail": f"QA could not render this packet: {str(exc)[:160]}"}],
            "extracted_characters": 0,
            "verified_bullets": 0,
        }
    integrity = packet_integrity_check(run.result)
    readiness["checks"].append(integrity)
    readiness["passed"] = bool(readiness.get("passed") and integrity["passed"])
    run.result["export_readiness"] = readiness
    return readiness


@app.post("/api/match")
async def preview_match(payload: MatchCreate) -> dict[str, Any]:
    """Return an immediate, deterministic fit summary without creating a run.

    This lets an applicant understand the match before deciding to invest in
    revisions, interview practice, or an approval-gated export. The endpoint
    mutates neither the role registry nor a candidate record; it only maps the
    supplied source-linked evidence to the selected job's requirements.
    """
    job = JOBS.get(payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    candidate = candidate_as_dict(payload.candidate)
    if not str(candidate.get("name", "")).strip():
        raise HTTPException(status_code=422, detail="Add your name before checking a job match.")
    evidence = candidate.get("evidence") or []
    if not evidence:
        raise HTTPException(status_code=422, detail="Add or refresh at least one source-linked resume statement before checking this job match.")
    if not any(item.get("status", "verified") == "verified" for item in evidence):
        raise HTTPException(status_code=422, detail="Confirm at least one verified source statement before checking this job match.")
    match = score_job(job, candidate)
    # Keep this first-look response intentionally compact. The internal skill
    # index is needed by the deeper run but is not useful in the applicant's
    # initial decision and should not be needlessly returned to the browser.
    return {key: match[key] for key in ("score", "coverage", "verified_strengths", "adjacent_strengths", "gaps")}


@app.post("/api/runs")
async def create_run(payload: RunCreate) -> dict[str, Any]:
    job = JOBS.get(payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    candidate = candidate_as_dict(payload.candidate)
    if not str(candidate.get("name", "")).strip():
        raise HTTPException(status_code=422, detail="Add your name before creating an application packet.")
    if not candidate.get("evidence"):
        raise HTTPException(
            status_code=422,
            detail="Add or refresh at least one source-linked resume statement before starting a rehearsal. HireSwarm will not create an application packet from an empty evidence ledger.",
        )
    if not any(item.get("status", "verified") == "verified" for item in candidate["evidence"]):
        raise HTTPException(status_code=422, detail="Confirm at least one verified source statement before starting a rehearsal.")
    run_id = f"run-{uuid.uuid4().hex[:10]}"
    run = RunStatus(id=run_id, status="queued", selected_job_id=job["id"], mode=payload.mode)
    RUNS[run_id] = run
    asyncio.create_task(execute_mission(run, copy.deepcopy(job), candidate, payload.mode))
    return {"run_id": run_id, "status": run.status}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    """Return a compact run checkpoint so a refreshed browser can resume SSE."""
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    selected_job = JOBS.get(run.selected_job_id)
    return {
        "id": run.id,
        "status": run.status,
        "selected_job_id": run.selected_job_id,
        "mode": run.mode,
        "event_count": len(run.events),
        # A refreshed client needs the target label, but list-safe normalization
        # avoids replaying unbounded third-party descriptions into the browser.
        "job": normalized_job(selected_job) if selected_job else None,
    }

@app.get("/api/runs/{run_id}/events")
async def stream_run_events(run_id: str):
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    async def generator():
        index = 0
        while True:
            active = RUNS.get(run_id)
            if not active:
                break
            while index < len(active.events):
                payload = active.events[index].model_dump()
                index += 1
                yield f"data: {json.dumps(payload)}\n\n"
            if active.status in {"needs_evidence", "awaiting_approval", "approved", "failed", "completed"} and index >= len(active.events):
                yield f"event: done\ndata: {json.dumps({'status': active.status})}\n\n"
                break
            await asyncio.sleep(0.25)

    return StreamingResponse(generator(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })


@app.post("/api/runs/{run_id}/approve")
async def approve_run(run_id: str) -> dict[str, Any]:
    # This check-and-transition deliberately contains no await points. The lock
    # also protects it when two HTTP clients arrive in different worker threads.
    with APPROVAL_LOCK:
        run = RUNS.get(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        # Approval is idempotent: a double-click or a second tab receives the
        # already-approved packet without creating another approval event.
        if run.status == "approved":
            return {"ok": True, "status": run.status, "result": run.result, "already_approved": True}
        if run.status != "awaiting_approval":
            raise HTTPException(status_code=409, detail="Run is not ready for approval")
        readiness = refresh_export_readiness(run)
        if not readiness.get("passed"):
            raise HTTPException(status_code=409, detail="Document QA has not passed, so this packet cannot be approved or exported.")
        run.status = "approved"
        event(run, "approved", "Application packet approved", "Document export is unlocked. The official application link remains user-controlled.", "HITL Release Custodian")
        return {"ok": True, "status": run.status, "result": run.result}


@app.get("/api/runs/{run_id}/export-readiness")
async def get_export_readiness(run_id: str) -> dict[str, Any]:
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if not run.result:
        raise HTTPException(status_code=409, detail="Finish the evidence rehearsal before checking export readiness.")
    return refresh_export_readiness(run)


@app.get("/api/runs/{run_id}/export/{format}")
async def export_application_packet(run_id: str, format: str):
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status != "approved":
        raise HTTPException(status_code=409, detail="Applicant approval is required before any export.")
    if not refresh_export_readiness(run).get("passed"):
        raise HTTPException(status_code=409, detail="Document QA no longer passes; return to review before exporting.")
    if format == "docx":
        content = build_docx(run.result)
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        filename = "HireSwarm_Approved_Application.docx"
    elif format == "pdf":
        content = build_pdf(run.result)
        media_type = "application/pdf"
        filename = "HireSwarm_Approved_Application.pdf"
    else:
        raise HTTPException(status_code=404, detail="Use docx or pdf for an ATS-conscious application export.")
    return StreamingResponse(BytesIO(content), media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.api_route("/{asset_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_frontend_or_json_404(asset_path: str) -> Response:
    """Serve exported frontend assets without converting missing API routes to HTML."""
    if asset_path.startswith("api/") or asset_path.startswith("healthz"):
        return JSONResponse(status_code=404, content={"detail": "Route not found"})
    if not STATIC_DIR or not STATIC_DIR.is_dir():
        return JSONResponse(status_code=404, content={"detail": "Route not found"})

    requested = (STATIC_DIR / asset_path).resolve()
    # Reject traversal before looking at the static tree.
    try:
        requested.relative_to(STATIC_DIR)
    except ValueError:
        return JSONResponse(status_code=404, content={"detail": "Route not found"})

    if requested.is_file():
        return FileResponse(requested)
    directory_index = requested / "index.html"
    if directory_index.is_file():
        return FileResponse(directory_index, media_type="text/html")

    # `next export` writes App Router pages as `workspace.html` rather than
    # `workspace/index.html`. Prefer that route-specific static document so a
    # deep link hydrates against matching initial markup instead of the root.
    route_name = asset_path.rstrip("/")
    route_export = (STATIC_DIR / f"{route_name}.html").resolve() if route_name else None
    if route_export and route_export.is_file():
        try:
            route_export.relative_to(STATIC_DIR)
            return FileResponse(route_export, media_type="text/html")
        except ValueError:
            return JSONResponse(status_code=404, content={"detail": "Route not found"})

    # API/asset misses are JSON. Unknown browser routes receive the exported
    # Next not-found document with a real 404 status — never the workspace shell.
    if Path(asset_path).suffix:
        return JSONResponse(status_code=404, content={"detail": "Asset not found"})
    not_found = STATIC_DIR / "404.html"
    if not_found.is_file():
        return FileResponse(not_found, media_type="text/html", status_code=404)
    return JSONResponse(status_code=404, content={"detail": "Route not found"})
