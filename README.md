# HireSwarm

> **An applicant-controlled, evidence-locked application workspace.**
>
> HireSwarm lets a candidate start with a published job listing and their own CV, build a source-linked proof ledger, rehearse the hard questions, make truthful role-specific edits, and export only after a human approval gate.

![Stack](https://img.shields.io/badge/stack-Next.js%20%2B%20FastAPI%20%2B%20CrewAI-27789b)
![Cost](https://img.shields.io/badge/default%20cost-%240-398f70)
![Safety](https://img.shields.io/badge/claims-evidence--locked-b85d4e)

## The product thesis

Job trackers, keyword matchers, and generic AI resume writers already exist. HireSwarm is deliberately narrower and more defensible:

- **A claim compiler, not a keyword stuffer.** Every suggested resume line and cover-letter draft retains the evidence IDs from the applicant's CV.
- **An interview consistency check, not a static score.** The Candidate Twin answers only from the same evidence that backs a document edit; the HR Interrogator exposes direct, adjacent, and missing proof.
- **Source-aware by design.** A role is visibly marked as a practice fixture, user-pasted brief, or live public listing, with its official link preserved.
- **Applicant-controlled.** The app reads public jobs and creates an approved document; it never logs into a job board, autofills a third-party form, or submits an application.
- **Honest about ATS readiness.** It performs a real text-extraction round trip on its own single-column PDF export. It does **not** pretend to know an employer's proprietary ATS ranking algorithm.

Read the research, category gap, and source-policy rationale in [`docs/RESEARCH_AND_PRODUCT_DECISIONS.md`](docs/RESEARCH_AND_PRODUCT_DECISIONS.md).

## What is genuinely functional

| Workflow | What happens in the working product |
|---|---|
| **CV import** | Upload a text-based `.pdf`, `.docx`, or `.txt` CV (up to 6 MB). FastAPI extracts text in memory, creates conservative evidence nodes, and does not retain the source binary. Editing resume text clears the old ledger until the applicant explicitly refreshes it. Scanned/image-only PDFs fail clearly rather than inventing text. |
| **Published job discovery** | User-triggered public discovery through Remotive and Arbeitnow. Remotive responses are cached for six hours to respect its low-frequency guidance. Source outages return an explicit error — never a disguised fixture. |
| **Official public ATS boards** | Paste a public Greenhouse or Lever board URL/token. HireSwarm reads their documented published-posting feeds without employer credentials and keeps the official application URL. |
| **Bring your own role** | Paste any job description and optional full `http(s)` official URL. It stays labeled **Pasted by you**; unsafe URL schemes are rejected before a browser can open them. |
| **Four-role workflow** | Market Scout maps requirements; Candidate Twin binds answers to proof; HR Interrogator challenges boundaries; Resume Surgeon prepares evidence-linked revisions. Optional CrewAI narration can enrich the run, but deterministic validation remains authoritative. |
| **Document QA and export** | After the role-specific evidence run, the app renders a one-column PDF, extracts its text back with `pypdf`, and records the check. A run with no direct role-relevant source sentence stops in **needs evidence** rather than producing a generic packet. The user must approve before downloadable `.docx` and printable `.pdf` exports unlock. |

## Trust labels and data boundaries

| Label in the UI | Meaning |
|---|---|
| **Practice fixture** | Deterministic offline sample data for a no-key demo. Never described as a real opening. |
| **Live public listing** | A current result fetched from a published public feed or official public board. The role preserves source, link, and retrieval/cache state. |
| **Pasted by you** | Candidate-provided role text. The candidate chooses whether to include a source URL. |

The default workspace begins on labeled practice data so judges can demo without network/API keys. It is never presented as an application target: its primary action directs the candidate to **Find live roles** or **Paste role** before preparing a real packet.

### Exact real-data test — no account or API key needed

1. Open the app and select **How it works** in the header if you want the in-product checklist.
2. Click **Your profile** (the avatar) or **01 Import your CV**. Upload a text-based `.pdf`, `.docx`, or `.txt` CV — ideally a copy with contact details you are comfortable using. The source file is parsed in memory for the session; it is not retained.
3. Click **Refresh evidence**, then confirm the evidence count and source-backed snippets look right. If you edit the pasted CV text, refresh before proceeding.
4. Choose one role route:
   - **Paste role**: copy a public job description you trust, add its official `https://` link if available, then select **Add to shortlist**. The UI will call it **Pasted by you**.
   - **Find live roles**: search a public Remotive/Arbeitnow feed, or connect one public Greenhouse/Lever board. The UI preserves whether results are fresh or cached and retains their source link.
5. Select the non-practice target and click **Run a focused rehearsal**. Watch the four roles identify direct proof, adjacent experience, and gaps. A missing skill should remain a gap rather than become a claim.
6. In **Tailor**, review every suggested line and its evidence IDs. In **Review**, check the document QA note.
7. Select **I've reviewed this packet** only if the material is truthful. That explicit action unlocks `.docx` and PDF downloads. Open the official listing and apply yourself; HireSwarm never submits an application.

**Safe testing:** use a non-sensitive CV version and a copied public listing. Do not include passwords, government-ID details, bank information, or confidential employer material.

## Fastest local launch

### Terminal 1 — FastAPI

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# Optional provider-backed narration only:
# pip install -r requirements-crewai.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Terminal 2 — Next.js

```bash
cd frontend
npm ci
BACKEND_URL=http://127.0.0.1:8000 npm run dev
```

Open `http://localhost:3000`.

## A credible 90-second live demo

1. Open **Find live roles** and either search `Python developer`, or connect a public Greenhouse/Lever board such as a public board URL.
2. Point out the source badge and the official listing link. This is read-only discovery, not scraping or auto-apply.
3. Open **Your profile** and import a real text-based CV. Show the in-memory/no-retention note and evidence count.
4. Select a live role and click **Run a focused rehearsal**.
5. Let the event stream show Market Scout, Candidate Twin, HR Interrogator, and Resume Surgeon. Pause on an unsupported/adjacent requirement: HireSwarm keeps the gap visible rather than manufacturing experience.
6. In **Tailor**, open an edit and show its evidence IDs.
7. In **Review**, call out the real PDF text round-trip check, approve the packet, and download `.docx` or `.pdf`.
8. Finish by opening the official listing yourself. HireSwarm intentionally leaves the application submission under the candidate's control.

## API surface

| Endpoint | Purpose |
|---|---|
| `POST /api/candidate/upload` | In-memory `.pdf` / `.docx` / `.txt` CV import and evidence extraction. |
| `POST /api/candidate/normalize` | Refresh evidence from edited resume text. |
| `GET /api/jobs?mode=demo` | Clearly labeled no-key practice fixtures. |
| `GET /api/jobs/live?query=python&source=all` | User-triggered published feed discovery (`all`, `remotive`, or `arbeitnow`). |
| `POST /api/jobs/public-board` | Read a public Greenhouse or Lever board: `{"source":"greenhouse","board":"boards.greenhouse.io/company"}`. |
| `POST /api/jobs/manual` | Store a candidate-pasted job description for the session. |
| `POST /api/runs` + `GET /api/runs/{id}/events` | Start a real asynchronous evidence run and observe typed SSE events. |
| `POST /api/runs/{id}/approve` | Explicit human approval gate. |
| `GET /api/runs/{id}/export/{docx|pdf}` | Approved, ATS-conscious exports only. |

## Zero-cost operating modes

| Mode | Cost | What runs |
|---|---:|---|
| **Evidence Lab (default)** | $0 | Deterministic matching, evidence validation, typed SSE events, interview state, source-linked patches, document QA, and approval gate. No API key is required. |
| **CrewAI + Groq/Gemini** | $0 within free-tier quotas | Optional provider-backed narration for the four CrewAI roles. The Python validator remains authoritative. |
| **Local fallback** | $0 | Use Ollama with an open model if cloud free-tier inference is unavailable. |

The default path is not a prerecorded animation: the browser starts an actual FastAPI mission, the backend calculates direct coverage, emits structured events, validates each patch, renders a PDF for extraction QA, and waits for approval.

## Test and build

```bash
cd backend
python -m unittest discover -s tests -v

cd ../frontend
npm ci
npm run typecheck
BACKEND_URL=http://127.0.0.1:8000 npm run build
```

The backend test suite covers direct/adjacent evidence behavior, verified-only proof, stale-ledger clearing, duplicate/irrelevant-patch blocking, the no-evidence export stop, safe manual URLs, public-board URL parsing, CV text import, real `.docx` output, and PDF text round-trip readiness. See [`docs/FINAL_QUALITY_AUDIT.md`](docs/FINAL_QUALITY_AUDIT.md) for the broader audit record, [`docs/RESILIENCE_AND_COMMAND_SURFACE_RETEST_2026-10-02.md`](docs/RESILIENCE_AND_COMMAND_SURFACE_RETEST_2026-10-02.md) for JSON-failure coverage, and [`docs/RESPONSIVE_AND_WORKFLOW_REPAIR_2026-10-02.md`](docs/RESPONSIVE_AND_WORKFLOW_REPAIR_2026-10-02.md) for the latest rendered responsive and workflow repair.

## Repository layout

```text
hireswarm/
├── frontend/
│   └── app/
│       ├── page.tsx                 # Applicant workspace, resilient API client + command header
│       ├── spatial.css              # Original responsive workspace layer
│       ├── premium.css              # Current tactile spatial/3D command-surface layer
│       └── usability-fix.css        # Final responsive, touch-target, and review-contrast repair layer
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI routes, SSE runner, upload/export gate
│   │   ├── sources.py               # Legal public-feed and public-ATS connectors
│   │   ├── documents.py             # DOCX/PDF rendering and extraction QA
│   │   ├── evidence.py              # Deterministic matching and claim validation
│   │   └── crewai_engine.py         # Optional CrewAI role definitions
│   └── tests/                       # Offline evidence, import, connector and export tests
├── docs/
│   └── RESEARCH_AND_PRODUCT_DECISIONS.md
├── render.yaml
└── docker-compose.yml
```

## Public-source policy

- Read only published, documented public endpoints: Remotive, Arbeitnow, Greenhouse Job Board API, and Lever Postings API.
- Never scrape or automate login-protected LinkedIn, Indeed, Glassdoor, Workday, or authenticated ATS portals.
- Never submit an external application. Greenhouse/Lever application POST paths require employer credentials and are intentionally out of scope.
- Cache low-frequency sources, surface retrieval state and connector failures, and retain direct source/apply links.
- Keep raw CV binaries out of persistence and logs. The starter uses volatile in-memory run state; use the supplied Supabase schema only with appropriate retention and RLS policies.

## Deploy with $0 services

For the full click-by-click GitHub → Render → Vercel setup, environment-variable values, first-live-test checklist, and troubleshooting, see [`docs/GITHUB_TO_LIVE_DEPLOYMENT.md`](docs/GITHUB_TO_LIVE_DEPLOYMENT.md). If you prefer not to use Vercel, use the two-service Render setup in [`docs/RENDER_ONLY_LIVE_DEPLOYMENT.md`](docs/RENDER_ONLY_LIVE_DEPLOYMENT.md).

### Backend — Render Free

1. Push the repository to GitHub.
2. Create a Render Blueprint or Web Service from `render.yaml`.
3. Use root `backend`, build command `pip install -r requirements.txt`, and start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
4. Warm `/healthz` before judging because free instances can sleep.

### Frontend — Vercel Hobby

1. Import the repository, using `frontend` as the root directory.
2. Set `BACKEND_URL` to the FastAPI public URL at build/runtime.
3. Keep browser calls on the relative `/backend` rewrite; do not expose a localhost URL to deployed clients.

### Optional persistence — Supabase Free

The MVP deliberately works without a database. For persistence, run `supabase/schema.sql` in Supabase SQL Editor. Use short retention, RLS, and do not persist original CV binaries by default.

## Important safety constraints

- No hiring decision or employer-side candidate ranking.
- No protected-attribute inference.
- No claim without evidence IDs.
- No hidden source substitution: a failed live connector is visibly failed, not made to look live.
- No auto-apply, browser automation, or employer credentials.
- Human approval is required before export; final application submission is always the applicant's action.
