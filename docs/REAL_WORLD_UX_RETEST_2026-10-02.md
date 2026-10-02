# HireSwarm — Real-World UX Retest

**Date:** 2026-10-02  
**Environment:** production Next.js build on port 3000, FastAPI Evidence Lab on port 8000  
**Scope:** post-redesign header controls, clear practice/live data boundaries, responsive behavior, and a complete applicant-controlled application workflow.

## What was verified

### Service and proxy health

| Check | Result |
|---|---|
| `GET /healthz` on FastAPI | `200` — Evidence Lab healthy |
| `GET /backend/healthz` through Next.js rewrite | `200` — browser-safe relative proxy works |
| Next.js production workspace | `200` and renders HireSwarm |
| TypeScript validation | Passed |
| Next.js optimized production build | Passed |

### Header and orientation controls

A Playwright browser audit verified all of the following in the rendered production UI:

- **How it works** opens a real four-step testing guide, including a direct path to CV import.
- The engine selector opens as a menu, switches between **Evidence Lab** and **CrewAI relay**, and explains the free-provider fallback boundary.
- **Find live roles** opens the public-source workflow rather than behaving as decorative header text.
- **Paste role** opens a functional job-description form.
- The default practice fixture’s primary action says **Find a real role** and explicitly explains why it is not a real application target.
- Sidebar **Applications**, **Practice**, and **Workspace** controls update the active state and navigate to their corresponding workspace areas.
- The redesigned header and onboarding elements remain within a 390 px mobile viewport with no horizontal overflow.
- No browser console errors or page errors occurred during the audit.

### Controlled end-to-end applicant workflow

A complete browser run used a deliberately labeled, applicant-provided test role (`Backend API Developer` at `Northstar Labs`) with Python, FastAPI, REST API, React-collaboration, and Git requirements. It was a safe controlled input, **not** represented as a live job.

| Step | Expected product behavior | Result |
|---|---|---|
| Paste target | Add role title, company, URL, and description | Passed |
| Provenance | Target card shows `Applicant-provided` | Passed |
| Primary CTA | Non-fixture target offers `Run a focused rehearsal` | Passed |
| Evidence rehearsal | FastAPI run streams through evidence evaluation to review | Passed |
| Human gate | `I've reviewed this packet` appears before export | Passed |
| Pre-approval safety | No document-download control is available before approval | Passed |
| Approval | Explicit candidate review unlocks exports | Passed |
| Export | Actual `HireSwarm_Approved_Application.docx` browser download generated | Passed |
| Client errors | No browser console/page errors | Passed |

## Exact user test route

1. Start on the workspace. The opening target is visibly a **Practice fixture**; use it only to explore the interface.
2. Select **How it works** for the in-product checklist.
3. Open the profile avatar or **01 Import your CV**. Upload a text-based PDF, DOCX, or TXT CV. Use a non-sensitive copy.
4. Select **Refresh evidence** and review the extracted evidence notes.
5. Select **Find live roles** for a public feed/official board, or choose **Paste role** and paste a job listing you trust. For the paste route, include the official HTTPS URL when available.
6. Confirm that the selected target is labeled **Live public listing** or **Applicant-provided**, not `Practice fixture`.
7. Click **Run a focused rehearsal**. Inspect direct strengths, adjacent evidence, and gaps. A gap must not turn into a claim.
8. Review proposed edits and the document-QA note. Select **I've reviewed this packet** only when the text is true.
9. Download the approved document if wanted, then use **Open official listing** to apply manually.

## Product boundary retained

HireSwarm reads public roles and prepares evidence-bound documents. It does not use employer credentials, autofill third-party application forms, rank candidates for an employer, or auto-submit applications.
