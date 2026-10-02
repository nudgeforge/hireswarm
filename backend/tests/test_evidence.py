import copy
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data import DEMO_CANDIDATE, DEMO_JOBS
from app.evidence import build_interview, build_safe_patches, extract_evidence_from_resume, score_job, validate_patches


class EvidenceEngineTests(unittest.TestCase):
    def setUp(self):
        self.candidate = copy.deepcopy(DEMO_CANDIDATE)
        self.job = copy.deepcopy(DEMO_JOBS[0])

    def test_backend_role_detects_direct_strengths(self):
        match = score_job(self.job, self.candidate)
        verified = {entry["skill"] for entry in match["verified_strengths"]}
        self.assertIn("FastAPI", verified)
        self.assertIn("Docker", verified)

    def test_kubernetes_remains_an_evidence_gap(self):
        match = score_job(self.job, self.candidate)
        gaps = {entry["skill"] for entry in match["gaps"]}
        self.assertIn("Kubernetes", gaps)

    def test_document_patches_are_evidence_linked(self):
        match = score_job(self.job, self.candidate)
        patches = build_safe_patches(self.job, self.candidate, match)
        result = validate_patches(patches, self.candidate)
        self.assertGreaterEqual(len(result["safe_patches"]), 2)
        self.assertTrue(result["all_claims_linked"])

    def test_interview_has_truthful_partial_response(self):
        match = score_job(self.job, self.candidate)
        turns = build_interview(self.job, self.candidate, match)
        kubernetes = next(turn for turn in turns if turn["requirement"] == "Kubernetes")
        self.assertEqual(kubernetes["status"], "PARTIAL")

    def test_short_alias_inside_an_ordinary_word_never_becomes_llm_evidence(self):
        statement = "Maintained documentation and coordinated releases for a student platform."
        evidence = extract_evidence_from_resume(statement)
        extracted_skills = {skill for item in evidence for skill in item["skills"]}
        self.assertNotIn("LLM applications", extracted_skills)
        candidate = {
            "evidence": [{
                "evidence_id": "cv_01", "source_section": "Experience", "source_text": statement,
                "skills": [], "status": "verified",
            }]
        }
        match = score_job({"must_have": ["LLM applications"], "preferred": []}, candidate)
        self.assertEqual(match["score"], 0)
        self.assertEqual(match["coverage"], 0)
        self.assertEqual(match["verified_strengths"], [])

    def test_generic_technical_words_do_not_upgrade_to_specific_tool_proof(self):
        statement = "Designed an API-first frontend with container architecture and code reviews."
        candidate = {"evidence": [{
            "evidence_id": "cv_01", "source_section": "Experience", "source_text": statement,
            "skills": [], "status": "verified",
        }]}
        job = {"must_have": ["REST APIs", "React", "Docker", "Git"], "preferred": []}
        match = score_job(job, candidate)
        self.assertEqual(match["verified_strengths"], [])
        self.assertEqual(match["score"], 0)
        self.assertEqual(match["coverage"], 0)


if __name__ == "__main__":
    unittest.main()
