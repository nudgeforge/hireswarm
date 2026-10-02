"""Generated-data workflow matrix for the local Evidence Lab.

These deterministic candidates are deliberately richer than the visual demo. They
exercise direct proof, adjacent proof, explicit gaps, manual taxonomy extraction,
and the full document-QA gate without needing a provider key or network access.
"""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.evidence import build_interview, build_safe_patches, score_job, validate_patches
from app.main import app, execute_evidence_lab
from app.schemas import RunStatus


GENERATED_CANDIDATE = {
    "name": "Zara Siddiqui",
    "headline": "Product-minded platform engineer",
    "location": "Rawalpindi, Pakistan",
    "preferences": ["Remote", "Backend", "Product infrastructure"],
    "resume_text": """Zara Siddiqui
Product-minded platform engineer
EXPERIENCE
Built Python REST APIs using FastAPI and PostgreSQL for a campus services platform.
Dockerized the deployment workflow and reduced local setup time for contributors.
Built a React and TypeScript operations console for support teams.
Implemented Terraform modules for a sandbox environment and documented handover steps.
""",
    "evidence": [
        {
            "evidence_id": "zara_01", "source_section": "Experience",
            "source_text": "Built Python REST APIs using FastAPI and PostgreSQL for a campus services platform.",
            "skills": ["Python", "REST APIs", "FastAPI", "PostgreSQL"], "status": "verified",
        },
        {
            "evidence_id": "zara_02", "source_section": "Project",
            "source_text": "Dockerized the deployment workflow and reduced local setup time for contributors.",
            "skills": ["Docker"], "status": "verified",
        },
        {
            "evidence_id": "zara_03", "source_section": "Experience",
            "source_text": "Built a React and TypeScript operations console for support teams.",
            "skills": ["React", "TypeScript"], "status": "verified",
        },
        {
            "evidence_id": "zara_04", "source_section": "Project",
            "source_text": "Implemented Terraform modules for a sandbox environment and documented handover steps.",
            "skills": ["Terraform"], "status": "verified",
        },
    ],
}

GENERATED_JOB = {
    "id": "generated-platform-role",
    "title": "Platform Product Engineer",
    "company": "Northwind Studio",
    "location": "Remote",
    "type": "Full time",
    "description": "Build reliable product infrastructure and developer workflows.",
    "must_have": ["Python", "FastAPI", "REST APIs", "PostgreSQL", "Docker", "Kubernetes"],
    "preferred": ["React", "TypeScript", "Terraform"],
    "interview_questions": [],
}


class GeneratedDemoWorkflowMatrix(unittest.TestCase):
    def test_rich_generated_candidate_maps_proof_and_preserves_the_kubernetes_boundary(self):
        match = score_job(GENERATED_JOB, GENERATED_CANDIDATE)
        direct = {item["skill"] for item in match["verified_strengths"]}
        self.assertTrue({"Python", "FastAPI", "REST APIs", "PostgreSQL", "Docker", "React", "TypeScript", "Terraform"}.issubset(direct))
        self.assertNotIn("Kubernetes", direct)
        kubernetes_gap = next(item for item in match["gaps"] if item["skill"] == "Kubernetes")
        self.assertEqual(kubernetes_gap["severity"], "adjacent_only")
        patches = build_safe_patches(GENERATED_JOB, GENERATED_CANDIDATE, match)
        self.assertGreaterEqual(len(patches), 2)
        validation = validate_patches(patches, GENERATED_CANDIDATE)
        self.assertEqual(len(validation["safe_patches"]), len(patches))
        self.assertTrue(validation["all_claims_linked"])
        turns = build_interview(GENERATED_JOB, GENERATED_CANDIDATE, match)
        kubernetes_turn = next(turn for turn in turns if turn["requirement"] == "Kubernetes")
        self.assertEqual(kubernetes_turn["status"], "PARTIAL")

        # Public feeds and manually pasted roles can place a meaningful gap in
        # preferred requirements after five direct must-haves. The compact
        # four-question rehearsal must still surface it.
        preferred_gap_job = {**GENERATED_JOB, "must_have": ["Python", "FastAPI", "REST APIs", "PostgreSQL", "Docker"], "preferred": ["Kubernetes"]}
        preferred_gap_match = score_job(preferred_gap_job, GENERATED_CANDIDATE)
        preferred_gap_turns = build_interview(preferred_gap_job, GENERATED_CANDIDATE, preferred_gap_match)
        self.assertIn("Kubernetes", [turn["requirement"] for turn in preferred_gap_turns])

    def test_generated_candidate_full_evidence_lab_reaches_server_qa(self):
        run = RunStatus(id="generated-run", status="queued", selected_job_id=GENERATED_JOB["id"], mode="evidence_lab")
        with patch("app.main.asyncio.sleep", new=AsyncMock()):
            asyncio.run(execute_evidence_lab(run, GENERATED_JOB, GENERATED_CANDIDATE))
        self.assertEqual(run.status, "awaiting_approval")
        self.assertTrue(run.result["patches"])
        self.assertTrue(run.result["export_readiness"]["passed"])
        self.assertIn("export_readiness", [event.type for event in run.events])
        self.assertIn("approval_required", [event.type for event in run.events])

    def test_generated_candidate_without_relevant_proof_stays_out_of_export(self):
        candidate = {
            "name": "Noah Example", "headline": "Content writer", "location": "Remote",
            "evidence": [{
                "evidence_id": "noah_01", "source_section": "Experience",
                "source_text": "Wrote editorial copy and coordinated a community newsletter.",
                "skills": [], "status": "verified",
            }],
        }
        job = {**GENERATED_JOB, "id": "generated-unmatched", "must_have": ["Kubernetes", "Terraform"], "preferred": []}
        run = RunStatus(id="generated-unmatched-run", status="queued", selected_job_id=job["id"], mode="evidence_lab")
        with patch("app.main.asyncio.sleep", new=AsyncMock()):
            asyncio.run(execute_evidence_lab(run, job, candidate))
        self.assertEqual(run.status, "needs_evidence")
        self.assertEqual(run.result["patches"], [])
        self.assertNotIn("export_readiness", run.result)

    def test_generated_resume_and_pasted_role_use_the_same_controlled_taxonomy(self):
        client = TestClient(app)
        normalized = client.post("/api/candidate/normalize", json=GENERATED_CANDIDATE)
        self.assertEqual(normalized.status_code, 200, normalized.text)
        imported_skills = {skill for item in normalized.json()["evidence"] for skill in item["skills"]}
        self.assertTrue({"FastAPI", "REST APIs", "PostgreSQL", "Docker", "React", "TypeScript", "Terraform"}.issubset(imported_skills))

        pasted = client.post("/api/jobs/manual", json={
            "title": "Generated MLOps Target", "company": "Northwind Studio", "location": "Remote",
            "description": "Build Terraform modules, Apache Airflow workflows, robust testing suites, LLM applications, HTML and CSS product surfaces, and CI/CD delivery paths.",
        })
        self.assertEqual(pasted.status_code, 200, pasted.text)
        requirements = set(pasted.json()["must_have"] + pasted.json()["preferred"])
        self.assertTrue({"Terraform", "Airflow", "Testing", "LLM applications", "HTML", "CSS", "CI/CD"}.issubset(requirements))


if __name__ == "__main__":
    unittest.main()
