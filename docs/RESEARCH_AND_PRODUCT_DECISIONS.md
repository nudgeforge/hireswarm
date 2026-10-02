# HireSwarm: research-led product decisions

**Research snapshot:** 2 October 2026  
**Question:** How can a $0 career product be useful enough to feel real — without becoming another generic resume checker, a fake job board, or an unsafe auto-apply bot?

## Executive conclusion

The category is crowded at three obvious layers:

1. **Job-search CRM / trackers** organize saved roles, statuses, contacts, and documents.
2. **Resume scanners** compare a CV and job description, then display a match score and missing-keyword list.
3. **AI application generators** draft bullets, cover letters, and interview answers at high volume.

Those capabilities are useful, but they leave a dangerous gap: the candidate can receive a high score or polished sentence with no way to see whether they could truthfully defend it in an interview. HireSwarm's wedge is therefore **evidence continuity**:

> A sentence is eligible for an application only if the candidate's evidence ledger can support it; the same ledger must support the answer when the role is challenged in an interview rehearsal.

That makes the four-agent structure useful rather than decorative. The agents operate as readable workflow roles around a deterministic proof boundary, not as an opaque swarm producing confidence theater.

---

## Category map: what is already solved

| Category | Mature product behavior | Why copying it is not enough |
|---|---|---|
| Job tracker / career CRM | Save listings, track stages, record contacts and reminders, often with a browser clipper. | Tracking does not prove that a tailored claim is true or that a CV and interview answer agree. |
| ATS/keyword scanner | Compare a resume to a job description and present a percentage, keyword gaps, and formatting tips. | A match rate is a heuristic, not an employer ATS simulation or a prediction of interviews. It can reward keyword insertion rather than evidence. |
| AI resume / cover-letter writer | Generate role-specific language quickly. | Unbounded generation can fabricate scope, metrics, seniority, or tool ownership; generic output also makes candidates sound interchangeable. |
| Auto-apply tool | Optimize application volume. | Requires brittle automation, can conflict with job-board terms, creates privacy risks, and removes judgment at the most consequential step. |

This is also why HireSwarm avoids a generic 0–100 “ATS score.” Its **coverage** metric means only “how many selected requirements have direct evidence,” and adjacent experience remains visibly distinct. Its export check means only “the PDF text could be extracted back,” not “this will beat an employer's ATS.”

### Design implication

Do not compete on “one more checker” or “one more dashboard.” Compete on a **trustable application packet**:

- source provenance for the target role;
- candidate-owned source evidence for each claim;
- an adversarial rehearsal that uses that same proof;
- reversible, human-reviewed document edits;
- a readable export and a final applicant-controlled submission step.

---

## Findings that shaped the build

### 1. Real job connectivity must be legal, documented, and clearly labeled

| Source | What research says | Product decision |
|---|---|---|
| [Remotive public jobs API](https://github.com/remotive-com/remote-jobs-api) | Public remote jobs feed; project guidance asks consumers to keep request frequency very low (up to four requests/day). | User-triggered discovery only; results are cached for six hours. A source outage displays an error, never practice data disguised as a live role. |
| [Arbeitnow Job Board API](https://www.arbeitnow.com/blog/job-board-api) | A documented, no-key public job feed, largely sourced from employer ATS systems. | Add a second no-key discovery path rather than making a single aggregator look like a full market index. |
| [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html) | Published postings can be read with unauthenticated `GET` for a known public board token. `content=true` exposes role content. Applying requires the employer-side API key. | Accept a user-pasted public board URL/token, read only published listings, retain `absolute_url`, and never call an application endpoint. |
| [Lever Postings API](https://github.com/lever/postings-api) | Published postings can be read with unauthenticated `GET /v0/postings/{site}?mode=json`; application creation requires customer credentials. | Same read-only board connector, direct application URL retained, no credentials and no submission automation. |

**Implementation:** `backend/app/sources.py` normalizes these sources to one job shape while preserving origin, source label, role URL, and retrieval/cache state. It strips public description markup as data rather than executing it. Connector errors are returned as errors.

### 2. Applicant data deserves a local-first, minimal-retention path

Career documents can contain contact information, employment history, and references. University career guidance recommends treating GenAI as a starting point, reviewing every claim in the candidate's own voice, and avoiding unnecessary sensitive employer/personal information in third-party systems: [University of Michigan resume resources](https://careercenter.umich.edu/article/resume-resources).

**Implementation:**

- The CV uploader accepts only `.pdf`, `.docx`, and `.txt`, uses a 6 MB ceiling, and parses the binary in memory.
- It returns only the reviewable candidate data/evidence to the current session; it does not retain an original upload file.
- Image-only/scanned PDFs fail explicitly instead of generating imaginary evidence.
- The UI repeats this boundary before upload.
- The default project uses volatile run state. Optional Supabase persistence is deliberately documented as a production extension with RLS and short retention, not a hidden default.

### 3. “ATS-safe” should be a measurable check, not marketing

No client application can honestly simulate a company's private ATS configuration or recruiter decision. It can, however, avoid common structural hazards and test the file it generates.

**Implementation:** `backend/app/documents.py` exports a linear, one-column PDF and DOCX with headings and bullets; then `pypdf` extracts text from the generated PDF. The UI shows a **Document QA** result only after this actual round trip. The test validates name/heading extraction from the real bytes.

The product language is intentionally **“export readiness”**, never “ATS guaranteed,” “pass rate,” or “interview probability.”

### 4. Human approval must be a system boundary, not an afterthought

The documented Greenhouse and Lever write paths require employer-side credentials. Apart from legal/technical reasons not to use those routes, the applicant should decide whether a sentence sounds like them and whether a role is appropriate before any export or submission.

**Implementation:**

- Every patch must have `evidence_ids` before the application review state opens.
- The API refuses `.docx` / `.pdf` export until `POST /api/runs/{id}/approve` changes the run to `approved`.
- The UI's official-listing button stays separate from download; it opens the source in a new tab and never applies automatically.

### 5. Optional AI needs deterministic guardrails

[FastAPI](https://fastapi.tiangolo.com/) gives the project typed, streamable routes without paid infrastructure. [CrewAI](https://docs.crewai.com/en/installation) is open-source and can run locally or with a free-tier inference provider. Free providers are quota/rate-limited, so a product that works only while a model call succeeds is fragile in a hackathon demo.

**Implementation:**

- The default Evidence Lab works with no API key and still runs live backend computation, SSE events, matching, claim validation, document generation, and approval state.
- The optional CrewAI relay explicitly falls back when a free-provider key is absent/unavailable.
- Model narration can enrich a run; it cannot override source-linked validation in `evidence.py`.

---

## Product system: why the agents matter

| Role | Input | Legible output | Hard boundary |
|---|---|---|---|
| **Market Scout** | Published/pasted role + evidence ledger | Direct strengths, adjacent evidence, true gaps, coverage | Cannot turn related experience into direct proof. |
| **Candidate Twin** | Evidence ledger | Role-specific interview answer with evidence IDs | Cannot answer from a claim that is not in the ledger. |
| **HR Interrogator** | Requirement + Candidate Twin answer | Supported / partial / unsupported verdict | Challenges scope and keeps gaps visible. |
| **Resume Surgeon** | Validated strengths + target language | Resume priorities and cover-letter draft, each with evidence IDs | Cannot emit a patch that fails deterministic validation. |
| **Document QA** | Approved-pending packet | PDF text-extraction readiness check | Does not claim proprietary ATS prediction. |
| **Applicant** | All evidence, revisions, and gaps | Explicit approval and manual application | Owns the final decision and external submission. |

This creates a compelling live moment: a role asks for Kubernetes, the candidate has Docker experience, and the system displays both the adjacent context **and** the unfilled Kubernetes gap. The product becomes credible precisely because it refuses the tempting, flattering rewrite.

---

## Implementation inventory (shipped)

- `backend/app/sources.py`
  - Remotive discovery with cache-aware handling.
  - Arbeitnow discovery.
  - User-pasted Greenhouse board and Lever board connectors.
  - Public description cleaning, normalized provenance, direct official URL retention.
- `backend/app/main.py`
  - CV import endpoint; manual/public/live job endpoints; SSE mission runner; approval-gated exports.
  - Explicit live-source failures rather than fixture substitution.
- `backend/app/documents.py`
  - Real OOXML `.docx`, printable `.pdf`, and PDF extraction verification.
- `frontend/app/page.tsx`
  - Source-picker, CV-import privacy UX, source/status labeling, document QA, human approval, direct official-listing link.
- `backend/tests/test_real_workflows.py`
  - Offline tests for board URL parsing, conservative import, verified-only evidence, stale-ledger clearing, role relevance, duplicate-bullet protection, explicit `needs_evidence` stopping, valid DOCX/PDF bytes, and PDF text round trip.

---

## What deliberately remains out of scope

| Not included | Why |
|---|---|
| LinkedIn/Indeed/Glassdoor scraping or authenticated portal automation | Terms, stability, privacy, and anti-bot concerns; not required for a trustworthy applicant workspace. |
| Employer-side applicant ranking, hiring recommendations, or protected-trait analysis | HireSwarm assists the applicant only; it is not a hiring system. |
| Automatic external submission | Contradicts applicant control and hides consequential judgment behind automation. |
| A fake “live” job source fallback | Destroys the core provenance promise. Practice fixtures remain useful, but visibly labeled. |
| A generic LLM rewrite treated as truth | The evidence validator is the authority; model language is optional and subordinate. |

---

## Next defensible extensions

These are proposed next steps, not claims that the current build already does them:

1. **Role snapshot/content hash:** retain a candidate-approved hash and timestamp of a public job description so the candidate can see if a listing changed or disappeared.
2. **Public proof links:** user-controlled GitHub/project URL verification, represented as a separate evidence type with a source timestamp.
3. **Application history:** opt-in local/Supabase storage for applied/interviewed/archive stages, tied to the exact exported version and source URL.
4. **Candidate correction loop:** mark an extraction as inaccurate, split evidence, or attach a contextual note before a mission runs.
5. **Evaluation corpus:** anonymized synthetic CV/job pairs with gold labels for direct, adjacent, missing, and unsupported claims; report false-positive/false-negative rates rather than only demo narratives.

The important guardrail for every extension is unchanged: **more automation must not weaken evidence provenance, applicant control, or explicit uncertainty.**
