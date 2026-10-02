"""Offline tests for the real-data / applicant-document layer.

Network calls are intentionally not exercised here: external public boards are
contracted at runtime and the app reports provenance / source failure rather
than fabricating their data.
"""
from __future__ import annotations

import asyncio
import copy
import importlib
import sys
import unittest
import warnings
from unittest.mock import AsyncMock, patch
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore", message=r"Using `httpx` with `starlette\.testclient` is deprecated")

from docx import Document
from fastapi.testclient import TestClient
from pypdf import PdfReader
from reportlab.pdfgen.canvas import Canvas

from app.data import DEMO_CANDIDATE, DEMO_JOBS
from app.documents import _application_bullets, build_docx, build_pdf, export_readiness
from app.evidence import build_cover_letter, build_safe_patches, cover_letter_evidence_ids, score_job, validate_patches
from app.main import _candidate_from_text, app, candidate_as_dict, execute_evidence_lab
from app.schemas import CandidateInput, RunStatus
main_module = importlib.import_module("app.main")
from app.sources import display_posted, greenhouse_token, lever_slug


class RealWorkflowTests(unittest.TestCase):
    def _result(self):
        candidate = copy.deepcopy(DEMO_CANDIDATE)
        job = copy.deepcopy(DEMO_JOBS[0])
        match = score_job(job, candidate)
        patches = validate_patches(build_safe_patches(job, candidate, match), candidate)["safe_patches"]
        return {
            "candidate": {key: candidate[key] for key in ("name", "headline", "location")},
            "candidate_full": candidate,
            "job": job,
            "match": match,
            "patches": patches,
            "cover_letter": build_cover_letter(job, candidate, match),
        }

    def test_public_board_urls_extract_only_the_public_board_identifier(self):
        self.assertEqual(greenhouse_token("https://boards.greenhouse.io/stripe/jobs/123"), "stripe")
        self.assertEqual(greenhouse_token("stripe"), "stripe")
        self.assertEqual(lever_slug("https://jobs.lever.co/metabase/abc-def"), "metabase")
        self.assertEqual(lever_slug("metabase"), "metabase")

    def test_public_board_urls_reject_an_unrelated_host(self):
        with self.assertRaises(ValueError):
            greenhouse_token("https://evil.example/stripe")
        with self.assertRaises(ValueError):
            lever_slug("https://evil.example/metabase")

    def test_remotive_cache_filters_each_request_and_never_leaks_other_provider_jobs(self):
        remotive_job = {
            "id": "remotive-python", "origin": "public_feed", "source": "Remotive",
            "title": "Python Engineer", "company": "Remote Co", "description": "Build Python services.",
            "must_have": ["Python"], "preferred": [], "url": "https://example.com/remotive",
        }
        arbeitnow_job = {
            "id": "arbeitnow-python", "origin": "public_feed", "source": "Arbeitnow",
            "title": "Python Developer", "company": "Berlin Co", "description": "Build Python services.",
            "must_have": ["Python"], "preferred": [], "url": "https://example.com/arbeitnow",
        }
        main_module.REMOTIVE_CACHE.clear()
        main_module.REMOTIVE_CACHE_AT = None
        main_module.REMOTIVE_CACHE_ERROR = None
        try:
            with patch.object(main_module, "fetch_remotive", new=AsyncMock(return_value=[remotive_job])) as remotive_fetch, \
                 patch.object(main_module, "fetch_arbeitnow", new=AsyncMock(return_value=[arbeitnow_job])):
                remotive = asyncio.run(main_module.public_jobs(query="python", source="remotive"))
                self.assertEqual([item["id"] for item in remotive["jobs"]], ["remotive-python"])
                # A second, different query uses local filtering of the same raw cache.
                no_match = asyncio.run(main_module.public_jobs(query="golang", source="remotive"))
                self.assertEqual(no_match["jobs"], [])
                self.assertEqual(remotive_fetch.await_count, 1)
                arbeitnow = asyncio.run(main_module.public_jobs(query="python", source="arbeitnow"))
                self.assertEqual([item["id"] for item in arbeitnow["jobs"]], ["arbeitnow-python"])
        finally:
            main_module.REMOTIVE_CACHE.clear()
            main_module.REMOTIVE_CACHE_AT = None
            main_module.REMOTIVE_CACHE_ERROR = None

    def test_incomplete_applicant_is_not_silently_replaced_by_practice_evidence(self):
        applicant = CandidateInput(name="Real Applicant", resume_text="", evidence=[])
        self.assertEqual(candidate_as_dict(applicant)["name"], "Real Applicant")
        self.assertEqual(candidate_as_dict(applicant)["evidence"], [])

    def test_public_epoch_timestamp_is_human_readable(self):
        self.assertEqual(display_posted(0), "0")
        self.assertRegex(display_posted(1_700_000_000_000), r"^20\d\d-\d\d-\d\d$")

    def test_imported_text_yields_reviewable_evidence(self):
        candidate = _candidate_from_text(
            """Jane Applicant
Backend developer
EXPERIENCE
Built Python REST APIs using FastAPI and PostgreSQL for a student platform.
Dockerized the service and documented setup for three contributors.
Reduced manual reporting time by 40 percent with a React dashboard.
""",
            "jane.txt",
        )
        self.assertEqual(candidate.name, "Jane Applicant")
        self.assertGreaterEqual(len(candidate.evidence), 2)
        self.assertTrue(all(item.source_text for item in candidate.evidence))
        self.assertNotIn("Backend developer", [item.source_text for item in candidate.evidence])
        imported_skills = {skill for item in candidate.evidence for skill in item.skills}
        self.assertIn("FastAPI", imported_skills)
        self.assertIn("REST APIs", imported_skills)

    def test_cover_letter_uses_only_selected_evidence_and_names_gaps(self):
        candidate = {
            "name": "Taylor Example",
            "evidence": [{
                "evidence_id": "cv_01", "source_section": "Candidate-provided resume",
                "source_text": "Built a React dashboard for a campus operations team.",
                "skills": ["React"], "status": "verified",
            }],
        }
        job = {"title": "Backend Engineer", "company": "Example Co", "must_have": ["Python", "FastAPI"], "preferred": []}
        match = score_job(job, candidate)
        letter = build_cover_letter(job, candidate, match)
        ids = cover_letter_evidence_ids(job, candidate, match)
        self.assertIn("Built a React dashboard for a campus operations team.", letter)
        self.assertIn("do not have direct, verified evidence for Python, FastAPI", letter)
        self.assertNotIn("JWT authentication", letter)
        self.assertEqual(ids, ["cv_01"])

    def test_cv_upload_accepts_real_text_pdf_and_docx(self):
        resume = """Jane Applicant
Backend developer
EXPERIENCE
Built Python REST APIs using FastAPI and PostgreSQL for a student platform.
Dockerized the service and documented setup for three contributors.
Reduced manual reporting time by 40 percent with a React dashboard.
"""
        docx_buffer = BytesIO()
        docx = Document()
        for line in resume.splitlines():
            docx.add_paragraph(line)
        docx.save(docx_buffer)

        pdf_buffer = BytesIO()
        canvas = Canvas(pdf_buffer)
        y = 790
        for line in resume.splitlines():
            canvas.drawString(45, y, line)
            y -= 18
        canvas.save()

        client = TestClient(app)
        for filename, content, media_type in [
            ("jane.docx", docx_buffer.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            ("jane.pdf", pdf_buffer.getvalue(), "application/pdf"),
        ]:
            with self.subTest(filename=filename):
                response = client.post("/api/candidate/upload", files={"file": (filename, content, media_type)})
                self.assertEqual(response.status_code, 200, response.text)
                payload = response.json()
                self.assertEqual(payload["import"]["format"], filename.rsplit(".", 1)[-1])
                self.assertGreaterEqual(payload["import"]["evidence_count"], 2)

    def test_unverified_note_does_not_become_application_proof(self):
        candidate = {"evidence": [{
            "evidence_id": "draft_01", "source_section": "Draft", "source_text": "Claimed FastAPI work.",
            "skills": ["FastAPI"], "status": "unverified",
        }]}
        match = score_job({"must_have": ["FastAPI"], "preferred": []}, candidate)
        self.assertEqual(match["score"], 0)
        self.assertEqual(match["verified_strengths"], [])
        self.assertEqual(build_safe_patches({"must_have": ["FastAPI"]}, candidate, match), [])
        self.assertFalse(validate_patches([{"evidence_ids": ["draft_01"]}], candidate)["safe_patches"])

    def test_no_matching_evidence_has_zero_fit_not_a_synthetic_floor(self):
        match = score_job({"must_have": ["Kubernetes"], "preferred": []}, {"evidence": []})
        self.assertEqual(match["score"], 0)
        self.assertEqual(match["coverage"], 0)

    def test_unmatched_role_ends_in_needs_evidence_not_export_ready(self):
        candidate = {"name": "Taylor Example", "headline": "Frontend", "location": "Remote", "evidence": [{
            "evidence_id": "cv_01", "source_section": "Experience", "source_text": "Built a React dashboard for a campus team.",
            "skills": ["React"], "status": "verified",
        }]}
        job = {"id": "qa-cloud", "title": "Cloud Engineer", "company": "QA Co", "must_have": ["Kubernetes", "Terraform"], "preferred": []}
        run = RunStatus(id="run-test", status="queued", selected_job_id="qa-cloud", mode="evidence_lab")
        with patch("app.main.asyncio.sleep", new=AsyncMock()):
            asyncio.run(execute_evidence_lab(run, job, candidate))
        self.assertEqual(run.status, "needs_evidence")
        self.assertEqual(run.result["patches"], [])
        self.assertEqual(run.events[-1].type, "evidence_needed")

    def test_same_evidence_statement_is_not_exported_twice(self):
        candidate = {
            "name": "Taylor Example",
            "evidence": [
                {"evidence_id": "cv_01", "source_section": "Experience", "source_text": "Developed REST APIs using Python and FastAPI for a student platform.", "skills": ["Python", "FastAPI", "REST APIs"], "status": "verified"},
                {"evidence_id": "cv_02", "source_section": "Project", "source_text": "Dockerized the service and documented local setup.", "skills": ["Docker"], "status": "verified"},
            ],
        }
        job = {"title": "Backend Engineer", "must_have": ["Python", "FastAPI", "REST APIs", "Docker"], "preferred": []}
        patches = build_safe_patches(job, candidate, score_job(job, candidate))
        self.assertEqual(len({patch["proposed"] for patch in patches}), len(patches))
        self.assertEqual(len(patches), 2)

    def test_target_requirement_order_controls_document_priority(self):
        candidate = copy.deepcopy(DEMO_CANDIDATE)
        job = copy.deepcopy(DEMO_JOBS[1])  # Full-stack role begins with React.
        patches = build_safe_patches(job, candidate, score_job(job, candidate))
        self.assertTrue(patches)
        self.assertIn("React", patches[0]["covered_requirements"])
        self.assertIn("React", patches[0]["proposed"])

    def test_non_backend_direct_requirement_receives_a_literal_patch(self):
        candidate = {"evidence": [{
            "evidence_id": "cv_01", "source_section": "Experience", "source_text": "Built a React dashboard for a campus operations team.",
            "skills": ["React"], "status": "verified",
        }]}
        job = {"title": "Frontend Engineer", "must_have": ["React"], "preferred": []}
        patches = build_safe_patches(job, candidate, score_job(job, candidate))
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0]["proposed"], "Built a React dashboard for a campus operations team.")
        self.assertEqual(patches[0]["covered_requirements"], ["React"])

    def test_unrelated_evidence_is_not_used_to_pad_a_targeted_document(self):
        candidate = {"evidence": [{
            "evidence_id": "cv_01", "source_section": "Project", "source_text": "Dockerized a local development environment.",
            "skills": ["Docker"], "status": "verified",
        }]}
        job = {"title": "Platform Engineer", "must_have": ["Kubernetes", "Terraform"], "preferred": []}
        self.assertEqual(build_safe_patches(job, candidate, score_job(job, candidate)), [])

    def test_document_layer_defensively_removes_duplicate_bullets(self):
        result = self._result()
        result["patches"].append(copy.deepcopy(result["patches"][0]))
        self.assertEqual(len(_application_bullets(result)), len(result["patches"]) - 1)
        empty = {**result, "patches": []}
        self.assertFalse(export_readiness(empty)["passed"])

    def test_one_literal_can_cover_multiple_requirements_once(self):
        candidate = {"evidence": [{
            "evidence_id": "cv_01", "source_section": "Experience",
            "source_text": "Developed Dockerized REST APIs using Python and FastAPI for a student platform.",
            "skills": ["Python", "FastAPI", "REST APIs", "Docker"], "status": "verified",
        }]}
        job = {"title": "Backend Engineer", "must_have": ["Python", "FastAPI", "REST APIs", "Docker"], "preferred": []}
        patches = build_safe_patches(job, candidate, score_job(job, candidate))
        self.assertEqual(len(patches), 1)
        self.assertEqual(set(patches[0]["covered_requirements"]), {"Python", "FastAPI", "REST APIs", "Docker"})
        self.assertEqual(patches[0]["evidence_ids"], ["cv_01"])

    def test_normalize_drops_stale_evidence_when_current_resume_has_no_proof(self):
        client = TestClient(app)
        response = client.post("/api/candidate/normalize", json={
            "name": "Taylor Example", "headline": "Applicant", "location": "Remote", "preferences": [],
            "resume_text": "", 
            "evidence": [{"evidence_id": "old_01", "source_section": "Old file", "source_text": "Built a hidden stale project.", "skills": ["Python"], "status": "verified"}],
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["evidence"], [])

    def test_empty_ledger_cannot_start_an_application_packet(self):
        client = TestClient(app)
        response = client.post("/api/runs", json={
            "job_id": "atlas-ai-backend",
            "candidate": {"name": "Taylor Example", "headline": "Applicant", "location": "Remote", "preferences": [], "resume_text": "", "evidence": []},
        })
        self.assertEqual(response.status_code, 422)
        self.assertIn("empty evidence ledger", response.json()["detail"])

    def test_run_requires_name_and_verified_evidence(self):
        client = TestClient(app)
        base = {"job_id": "atlas-ai-backend", "candidate": {"name": "", "headline": "Applicant", "location": "Remote", "preferences": [], "resume_text": "", "evidence": [{"evidence_id": "cv_01", "source_section": "Resume", "source_text": "Built a FastAPI service.", "skills": ["FastAPI"], "status": "verified"}]}}
        response = client.post("/api/runs", json=base)
        self.assertEqual(response.status_code, 422)
        self.assertIn("name", response.json()["detail"])
        base["candidate"]["name"] = "Taylor Example"
        base["candidate"]["evidence"][0]["status"] = "unverified"
        response = client.post("/api/runs", json=base)
        self.assertEqual(response.status_code, 422)
        self.assertIn("verified", response.json()["detail"])

    def test_manual_role_rejects_unsafe_listing_url(self):
        client = TestClient(app)
        response = client.post("/api/jobs/manual", json={
            "title": "Engineer", "company": "Example", "description": "Python work", "url": "javascript:alert(1)",
        })
        self.assertEqual(response.status_code, 422)
        self.assertIn("http://", response.json()["detail"])

    def test_manual_role_extracts_extended_controlled_skill_taxonomy(self):
        client = TestClient(app)
        response = client.post("/api/jobs/manual", json={
            "title": "Platform Engineer", "company": "Example Co",
            "description": "Build Terraform modules and Apache Airflow workflows, write testing plans, and ship LLM applications with HTML and CSS interfaces.",
        })
        self.assertEqual(response.status_code, 200, response.text)
        extracted = response.json()["must_have"] + response.json()["preferred"]
        for skill in ["Terraform", "Airflow", "Testing", "LLM applications", "HTML", "CSS"]:
            self.assertIn(skill, extracted)

    def test_approval_rechecks_document_qa_and_rejects_zero_patch_packet(self):
        run_id = "run-malformed-approval-test"
        main_module.RUNS[run_id] = RunStatus(
            id=run_id, status="awaiting_approval", selected_job_id="atlas-ai-backend", mode="evidence_lab",
            result={
                "candidate": {"name": "Taylor Example"},
                "job": {"title": "Engineer", "company": "Example"},
                "patches": [],
                "cover_letter": "A draft.",
                # Simulate an untrusted stale flag; server-side approval must ignore it.
                "export_readiness": {"passed": True},
            },
        )
        try:
            response = TestClient(app).post(f"/api/runs/{run_id}/approve")
            self.assertEqual(response.status_code, 409, response.text)
            self.assertIn("Document QA", response.json()["detail"])
            self.assertEqual(main_module.RUNS[run_id].status, "awaiting_approval")
        finally:
            main_module.RUNS.pop(run_id, None)

    def test_approval_rejects_a_patch_with_forged_evidence_id(self):
        run_id = "run-forged-evidence-test"
        result = self._result()
        result["patches"][0]["evidence_ids"] = ["not-in-the-candidate-ledger"]
        main_module.RUNS[run_id] = RunStatus(
            id=run_id, status="awaiting_approval", selected_job_id="atlas-ai-backend", mode="evidence_lab", result=result,
        )
        try:
            response = TestClient(app).post(f"/api/runs/{run_id}/approve")
            self.assertEqual(response.status_code, 409, response.text)
            readiness = main_module.RUNS[run_id].result["export_readiness"]
            integrity = next(item for item in readiness["checks"] if item["label"] == "Server-side evidence integrity")
            self.assertFalse(integrity["passed"])
        finally:
            main_module.RUNS.pop(run_id, None)

    def test_approved_export_formats_are_real_and_pdf_round_trips_to_text(self):
        result = self._result()
        pdf = build_pdf(result)
        self.assertTrue(pdf.startswith(b"%PDF"))
        extracted = " ".join(page.extract_text() or "" for page in PdfReader(BytesIO(pdf)).pages)
        self.assertIn("Ayesha Khan", extracted)
        self.assertIn("TARGETED EXPERIENCE", extracted)

        docx = build_docx(result)
        document = Document(BytesIO(docx))
        self.assertIn("Ayesha Khan", "\n".join(paragraph.text for paragraph in document.paragraphs))

        readiness = export_readiness(result)
        self.assertTrue(readiness["passed"])
        self.assertTrue(next(item for item in readiness["checks"] if item["label"] == "PDF text round-trip")["passed"])


if __name__ == "__main__":
    unittest.main()
