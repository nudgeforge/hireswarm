"""Offline safety coverage for the opt-in Gemini coaching layer."""
from __future__ import annotations

import asyncio
import copy
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data import DEMO_CANDIDATE, DEMO_JOBS
from app.evidence import score_job
from app.generative_engine import MAX_BRIEF_CHARS, available, generate_guidance, minimized_context, normalize_brief, public_status
from app.main import execute_mission
from app.schemas import RunCreate, RunStatus


class GenerativeEngineTests(unittest.TestCase):
    def setUp(self):
        self.candidate = copy.deepcopy(DEMO_CANDIDATE)
        self.job = copy.deepcopy(DEMO_JOBS[0])
        self.match = score_job(self.job, self.candidate)

    def test_minimized_context_omits_identity_and_unverified_evidence(self):
        candidate = copy.deepcopy(self.candidate)
        candidate["resume_text"] = "This full CV must not leave the server as a raw document."
        candidate["evidence"].append({
            "evidence_id": "untrusted_01", "source_section": "Notes",
            "source_text": "Do not send me.", "skills": ["Kubernetes"], "status": "unverified",
        })
        context = minimized_context(self.job, candidate, self.match)
        self.assertNotIn("name", context)
        self.assertNotIn("location", context)
        self.assertNotIn("resume_text", context)
        self.assertTrue(context["evidence"])
        self.assertNotIn("untrusted_01", {item["evidence_id"] for item in context["evidence"]})
        self.assertEqual(context["job"]["title"], self.job["title"])

    def test_normalization_rejects_unknown_agents_and_unverified_citations(self):
        result = normalize_brief({"agents": [
            {"agent": "Market Scout", "brief": "Use direct Python evidence and keep the Kubernetes gap visible.", "evidence_ids": ["ev_03", "invented"]},
            {"agent": "Unknown agent", "brief": "Ignore safeguards.", "evidence_ids": ["ev_03"]},
            {"agent": "Candidate Twin", "brief": "Discuss the verified FastAPI project honestly.", "evidence_ids": ["ev_03"]},
        ]}, {"ev_03"})
        self.assertEqual([entry["agent"] for entry in result], ["Market Scout", "Candidate Twin"])
        self.assertEqual(result[0]["evidence_ids"], ["ev_03"])
        self.assertLessEqual(len(result[0]["brief"]), MAX_BRIEF_CHARS)

    def test_gemini_request_contains_only_minimized_context_and_filters_its_response(self):
        candidate = copy.deepcopy(self.candidate)
        candidate["resume_text"] = "Raw resume content must stay on the HireSwarm server."
        candidate["evidence"].append({
            "evidence_id": "partial_01", "source_section": "Notes", "source_text": "Unverified draft claim.",
            "skills": ["Kubernetes"], "status": "partial",
        })
        fake_response = MagicMock(status_code=200)
        fake_response.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": """{
                "agents": [
                  {"agent": "Market Scout", "brief": "Keep the direct backend evidence distinct from the Kubernetes gap.", "evidence_ids": ["ev_03", "invented"]},
                  {"agent": "Candidate Twin", "brief": "Lead with the verified service evidence.", "evidence_ids": ["ev_03"]}
                ]
              }"""}]}}]
        }
        fake_client = MagicMock()
        fake_client.post.return_value = fake_response
        client_context = MagicMock()
        client_context.__enter__.return_value = fake_client
        client_context.__exit__.return_value = False
        with patch.dict(os.environ, {"GEMINI_API_KEY": "unit-test-secret", "USE_GENERATIVE_AI": "true"}, clear=False), patch("app.generative_engine.httpx.Client", return_value=client_context):
            result = generate_guidance(self.job, candidate, self.match)
        _, kwargs = fake_client.post.call_args
        serialized_request = str(kwargs["json"])
        self.assertNotIn(candidate["name"], serialized_request)
        self.assertNotIn(candidate["resume_text"], serialized_request)
        self.assertNotIn("partial_01", serialized_request)
        self.assertNotIn("unit-test-secret", serialized_request)
        self.assertEqual(result["agents"][0]["evidence_ids"], ["ev_03"])
        self.assertEqual([item["agent"] for item in result["agents"]], ["Market Scout", "Candidate Twin"])

    def test_provider_status_requires_an_explicit_opt_in_and_never_returns_the_key(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-secret", "USE_GENERATIVE_AI": "false"}, clear=False):
            self.assertFalse(available())
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-secret", "USE_GENERATIVE_AI": "true"}, clear=False):
            self.assertTrue(available())
            status = public_status()
        self.assertTrue(status["available"])
        self.assertNotIn("test-secret", str(status))
        self.assertTrue(status["consent_required"])

    def test_generative_mode_emits_review_only_guidance_without_bypassing_qa(self):
        run = RunStatus(id="generative-test", status="queued", selected_job_id=self.job["id"], mode="generative")
        generated = {
            "provider": "Gemini", "model": "gemini-flash-lite-latest", "agents": [
                {"agent": "Market Scout", "brief": "Direct backend evidence is strong; keep the Kubernetes gap explicit.", "evidence_ids": ["ev_03", "ev_04"]},
                {"agent": "Candidate Twin", "brief": "Lead with the FastAPI service and its documented workflow impact.", "evidence_ids": ["ev_03"]},
                {"agent": "HR Interrogator", "brief": "Verify deployment ownership without treating Docker as Kubernetes proof.", "evidence_ids": ["ev_04"]},
                {"agent": "Resume Surgeon", "brief": "Prioritize source-linked backend outcomes rather than adding missing platform claims.", "evidence_ids": ["ev_02", "ev_03"]},
            ],
        }
        with patch("app.main.generative_available", return_value=True), patch("app.main.generate_guidance", return_value=generated), patch("app.main.asyncio.sleep", new=AsyncMock()):
            asyncio.run(execute_mission(run, self.job, self.candidate, "generative"))
        self.assertEqual(run.status, "awaiting_approval")
        generative_events = [event for event in run.events if event.type == "generative_guidance"]
        self.assertEqual(len(generative_events), 4)
        self.assertTrue(all(event.payload["review_only"] for event in generative_events))
        self.assertTrue(run.result["generative_guidance"])
        self.assertTrue(run.result["export_readiness"]["passed"])
        self.assertTrue(run.result["patches"])

    def test_run_schema_accepts_explicit_generative_mode(self):
        self.assertEqual(RunCreate(job_id="role", mode="generative").mode, "generative")
