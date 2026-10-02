from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


class Evidence(BaseModel):
    evidence_id: str
    source_section: str
    source_text: str
    skills: list[str] = Field(default_factory=list)
    metric: str | None = None
    status: Literal["verified", "partial", "unverified"] = "verified"


class CandidateInput(BaseModel):
    name: str = "Hussain Ahmed"
    headline: str = "Full-Stack Developer · Python · FastAPI · React · PostgreSQL"
    location: str = "Rawalpindi, Pakistan"
    preferences: list[str] = Field(default_factory=lambda: ["Remote", "Full-stack", "Backend"])
    resume_text: str = ""
    evidence: list[Evidence] = Field(default_factory=list)


class RunCreate(BaseModel):
    job_id: str
    candidate: CandidateInput | None = None
    mode: Literal["evidence_lab", "crewai"] = "evidence_lab"


class EventPayload(BaseModel):
    type: str
    agent: str | None = None
    title: str
    message: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    at: str | None = None


class RunStatus(BaseModel):
    id: str
    status: Literal["queued", "running", "needs_evidence", "awaiting_approval", "approved", "completed", "failed"]
    selected_job_id: str
    mode: str
    events: list[EventPayload] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)


class ManualJobInput(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    company: str = Field(min_length=2, max_length=160)
    description: str = Field(max_length=50000)
    location: str = Field(default="Not specified", max_length=160)
    url: str = Field(default="", max_length=2000)


class PublicBoardInput(BaseModel):
    """A public, applicant-supplied board identifier; no employer credentials."""
    source: Literal["greenhouse", "lever"]
    board: str = Field(min_length=1, max_length=300)
