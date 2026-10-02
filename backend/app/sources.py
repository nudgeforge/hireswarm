"""Public, terms-aligned job-source connectors.

HireSwarm deliberately reads only published public feeds and never submits an
application or crawls login-protected job boards. Each normalized job retains
its source URL and provenance for the user interface.
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlparse
from typing import Any

import httpx

from .data import SKILL_ALIASES, has_alias

USER_AGENT = "HireSwarm/1.0 (applicant-controlled job discovery; public feed reader)"
TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class _HTMLText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def clean_text(value: str | None) -> str:
    parser = _HTMLText()
    parser.feed(value or "")
    text = html.unescape(" ".join(parser.parts))
    return re.sub(r"\s+", " ", text).strip()


def safe_http_url(value: str | None) -> str:
    """Keep only ordinary web links before a browser is offered an external open action."""
    url = str(value or "").strip()
    parsed = urlparse(url)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return url
    return ""


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


async def fetch_remotive(query: str = "", limit: int = 12) -> list[dict[str, Any]]:
    # Official public feed; callers must cache and avoid aggressive polling.
    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.get("https://remotive.com/api/remote-jobs?limit=50")
        response.raise_for_status()
        payload = response.json()
    jobs = []
    for item in payload.get("jobs", []):
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


async def fetch_arbeitnow(query: str = "", limit: int = 12) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.get("https://www.arbeitnow.com/api/job-board-api")
        response.raise_for_status()
        payload = response.json()
    raw = payload.get("data", payload if isinstance(payload, list) else [])
    jobs = []
    for item in raw:
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
    text = value.strip().rstrip("/")
    if not text:
        raise ValueError(f"Enter a {source_name} board token or public board URL.")
    if "/" not in text:
        token = text
    else:
        parsed = urlparse(text if "://" in text else f"https://{text}")
        host = (parsed.hostname or "").lower()
        if host not in hosts:
            allowed = " or ".join(sorted(hosts))
            raise ValueError(f"Use a public {source_name} board URL on {allowed}, or enter its board token.")
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


async def fetch_greenhouse(board: str, limit: int = 50) -> list[dict[str, Any]]:
    token = greenhouse_token(board)
    url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()
    company = token.replace("-", " ").title()
    jobs = []
    for item in payload.get("jobs", [])[:limit]:
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


async def fetch_lever(site: str, limit: int = 50) -> list[dict[str, Any]]:
    slug = lever_slug(site)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    payload: list[dict[str, Any]] | None = None
    last_error: Exception | None = None
    for host in ("https://api.lever.co", "https://api.eu.lever.co"):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, headers=headers) as client:
                response = await client.get(f"{host}/v0/postings/{slug}?mode=json&limit={limit}")
                response.raise_for_status()
                candidate = response.json()
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
