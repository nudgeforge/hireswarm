"""Public, terms-aligned job-source connectors.

HireSwarm deliberately reads only published public feeds and never submits an
application or crawls login-protected job boards. Each normalized job retains
its source URL and provenance for the user interface.
"""
from __future__ import annotations

import asyncio
import html
import ipaddress
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlparse
from typing import Any

import httpx

from .data import SKILL_ALIASES, has_alias

USER_AGENT = "HireSwarm/1.0 (applicant-controlled job discovery; public feed reader)"
TIMEOUT = httpx.Timeout(10.0, connect=5.0)
# Published boards should be compact JSON feeds. Refuse unexpectedly large bodies
# rather than loading an unbounded response into worker memory. Arbeitnow's
# official complete public feed is presently about 2.8 MB, so the former 2 MB
# ceiling incorrectly marked a normal, user-requested lookup as unavailable.
# Four MB remains a strict bounded read while allowing that documented source.
MAX_PUBLIC_RESPONSE_BYTES = 4_000_000
MAX_PUBLIC_RESULTS = 12
# A small internal Remotive cache can support a later query without exposing a
# large response. Route handlers still request at most MAX_PUBLIC_RESULTS.
MAX_SOURCE_RESULTS = 50
MAX_ATS_DETAIL_CONCURRENCY = 4


def bounded_source_limit(value: int) -> int:
    return max(1, min(int(value), MAX_SOURCE_RESULTS))


def bounded_public_limit(value: int) -> int:
    return max(1, min(int(value), MAX_PUBLIC_RESULTS))


async def fetch_public_json(
    url: str, *, headers: dict[str, str] | None = None, transport: httpx.AsyncBaseTransport | None = None,
) -> Any:
    """Read a bounded JSON response from a fixed, documented provider endpoint.

    Callers construct ``url`` from hard-coded provider hosts and a strict board
    token. Redirects are deliberately disabled: an ATS cannot turn this reader
    into a request to an arbitrary host.
    """
    request_headers = {"User-Agent": USER_AGENT, **(headers or {})}
    async with httpx.AsyncClient(timeout=TIMEOUT, headers=request_headers, follow_redirects=False, transport=transport) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").lower()
            if content_type and "json" not in content_type:
                raise ValueError("The published board returned a non-JSON response.")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_PUBLIC_RESPONSE_BYTES:
                    raise ValueError("The published board response was too large to process safely.")
    try:
        return json.loads(body)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError("The published board returned invalid JSON.") from error


class _HTMLText(HTMLParser):
    """Convert provider description HTML to inert, readable text only."""
    _IGNORED_TAGS = {"script", "style", "noscript", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in self._IGNORED_TAGS:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self._IGNORED_TAGS and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)


def clean_text(value: str | None) -> str:
    parser = _HTMLText()
    parser.feed(value or "")
    text = html.unescape(" ".join(parser.parts))
    return re.sub(r"\s+", " ", text).strip()


def safe_http_url(value: str | None) -> str:
    """Keep only public HTTPS links before offering an external browser action."""
    url = str(value or "").strip()
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if parsed.scheme != "https" or not parsed.netloc or not hostname or parsed.username or parsed.password:
        return ""
    if hostname == "localhost" or hostname.endswith(".localhost") or hostname.endswith(".local"):
        return ""
    try:
        if not ipaddress.ip_address(hostname).is_global:
            return ""
    except ValueError:
        # We never resolve these externally supplied browser links server-side.
        pass
    return url


def extract_skills(text: str, limit: int = 8) -> list[str]:
    haystack = text.lower()
    skills: list[str] = []
    display = {
        "python": "Python", "fastapi": "FastAPI", "rest apis": "REST APIs",
        "postgresql": "PostgreSQL", "sql": "SQL", "docker": "Docker",
        "kubernetes": "Kubernetes", "terraform": "Terraform", "airflow": "Airflow",
        "react": "React", "typescript": "TypeScript", "javascript": "JavaScript",
        "node.js": "Node.js", "html": "HTML", "css": "CSS", "git": "Git",
        "llm applications": "LLM applications", "ci/cd": "CI/CD", "testing": "Testing",
        "design systems": "Design systems", "product analytics": "Product analytics",
    }
    for key, aliases in SKILL_ALIASES.items():
        if any(has_alias(haystack, alias) for alias in aliases):
            skills.append(display.get(key, key.title()))
    return skills[:limit]


def normalized_job(
    *,
    job_id: str,
    source: str,
    title: str,
    company: str,
    location: str,
    url: str,
    description: str,
    job_type: str = "Not specified",
    posted: str = "Live public listing",
    salary: str = "Not disclosed",
    origin: str = "public_cache",
) -> dict[str, Any]:
    text = clean_text(description)
    skills = extract_skills(f"{title} {text}")
    must_have = skills[:5] or ["Relevant project evidence"]
    preferred = skills[5:8]
    return {
        "id": job_id,
        "origin": origin,
        "source": source,
        "title": title.strip() or "Untitled role",
        "company": company.strip() or "Unknown company",
        "location": location.strip() or "Not specified",
        "type": job_type or "Not specified",
        "salary": salary or "Not disclosed",
        "posted": display_posted(posted),
        "url": safe_http_url(url),
        "description": text[:12000],
        "must_have": must_have,
        "preferred": preferred,
        "interview_questions": [],
    }


def display_posted(value: Any) -> str:
    """Render the public feed's timestamp without exposing raw epoch milliseconds."""
    if value is None or value == "":
        return "Live public listing"
    try:
        numeric = float(value)
        # Lever/Arbeitnow can provide epoch ms; older feeds sometimes use seconds.
        if numeric > 10_000_000_000:
            numeric /= 1000
        if numeric > 900_000_000:
            return datetime.fromtimestamp(numeric, tz=timezone.utc).date().isoformat()
    except (TypeError, ValueError, OSError):
        pass
    return str(value)


def matches_query(job: dict[str, Any], query: str) -> bool:
    if not query.strip():
        return True
    words = [word for word in re.findall(r"[a-zA-Z0-9+#.-]+", query.lower()) if len(word) > 1]
    text = " ".join([job.get("title", ""), job.get("company", ""), job.get("description", ""), " ".join(job.get("must_have", []))]).lower()
    return all(word in text for word in words)


async def fetch_remotive(query: str = "", limit: int = MAX_PUBLIC_RESULTS) -> list[dict[str, Any]]:
    # Official public feed; callers must cache and avoid aggressive polling.
    limit = bounded_source_limit(limit)
    payload = await fetch_public_json("https://remotive.com/api/remote-jobs?limit=50")
    jobs = []
    raw_jobs = payload.get("jobs", []) if isinstance(payload, dict) else []
    for item in raw_jobs:
        if not isinstance(item, dict):
            continue
        description = item.get("description", "")
        job = normalized_job(
            job_id=f"remotive-{item.get('id')}",
            source="Remotive Public API",
            title=item.get("title", ""),
            company=item.get("company_name", ""),
            location=item.get("candidate_required_location", "Remote"),
            url=item.get("url", ""),
            description=description,
            job_type=item.get("job_type") or "Not specified",
            posted=item.get("publication_date") or "Live public listing",
            salary=item.get("salary") or "Not disclosed",
        )
        if matches_query(job, query):
            jobs.append(job)
        if len(jobs) >= limit:
            break
    return jobs


async def fetch_arbeitnow(query: str = "", limit: int = MAX_PUBLIC_RESULTS) -> list[dict[str, Any]]:
    limit = bounded_public_limit(limit)
    payload = await fetch_public_json("https://www.arbeitnow.com/api/job-board-api")
    raw = payload.get("data", []) if isinstance(payload, dict) else payload if isinstance(payload, list) else []
    jobs = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        job = normalized_job(
            job_id=f"arbeitnow-{item.get('slug') or item.get('url') or len(jobs)}",
            source="Arbeitnow Public Job Board API",
            title=item.get("title", ""),
            company=item.get("company_name", ""),
            location=item.get("location", "Not specified"),
            url=item.get("url", ""),
            description=item.get("description", ""),
            job_type="Remote" if item.get("remote") else "Not specified",
            posted=item.get("created_at", "Live public listing"),
        )
        if matches_query(job, query):
            jobs.append(job)
        if len(jobs) >= limit:
            break
    return jobs


def _board_identifier(value: str, *, hosts: set[str], source_name: str) -> str:
    """Extract only a board token; never request an applicant-provided host.

    A bare token is safe because connector requests are always assembled against
    hard-coded official Greenhouse/Lever API hosts. A URL is accepted only when
    it is HTTPS and its hostname exactly matches the provider allowlist.
    """
    text = value.strip().rstrip("/")
    if not text:
        raise ValueError(f"Enter a {source_name} board token or public board URL.")
    if "/" not in text:
        token = text
    else:
        parsed = urlparse(text if "://" in text else f"https://{text}")
        host = (parsed.hostname or "").rstrip(".").lower()
        try:
            port = parsed.port
        except ValueError as error:
            raise ValueError(f"Use an HTTPS public {source_name} board URL with a standard port, or enter its board token.") from error
        if parsed.scheme != "https" or parsed.username or parsed.password or port not in {None, 443} or host not in hosts:
            allowed = " or ".join(sorted(hosts))
            raise ValueError(f"Use an HTTPS public {source_name} board URL on {allowed}, or enter its board token.")
        pieces = [part for part in parsed.path.split("/") if part]
        if not pieces:
            raise ValueError(f"Enter a {source_name} board token or public board URL.")
        # A copied detail URL is commonly /<board>/jobs/<id>; board is first.
        token = pieces[0]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", token):
        raise ValueError("The public board token may contain only letters, numbers, hyphens, and underscores.")
    return token


def greenhouse_token(value: str) -> str:
    return _board_identifier(
        value,
        hosts={"boards.greenhouse.io", "job-boards.greenhouse.io"},
        source_name="Greenhouse",
    )


async def fetch_greenhouse(board: str, limit: int = MAX_PUBLIC_RESULTS) -> list[dict[str, Any]]:
    """Read only a small, bounded slice of an official Greenhouse board.

    Greenhouse's ``content=true`` board response sends every description for a
    company and can be many megabytes. First request the compact official index,
    then fetch content for only the bounded roles we will return.
    """
    limit = bounded_public_limit(limit)
    token = greenhouse_token(board)
    index_url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=false"
    index_payload = await fetch_public_json(index_url)
    raw_jobs = index_payload.get("jobs", []) if isinstance(index_payload, dict) else []
    indexed = [item for item in raw_jobs[:limit] if isinstance(item, dict)]
    semaphore = asyncio.Semaphore(MAX_ATS_DETAIL_CONCURRENCY)

    async def detail_for(item: dict[str, Any]) -> dict[str, Any]:
        # Greenhouse supplies numeric IDs. Validate before placing one in the
        # otherwise fixed provider URL, even though the source payload is public.
        job_id = str(item.get("id", ""))
        if not job_id.isdigit():
            return item
        try:
            async with semaphore:
                detail = await fetch_public_json(
                    f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}"
                )
            return detail if isinstance(detail, dict) else item
        except Exception:
            # Keep the published index role rather than fabricate content. Its
            # missing description remains an honest boundary for later scoring.
            return item

    detailed = await asyncio.gather(*(detail_for(item) for item in indexed))
    company = token.replace("-", " ").title()
    jobs = []
    for item in detailed:
        jobs.append(normalized_job(
            job_id=f"greenhouse-{token}-{item.get('id')}",
            source=f"Greenhouse public board · {company}",
            title=item.get("title", ""),
            company=company,
            location=(item.get("location") or {}).get("name", "Not specified"),
            url=item.get("absolute_url", ""),
            description=item.get("content", ""),
            posted=item.get("updated_at", "Live public listing"),
        ))
    return jobs

def lever_slug(value: str) -> str:
    return _board_identifier(value, hosts={"jobs.lever.co"}, source_name="Lever")


async def fetch_lever(site: str, limit: int = MAX_PUBLIC_RESULTS) -> list[dict[str, Any]]:
    limit = bounded_public_limit(limit)
    slug = lever_slug(site)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    payload: list[dict[str, Any]] | None = None
    last_error: Exception | None = None
    for host in ("https://api.lever.co", "https://api.eu.lever.co"):
        try:
            candidate = await fetch_public_json(f"{host}/v0/postings/{slug}?mode=json&limit={limit}", headers=headers)
            if isinstance(candidate, list):
                payload = candidate
                break
        except Exception as error:  # try EU region before surfacing the error
            last_error = error
    if payload is None:
        raise ValueError(f"Unable to read public Lever board '{slug}'.") from last_error
    company = slug.replace("-", " ").title()
    jobs = []
    for item in payload[:limit]:
        categories = item.get("categories") or {}
        jobs.append(normalized_job(
            job_id=f"lever-{slug}-{item.get('id')}",
            source=f"Lever public board · {company}",
            title=item.get("text", ""),
            company=company,
            location=categories.get("location") or "Not specified",
            url=item.get("hostedUrl") or item.get("applyUrl") or "",
            description=item.get("descriptionPlain") or item.get("description") or "",
            job_type=categories.get("commitment") or "Not specified",
            posted=str(item.get("createdAt") or "Live public listing"),
        ))
    return jobs
