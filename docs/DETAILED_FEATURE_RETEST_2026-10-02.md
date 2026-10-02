# HireSwarm — Detailed Feature Retest & Reliability Report

> **Follow-up:** the current spatial UI / generated-data retest is documented in [`SPATIAL_UI_AND_GENERATED_DATA_RETEST_2026-10-02.md`](./SPATIAL_UI_AND_GENERATED_DATA_RETEST_2026-10-02.md). The current suite is **35 passing tests**; this earlier report records the preceding 31-test reliability pass.

**Retest date:** 2 October 2026 (Asia/Karachi)  
**Scope:** Fresh local production build, API integration, browser journeys, responsive rendering, real public-source reads, regression tests, and deliberate error/security paths.  
**Overall result:** **Pass with documented external-service and persistence limits.** The core applicant-controlled workflow is working end to end: source/CV → evidence ledger → role selection → interview/tailoring → server-side QA → applicant approval → DOCX/PDF export.

This replaces any implication that a previous smoke test alone was sufficient. The problems discovered during this retest were reproduced, fixed in source, given regression coverage, and retested.

---

## 1. What was actually run

| Check | Result | Evidence |
|---|---:|---|
| Python syntax compilation | PASS | `python -m py_compile app/*.py` completed successfully. |
| Backend regression suite | PASS | **31 tests passed** with `python -m unittest discover -s tests -v`. |
| Frontend type validation | PASS | `npm run typecheck` completed with no TypeScript errors. |
| Production frontend build | PASS | `BACKEND_URL=http://127.0.0.1:8000 npm run build` completed successfully. |
| Browser end-to-end journey | PASS | Playwright drove the production Next.js site through target selection, live discovery, manual role entry, run/SSE workflow, approval, both downloads, CV import, and mobile layout. |
| Browser console check | PASS | The final successful browser journey had no console or page errors. |
| Desktop visual review | PASS | Checked at 1440px-wide desktop viewport. |
| Mobile visual/overflow review | PASS | Checked at 390px width; no horizontal document overflow detected. |
| Live-source integration probe | PASS | Public Remotive, Arbeitnow, Greenhouse (`stripe`), and Lever (`metabase`) reads returned normalized published roles during this retest. |

### Browser journey that passed

The final automated browser run verified all of the following on the production server, rather than merely calling helper functions:

1. The demo shortlist initially summarizes three cards while accurately showing four applications.
2. “Show 1 more role” reveals and allows selection of the fourth demo target.
3. “Adapt this target” pre-fills the currently selected role.
4. Escape closes the modal.
5. A real Remotive search for `python` adds a live role with visible source provenance.
6. A pasted role mentioning Terraform and Airflow produces those controlled requirements rather than a generic fallback.
7. A full Evidence Lab rehearsal reaches the human-approval state.
8. Document QA is shown before approval.
9. Approved DOCX and PDF downloads both complete.
10. A real `.txt` CV upload produces a refreshed evidence ledger.
11. The 390px mobile page has no horizontal overflow.
12. The run completes with no browser console errors.

A separate browser error-path exercise submitted an unrelated Greenhouse host. The API deliberately returned HTTP 422, and the UI displayed the validation message visibly above the modal instead of concealing it behind the overlay. That expected rejection is not counted as a browser failure.

---

## 2. Feature-by-feature status

| Feature | What it does | Status | Retest result / important boundary |
|---|---|---:|---|
| Practice workspace | Opens a labeled, deterministic set of fixture roles and a practice applicant profile. | PASS | Demo API, visual load, and all four fixture cards worked. Fixtures remain visibly labeled as practice data. |
| Shortlist controls | Lets the applicant select a target role and reveal roles beyond the initial compact list. | PASS | The prior fourth-role accessibility defect was fixed. The footer now says how many targets are shown and toggles all targets. |
| Target adaptation | Pre-fills a pasted-role form from the selected role so the applicant can make a new applicant-provided target. | PASS | Browser test confirmed the selected Frontend Engineer details are prefilled. Fixture example URLs are intentionally not carried over as “official” URLs. |
| Manual role entry | Lets the applicant add a role title, employer, location, description, and optional official URL. | PASS | Required title/company/description checks work in browser and API. The description is parsed only against a controlled taxonomy. |
| Manual role vocabulary | Detects reviewed terms such as Terraform, Airflow, Testing, LLM applications, HTML, and CSS. | PASS | API and browser tests confirmed the requested missing vocabulary. Unknown wording falls back to generic requirements instead of invented skills. |
| Demo and public job discovery | Reads explicitly requested jobs from Remotive and Arbeitnow. | PASS, external dependency | During retest: Remotive returned five Python matches, Arbeitnow returned eighteen, and mixed search returned twenty-three. Counts are volatile by source/date. No fixture is substituted when a source has no result. |
| Public ATS board connection | Reads applicant-supplied official Greenhouse or Lever public boards only. | PASS, external dependency | Valid live reads succeeded for Greenhouse `stripe` (50 returned roles) and Lever `metabase` (19 returned roles) during retest. The product only reads listings; it never submits an application. |
| Public-source provenance | Shows source, retrieval/cache state, time, and official listing path for live roles. | PASS | Provenance was verified in the browser after a live Remotive discovery. |
| Public-feed caching | Caches the raw Remotive feed, then filters each request locally; Arbeitnow is fetched only on request. | PASS | Regression verifies a Remotive-only request cannot receive Arbeitnow rows and that a changed query re-filters the raw Remotive cache without a new fetch. |
| Resume text normalization | Converts literal, action-oriented resume statements into a reviewable evidence ledger. | PASS | TXT/PDF/DOCX regression coverage passes; a real text upload in the browser created two reviewable evidence notes. |
| CV privacy behavior | Parses the uploaded binary in memory and does not retain the original file. | PASS (as designed) | The UI states this behavior and the implementation reads the request body in memory. See persistence limitation below for derived in-memory run data. |
| Evidence matching | Separates direct proof, adjacent experience, and gaps for each job requirement. | PASS | New matcher tests confirm ordinary text such as “Maintained documentation…” does **not** become LLM evidence. Generic API/frontend/container/code-review wording also cannot become REST API/React/Docker/Git proof. |
| AI-versus-AI rehearsal | Streams Market Scout, Candidate Twin, HR Interrogator, Resume Surgeon, and validator events; answers are tied to evidence IDs. | PASS | Browser run reached approval through SSE; no browser errors. Unsupported requirements stay visible as gaps. |
| Optional CrewAI mode | Uses configured free-provider CrewAI narration when credentials are supplied; otherwise runs the deterministic Evidence Lab. | PASS in no-key mode | A `mode=crewai` run emitted `crewai_fallback`, then completed to human approval without credentials. Provider-backed narration was not claimed as tested because no Groq/Gemini key was configured. |
| Resume patches | Selects literal, source-linked candidate statements and prioritizes them for the chosen target without inventing achievements. | PASS | Existing and new evidence/patch tests passed. A target with no safe role-specific patch ends in `needs_evidence`, not export-ready. |
| Cover letter | Builds a draft from selected literal evidence and names material gaps rather than fabricating them. | PASS | Regression confirms irrelevant claims do not enter the draft and gaps are explicitly stated. |
| Human approval gate | Keeps export locked until the applicant reviews and approves a QA-passing packet. | PASS | Browser approval worked. API regressions reject packets with no patches or forged evidence IDs even if a stale client-visible QA flag says `passed`. |
| Document QA | Generates a one-column PDF, extracts its text back, checks evidence-linked bullets, and recomputes server-side integrity before approval/export. | PASS | QA appeared in the browser. Live exported PDF began `%PDF`, text extraction contained the candidate name, DOCX began `PK`, and the DOCX opened with the expected applicant text. |
| DOCX and PDF export | Downloads an approved applicant-controlled application packet. | PASS | Browser-triggered downloads and direct binary validation both passed. Failed export responses are now surfaced in the UI rather than silently becoming a broken download. |
| Official application link | Opens only a safe `http`/`https` official listing URL and leaves submission to the applicant. | PASS | Client and server validate web links; demo fixture example links are not presented as official apply links. |
| Error feedback | Shows failed discovery, invalid board, invalid role URL, approval, and export errors to the user. | PASS | Notices now render above modals, so an error is not hidden behind an overlay. Approval/export code also returns server details where available. |
| Modal usability | Supports keyboard escape, initial close-button focus, click-outside close, semantic dialog attributes, and explicit close labels. | PASS | Browser verified Escape; implementation covers the other modal interactions. |
| Responsive layout | Reflows for tablet and mobile widths. | PASS | Desktop visual review and 390px automated overflow check passed. |

---

## 3. Bugs found during this retest and repairs made

### A. Unsafe substring matching could invent LLM experience — **fixed**

**Reproduction:**

> `Maintained documentation and coordinated releases for a student platform.`

The previous `"ai" in text` logic found the letters `ai` inside **Maintained**. It labeled the statement “LLM applications,” then produced an unjustifiably high LLM-role match.

**Repair:**

- Added a centralized, boundary-aware `has_alias()` matcher.
- Replaced raw substring checks in both candidate matching and evidence extraction.
- Removed the overly broad `ai` synonym for `LLM applications`.
- Tightened other potentially misleading generic aliases: plain `API`, `frontend`, `container`, and `code review` no longer upgrade to REST API, React, Docker, or Git proof.
- Added explicit aliases for valid terms such as `dockerized`, `reactjs`, `restful api`, Terraform, Airflow, HTML, CSS, Testing, and LLM terms.
- Added a direct FastAPI → REST APIs **adjacent** relationship. It is helpful context, not falsely direct REST proof.

**Regression coverage:** short-alias false-positive test and generic-technical-word false-positive test both pass.

### B. Only three of four roles were usable — **fixed**

**Reproduction:** the sidebar reported four applications, while only three `.job-tile` elements rendered.

**Repair:** the compact shortlist now provides a “Show N more roles” / “Show fewer roles” control and a visible shown/total count. Browser automation selected the formerly hidden role successfully.

### C. Remotive cache could leak Arbeitnow jobs — **fixed**

**Reproduction:** after cache population, a Remotive-only request could return both providers.

**Repair:** Remotive now caches its raw feed separately and filters that feed per query. Arbeitnow is fetched independently only for requests that include it. Cache-state provenance now accurately reports fresh, cached, mixed, or unavailable.

### D. Pasted roles missed important requirement terms — **fixed**

**Reproduction:** a description with Terraform, Airflow, Testing, LLM applications, HTML, and CSS fell back to generic requirements.

**Repair:** manual-role parsing now calls the shared controlled skill extractor rather than using a small hard-coded list. API and browser tests confirm the corrected extraction.

### E. Arbitrary hosts could be treated as official public boards — **fixed**

**Reproduction:** `https://evil.example/stripe` was interpreted as the Greenhouse board token `stripe`.

**Repair:** Greenhouse accepts only `boards.greenhouse.io` / `job-boards.greenhouse.io`; Lever accepts only `jobs.lever.co`. Tokens are restricted to a safe identifier pattern. Invalid-host feedback is visible in the UI.

### F. A malformed packet could bypass approval readiness — **fixed**

**Reproduction:** a synthetic run with `patches: []` and `awaiting_approval` could be approved.

**Repair:** approval and export both recompute document QA on the server. A second server-side evidence-integrity check verifies every patch still maps to a verified candidate ledger ID. Regressions cover zero-patch and forged-ID packets.

### G. Error messages and failed downloads could be invisible or vague — **fixed**

**Repair:** notices now sit above modal overlays; approval reads the API error detail; document exports are fetched first so rejected/empty export responses show a helpful notice instead of looking like a silent download failure.

---

## 4. Security and truthfulness checks performed

| Scenario | Expected behavior | Result |
|---|---|---:|
| `Maintained` contains letters `ai` | Must not imply LLM work | PASS — no LLM evidence extracted; LLM-only match scores 0. |
| Generic “API-first frontend / container / code reviews” wording | Must not imply REST API / React / Docker / Git proof | PASS — no direct strengths, 0 score/coverage in regression. |
| `javascript:alert(1)` manual URL | Must be rejected | PASS — HTTP 422. |
| `https://evil.example/stripe` board URL | Must be rejected | PASS — HTTP 422 with allowed-host guidance. |
| Untrusted stale `export_readiness: {passed: true}` | Must not unlock malformed packet | PASS — approval returns HTTP 409. |
| Forged patch evidence ID | Must not unlock packet | PASS — approval returns HTTP 409; integrity check fails. |
| Export before applicant approval | Must be rejected | PASS — server enforces approval state. |
| Empty evidence ledger | Must not start packet | PASS — server returns a clear validation error. |
| Unsupported/empty role match | Must not become a generic export | PASS — workflow ends in `needs_evidence`. |

---

## 5. Current operating limits (honest, not hidden)

These are real constraints of the current $0, local demonstration configuration rather than failed tests:

1. **Public job sources are external and volatile.** Remotive, Arbeitnow, Greenhouse, and Lever can rate-limit, change their data, return no roles for a query, or be temporarily unreachable. HireSwarm reports that state and does not replace it with a fake listing. Remotive is cached for six hours to respect its polling guidance.
2. **No configured persistent applicant database/authentication exists in this local build.** Runs, pasted jobs, and packet data live in process memory and are intentionally lost when the backend restarts. That avoids pretending that applicant data is durably stored or secured when no authenticated storage is configured. A production deployment should add applicant-authenticated encrypted storage (for example, a user-owned Supabase project) with a retention/deletion policy.
3. **CrewAI provider narration is optional.** The no-key path was tested and works through deterministic Evidence Lab fallback. A real Groq/Gemini/CrewAI provider pass requires the applicant/deployer to configure a free provider key and remains subject to that provider’s quota and availability.
4. **The product does not apply to jobs automatically.** This is intentional: HireSwarm only helps prepare a packet and offers a safe official listing link. The applicant submits independently.
5. **Document QA is practical, not a commercial ATS certification.** It verifies one-column generation, evidence links, and real PDF text extraction. Different employer systems can still have their own file requirements.
6. **The local preview requires both running processes.** The current sandbox preview is live while the Next.js workspace and FastAPI process remain running. If the hosting sandbox is reset, it needs to be relaunched; that is not a product-side data persistence guarantee.

---

## 6. Files materially changed by this repair

- `backend/app/data.py` — controlled taxonomy, safe whole-term alias matching, and conservative evidence relationships.
- `backend/app/evidence.py` — uses safe alias matcher for resume extraction and candidate matching.
- `backend/app/sources.py` — safe public URL normalization, board-host allowlisting, expanded controlled extraction.
- `backend/app/main.py` — provider-correct caching, robust pasted-role validation, server-side document/evidence integrity gates.
- `backend/app/schemas.py` — bounded manual-role input schema.
- `backend/tests/test_evidence.py` and `backend/tests/test_real_workflows.py` — new regression coverage; suite now has 31 passing tests.
- `frontend/app/page.tsx` — complete shortlist access, target adaptation, safe external opening, visible error handling, robust download errors, and modal accessibility.
- `frontend/app/globals.css` — shortlist footer, responsive behavior, and visible notices above modals.

---

## 7. Bottom line

The product is no longer relying on the previously reproduced unsafe evidence claim, hidden role list, mixed-source cache result, permissive board host handling, limited pasted-role extraction, or approval bypass. The locally running preview has been rebuilt and retested after those repairs.

**Recommended next production step:** wire authenticated, applicant-controlled persistence and retention controls before treating the current local workspace as a multi-session service. Everything else in the stated evidence-first preparation flow is functioning in the tested local configuration.
