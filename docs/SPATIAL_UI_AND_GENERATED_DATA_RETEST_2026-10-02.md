# HireSwarm — Spatial UI Upgrade & Generated-Data Retest

**Date:** 2 October 2026 (Asia/Karachi)  
**Scope:** Modern 2026 visual UX, perceived speed, source safety, generated applicant data, real browser workflows, and external-source smoke tests.

## Result

**PASS — 35 backend tests, production frontend build, 0 npm audit vulnerabilities, and a full generated-data browser journey completed successfully.**

This pass followed the evidence-first reliability audit. It is not a styling-only pass: the generated test data exposed one interview-priority defect and one evidence-label defect, both of which were repaired and covered by regression tests.

---

## 1. What changed in the UI

The interface was upgraded to a **quiet spatial / 3D career studio**, not a neon sci-fi dashboard:

- Layered, physical card depth: soft elevation, inner highlight, grounded shadows, and pressed button states.
- A small CSS-only **evidence-status orbital** in the hero area gives the workspace a distinct 3D focal point without loading an image, canvas, video, WebGL, or a runtime 3D package.
- Contextual hero chips now show the real count of verified evidence notes and the applicant-controlled export boundary.
- Shortlist cards, company seal, fit orbit, modal surfaces, review state, evidence vault, and controls use consistent tactile depth.
- Motion is limited to transform/opacity-friendly interactions and a small mapping-state orbital animation. `prefers-reduced-motion` disables animations and transitions.
- The costly header blur was removed; the app uses opaque/translucent layered surfaces instead.
- No external design asset or font was added. The production app stays lightweight and works in a sandboxed/offline preview.

## 2. Speed and package hardening

| Check | Result |
|---|---:|
| Local production navigation DOM content loaded | **35 ms** in the browser retest |
| Local production load event | **152 ms** in the browser retest |
| Resources on first local page load | **9** |
| Production route payload | Static route; no visual runtime dependency added |
| `npm audit` after package hardening | **0 vulnerabilities** |
| Frontend framework | Updated from Next 15.5.27 to **Next 16.3.8** |
| TypeScript check | PASS |
| Production Turbopack build | PASS |

The timing values are local sandbox measurements, not a promise about an external mobile network. The key performance design decision is structural: no animation library, no remote font, no 3D engine, no video, and no large visual asset was added.

## 3. Generated-data test fixture

A richer deterministic applicant, **Zara Siddiqui**, was added to the test matrix. Her source statements include:

- Python REST APIs with FastAPI and PostgreSQL
- Dockerized delivery workflow
- React and TypeScript operations console
- Terraform modules and handover documentation

The corresponding generated platform target contains direct requirements plus a Kubernetes boundary. The matrix checks direct proof, adjacent proof, truthful gaps, literal patches, interview questions, server document QA, and controlled manual-role extraction.

## 4. Faults found and fixed in this pass

### A. A later meaningful gap could be absent from the compact interview

**Found with generated data:** A job with more than four requirements could show only the first four direct strengths during the four-question rehearsal, while a later Kubernetes gap was left unchallenged.

**Fix:** Generic interview selection now reserves a compact prompt for a later requirement with no direct proof. It prioritizes a later must-have gap; if those are all covered, it surfaces a later preferred gap instead of spending all prompts on already-proven requirements.

**Regression:** The generated candidate test confirms Kubernetes appears as a truthful `PARTIAL` / gap prompt.

### B. Evidence output rendered `Typescript` instead of the conventional `TypeScript`

**Fix:** Added canonical TypeScript and JavaScript evidence labels to the shared evidence presentation map.

**Regression:** Resume normalization with generated source text now returns `TypeScript` exactly.

### C. Frontend dependency audit had upstream vulnerabilities

**Finding:** The prior Next 15 dependency graph had one moderate and two high npm audit findings.

**Fix:** Upgraded to Next 16.3.8, rebuilt, and re-audited.

**Result:** `npm audit` reports **0** vulnerabilities in the shipped dependency graph.

---

## 5. Browser workflow that passed

The production Next.js build was exercised through a real Chromium browser after the spatial UI work:

1. Confirmed the 3D evidence-status orbital renders with actual composited depth.
2. Confirmed all four fixture jobs remain reachable after the redesign.
3. Opened and dismissed the target modal with Escape.
4. Uploaded the generated Zara resume text through the real file-input UI.
5. Confirmed four extracted evidence notes in the modal ledger.
6. Ran a full Evidence Lab rehearsal for that generated applicant.
7. Confirmed the run reached human approval.
8. Opened the interview view and verified a later Kubernetes gap was surfaced.
9. Confirmed server document QA appeared before approval.
10. Approved and downloaded both DOCX and PDF packets.
11. Added a generated manual role with Terraform/Airflow requirements and verified controlled extraction.
12. Submitted an invalid public Greenhouse host and saw visible user-facing feedback.
13. Checked 390px mobile layout: no horizontal page overflow.
14. Completed with no unexpected browser console errors. The deliberately rejected public-board request produced an expected HTTP 422 only.

## 6. API and live-source checks that passed

| Path | Result |
|---|---|
| `/healthz` | 200 / healthy |
| Remotive Python discovery | 5 normalized public roles during this retest |
| Arbeitnow Python discovery | 18 normalized public roles during this retest |
| Greenhouse official board `stripe` | 50 published roles during this retest |
| Lever official board `metabase` | 19 published roles during this retest |
| Invalid public-feed source | Clear 422 validation response |
| CrewAI mode with no provider key | Explicit `crewai_fallback`, then safe human-approval state |

Counts are intentionally informational and may change with public source availability or rate limiting. The product does not substitute a fixture for a failed live-source request.

## 7. Test suite result

```text
Ran 35 tests in 0.218s
OK
```

The suite now includes `tests/test_demo_matrix.py`, which exercises generated rich evidence, no-relevant-proof behavior, full deterministic Evidence Lab output, controlled taxonomy extraction, and the later-gap interview selection rule.

## 8. Current honest limits

- Public APIs can rate-limit, change content, or be unavailable. Results are shown with source/provenance rather than fabricated.
- Run and pasted-role state is in process memory in this $0 local configuration; a production account system should add authenticated encrypted persistence and retention controls.
- CrewAI narration needs a user/deployer-provided free-provider key. The no-key Evidence Lab remains fully functional and authoritative for truth/evidence checks.
- HireSwarm prepares packets only. It intentionally does not submit an external job application.

## 9. Files changed in this pass

- `frontend/app/page.tsx` — evidence-status orbital and real evidence/control status in the hero.
- `frontend/app/spatial.css` — modern lightweight 3D/spatial design layer and reduced-motion support.
- `frontend/app/layout.tsx` — loads the spatial layer.
- `frontend/package.json` / `frontend/package-lock.json` — Next 16.3.8 security update.
- `backend/app/evidence.py` — later-gap interview selection and canonical TypeScript/JavaScript labels.
- `backend/tests/test_demo_matrix.py` — generated-data workflow matrix.

**Bottom line:** The UI is now visibly more contemporary and tactile while staying calm, accessible, asset-light, and fast. The test pass covered both polished presentation and the evidence/approval mechanics behind it.
