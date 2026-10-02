"""Seed data for a repeatable, fully offline hackathon demonstration.

The same schemas are used for live/public API data. Fixtures are labeled explicitly
so the UI never pretends a simulated listing is a live vacancy.
"""

from __future__ import annotations

import re

DEMO_CANDIDATE = {
    "name": "Hussain Ahmed",
    "headline": "Full-Stack Developer · Python · FastAPI · React · PostgreSQL",
    "location": "Rawalpindi, Pakistan",
    "preferences": ["Remote", "Full-stack", "Backend products"],
    "resume_text": """HUSSAIN AHMED
Full-Stack Developer · Python · FastAPI · React · PostgreSQL

EXPERIENCE
Junior Software Developer — Campus Innovation Lab | 2024–2026
• Built a React dashboard for an operations team.
• Developed REST APIs for a student-services platform.
• Collaborated with three developers using Git and code reviews.

PROJECTS
Smart Support API
• Built a FastAPI service with JWT authentication and PostgreSQL.
• Dockerized the development environment and documented local setup.
• Reduced manual reporting time by 40% through an analytics dashboard.

SKILLS
Python, FastAPI, React, TypeScript, PostgreSQL, REST APIs, Git, Docker, HTML, CSS
""",
    "evidence": [
        {
            "evidence_id": "ev_01",
            "source_section": "Experience",
            "source_text": "Built a React dashboard for an operations team.",
            "skills": ["React", "Dashboard development", "Frontend"],
            "status": "verified",
        },
        {
            "evidence_id": "ev_02",
            "source_section": "Experience",
            "source_text": "Developed REST APIs for a student-services platform.",
            "skills": ["Python", "REST APIs", "Backend"],
            "status": "verified",
        },
        {
            "evidence_id": "ev_03",
            "source_section": "Project",
            "source_text": "Built a FastAPI service with JWT authentication and PostgreSQL.",
            "skills": ["FastAPI", "Python", "JWT", "PostgreSQL", "Backend"],
            "status": "verified",
        },
        {
            "evidence_id": "ev_04",
            "source_section": "Project",
            "source_text": "Dockerized the development environment and documented local setup.",
            "skills": ["Docker", "Developer experience", "Documentation"],
            "status": "verified",
        },
        {
            "evidence_id": "ev_05",
            "source_section": "Project",
            "source_text": "Reduced manual reporting time by 40% through an analytics dashboard.",
            "skills": ["React", "Analytics", "Impact measurement"],
            "metric": "40% reduction in reporting time",
            "status": "verified",
        },
        {
            "evidence_id": "ev_06",
            "source_section": "Experience",
            "source_text": "Collaborated with three developers using Git and code reviews.",
            "skills": ["Git", "Code review", "Team collaboration"],
            "status": "verified",
        },
    ],
}

DEMO_JOBS = [
    {
        "id": "atlas-ai-backend",
        "origin": "demo_fixture",
        "source": "Demo Scenario",
        "title": "AI Backend Engineer",
        "company": "Atlas Labs",
        "location": "Remote · Pakistan-friendly",
        "type": "Full time",
        "salary": "Competitive · not disclosed",
        "posted": "Demo scenario",
        "url": "https://example.com/atlas-ai-backend",
        "description": "Build reliable Python services for AI-enabled workflows. Work with product and frontend engineers to create API-first experiences.",
        "must_have": ["Python", "FastAPI", "REST APIs", "PostgreSQL", "Docker"],
        "preferred": ["Kubernetes", "LLM applications", "CI/CD"],
        "interview_questions": [
            {
                "requirement": "FastAPI and Python",
                "question": "Walk me through a FastAPI service you built. How did you design the API and protect access?",
                "answer": "I built a FastAPI service with JWT authentication and PostgreSQL for a Smart Support API project. I can explain the API endpoints and the local development setup.",
                "status": "SUPPORTED",
                "evidence_ids": ["ev_03"],
                "verdict": "Direct FastAPI and backend evidence is present.",
            },
            {
                "requirement": "REST API delivery",
                "question": "Tell me about a REST API that improved a real workflow rather than just a tutorial project.",
                "answer": "I developed REST APIs for a student-services platform and connected analytics views that reduced manual reporting time by 40%.",
                "status": "SUPPORTED",
                "evidence_ids": ["ev_02", "ev_05"],
                "verdict": "Strong workflow and measurable impact evidence.",
            },
            {
                "requirement": "Docker",
                "question": "How have you used Docker to make a development workflow reproducible?",
                "answer": "I Dockerized the development environment for my FastAPI project and documented the local setup for other developers.",
                "status": "SUPPORTED",
                "evidence_ids": ["ev_04"],
                "verdict": "Verified development-container experience.",
            },
            {
                "requirement": "Kubernetes",
                "question": "Describe a production Kubernetes deployment you owned, including rollout, health checks, and rollback decisions.",
                "answer": "I have verified Docker development experience, but I do not have verified production Kubernetes ownership. I would not claim that experience; this is a focused learning gap.",
                "status": "PARTIAL",
                "evidence_ids": ["ev_04"],
                "verdict": "Truthful adjacent Docker evidence, but no verified production Kubernetes evidence.",
            },
        ],
    },
    {
        "id": "northstar-fullstack",
        "origin": "demo_fixture",
        "source": "Demo Scenario",
        "title": "Full-Stack Product Engineer",
        "company": "Northstar Systems",
        "location": "Remote · Global",
        "type": "Full time",
        "salary": "Competitive · not disclosed",
        "posted": "Demo scenario",
        "url": "https://example.com/northstar-fullstack",
        "description": "Ship responsive React product surfaces and API-driven services for operations teams.",
        "must_have": ["React", "TypeScript", "Python", "REST APIs", "Git"],
        "preferred": ["Testing", "Docker", "Product analytics"],
        "interview_questions": [],
    },
    {
        "id": "orbit-data-platform",
        "origin": "demo_fixture",
        "source": "Demo Scenario",
        "title": "Junior Data Platform Engineer",
        "company": "Orbit Data",
        "location": "Hybrid · Islamabad",
        "type": "Full time",
        "salary": "Competitive · not disclosed",
        "posted": "Demo scenario",
        "url": "https://example.com/orbit-data-platform",
        "description": "Build data services, reporting APIs, and developer tooling for growing product teams.",
        "must_have": ["Python", "PostgreSQL", "REST APIs", "Git"],
        "preferred": ["Airflow", "Kubernetes", "Terraform"],
        "interview_questions": [],
    },
    {
        "id": "vector-frontend",
        "origin": "demo_fixture",
        "source": "Demo Scenario",
        "title": "Frontend Engineer",
        "company": "Vector Cloud",
        "location": "Remote · APAC",
        "type": "Contract",
        "salary": "Competitive · not disclosed",
        "posted": "Demo scenario",
        "url": "https://example.com/vector-frontend",
        "description": "Build polished TypeScript and React product interfaces backed by APIs.",
        "must_have": ["React", "TypeScript", "HTML", "CSS", "REST APIs"],
        "preferred": ["Design systems", "Testing", "Analytics"],
        "interview_questions": [],
    },
]

# This is intentionally a small, inspectable taxonomy rather than a claim that
# arbitrary keywords prove experience. Aliases are matched at word boundaries
# by ``has_alias`` below; notably, a fragment such as "ai" inside "maintained"
# must never turn into LLM evidence.
SKILL_ALIASES = {
    "python": ["python", "fastapi"],
    "fastapi": ["fastapi"],
    "rest apis": ["rest api", "rest apis", "restful api", "restful apis"],
    "postgresql": ["postgresql", "postgres"],
    "sql": ["sql", "mysql", "sqlite", "mariadb"],
    "docker": ["docker", "dockerized", "dockerfile"],
    "kubernetes": ["kubernetes", "k8s"],
    "terraform": ["terraform"],
    "airflow": ["airflow", "apache airflow"],
    "react": ["react", "react.js", "reactjs"],
    "typescript": ["typescript"],
    "javascript": ["javascript", "ecmascript"],
    "node.js": ["node.js", "nodejs"],
    "html": ["html", "html5"],
    "css": ["css", "css3", "tailwind", "sass"],
    "git": ["git", "github", "gitlab"],
    "llm applications": ["llm", "large language model", "generative ai", "genai"],
    "ci/cd": ["ci/cd", "continuous integration", "continuous delivery", "continuous deployment"],
    "testing": ["test", "testing", "tested", "unit test", "integration test"],
    "design systems": ["design system", "design systems"],
    "product analytics": ["product analytics", "amplitude", "mixpanel"],
}


def has_alias(text: str, alias: str) -> bool:
    """Match a skill alias as a whole term, not as a substring of another word."""
    pattern = rf"(?<![a-z0-9]){re.escape(alias.lower())}(?![a-z0-9])"
    return bool(re.search(pattern, text.lower()))


ADJACENT_SKILLS = {
    "REST APIs": ["FastAPI"],
    "Kubernetes": ["Docker"],
    "CI/CD": ["Git", "Docker"],
    "LLM applications": ["Python", "FastAPI"],
    "Testing": ["Git", "Code review"],
    "Airflow": ["Python", "PostgreSQL"],
    "Terraform": ["Docker", "Git"],
}
