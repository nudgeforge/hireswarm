# HireSwarm final-polish audit

_Audited before the visual rebuild on 2026-10-03. This is an engineering checklist, not user-facing product copy._

## What is actually live

- The production UI at the time of audit is a single `CleanApp` client flow rendered by `/`, `/workspace`, `/applications`, `/practice`, and `/documents`.
- The real backend contracts currently available are CV upload/normalization, manual/public jobs, read-only fit analysis, run creation, SSE events, run checkpoint, server-side approval, readiness, and DOCX/PDF export.
- Live public job discovery is backed by Remotive/Arbeitnow (and optional user-requested Greenhouse/Lever boards), with source/cache metadata.
- Approval and export authorization are server enforced. The existing deterministic evidence flow and optional CrewAI path must remain untouched.

## Confirmed functional issues / product gaps

| Priority | Finding | Evidence | Safe resolution |
|---|---|---|---|
| Critical UX | Refresh loses the active candidate, selected job, fit, and run in the active frontend. | `CleanApp` holds all journey data only in React state despite a backend `GET /api/runs/{id}` checkpoint. | Add browser-session recovery that restores only applicant data already supplied in that browser and rehydrates a saved run from the real server checkpoint/events. |
| Critical UX | `/workspace`, `/applications`, `/practice`, and `/documents` all render the same initial journey with no route-specific information architecture. | Every public route re-exports `CleanApp`. | Add a real shell and route-aware views while retaining the real API workflow. |
| Critical UX | There is no visible real applications list, evidence library, resume library, or agent timeline, despite backend events and patches being available. | Active UI collapses orchestration into a single activity label. | Build frontend views from actual in-browser application/run records and actual server event payloads. Do not fabricate server persistence. |
| High | Changing/replacing source data needs an explicit state invalidation strategy. | A new CV/job must never leave an old fit, run, approval, or export enabled. | Centralize reset/invalidation and clear stale run references before a new target enters the flow. |
| High | SSE reconnect/recovery is not surfaced as a first-class user state. | Backend streams an event history and terminal `done`, but active UI only has a generic disconnect error. | Recover via the real checkpoint endpoint; show retry/resume guidance and never synthesize agent events. |
| High | The app has no way to represent edit/reject decisions for proposed resume patches in the current UI. | Backend exposes source-linked patches but no patch-mutation contract. | Add local review selection/edit drafting with clear scope; source-CV changes invalidate the run and require a real rerun. Do not pretend server persistence exists. |
| Medium | Custom 404 markup is currently disconnected from active styles. | `not-found.tsx` uses legacy class names while layout imports only `clean.css`. | Include 404 styling in the new shared design system. |
| Medium | The current UI has no proper landing/nav/product explanation or dashboard shell. | Active routes all start in a task flow. | Build a public landing page and an accessible app shell with route-aware navigation. |
| Medium | Current status/error feedback is single-message inline state and does not persist/queue. | `CleanApp` only stores one `notice`/`error` string. | Use accessible toast/status primitives and clear retry affordances. |
| Medium | Browser-back/deep-link behavior is not modeled as workflow state. | No route/query/session stage mapping exists. | Restore view/run safely from URL/session; do not expose stateful server mutations through navigation. |

## Confirmed backend/product limitations (not silently misrepresented as working features)

- `RUNS` and manually added jobs are held in process memory. There is no configured database or authenticated, durable application/session store in the repository.
- There is no API for a full applications index, saved evidence edits, patch approval/rejection, approval revocation, cancellation, or persistent user profiles.
- The default execution path is the deterministic evidence engine. CrewAI is optional when its free-provider configuration is explicitly available. No OpenAI integration was found in the checked-in backend.
- The backend correctly protects approval/export, but a multi-user authorization model is not present in the checked-in API.

These are product-scope limitations, not frontend bugs that can truthfully be hidden. The redesign must preserve the backend contracts and explain local-browser persistence where used.

## Regression baseline before redesign

- Production `/`, `/workspace`, `/applications`, `/practice`, and `/documents` returned HTTP 200; unknown page returned a real HTTP 404.
- Production malformed job/search/run requests returned expected 422/404 JSON errors.
- Previous real-flow audit passed CV upload, pasted CV, manual job, live public search, fit, streamed run, server approval, DOCX/PDF, mobile width, accessibility, and browser console/network checks.
- Backend suite baseline: 57 tests passed.

## Implemented during the final-polish rebuild

- Replaced the single-flow public surface with a dedicated landing page, route-aware dashboard shell, application list, evidence library, resume library, documents view, settings view, and a six-stage workflow.
- Added a browser-local, explicitly labelled draft/application layer so refresh, deep links, and return visits restore the client-visible candidate/job/run context without pretending there is server-side account persistence.
- Added real checkpoint/event recovery for a saved run. A recovered terminal `approved` run now returns to Export; a missing in-memory server run returns to Fit with a clear recovery message instead of leaving a stale approved screen.
- Fixed an actual workflow defect found by the browser audit: fit analysis had been immediately skipped. The user now sees Matched, Partially matched, and Missing before opening the agents stage.
- Fixed an actual refresh defect found by the browser audit: replaying the `approval_required` event could leave an approved run on Review after refresh. The `approved` event and terminal stream status now restore Export correctly.
- Fixed direct-route state hijacking: replaying a saved run no longer forces `/workspace`, `/applications`, or library routes into the workflow view.
- Added synchronous mutation locks for CV import, manual/public job selection, fit requests, run creation, approval, and export. A regression test verifies rapid run clicks create only one server run.
- Added clear SSE interruption/reconnect feedback, tested against an intentionally aborted stream and real event-history recovery.
- Added custom 404 styling, route-specific browser titles/noindex metadata for private workspace routes, a consistent favicon/manifest, loading skeleton, status/toast feedback, responsive navigation, and AA contrast corrections.

## Non-negotiable safeguards for the rebuild

1. Keep CV parsing, evidence grounding, live public discovery, SSE orchestration, QA, approval, and export APIs real.
2. Never display fixture/demo data as a live job or a real applicant record.
3. Never enable an export solely from frontend state.
4. Never auto-apply or call external employer actions.
5. Keep a clear source/cache/manual label for every job.
6. Test the rebuilt UI against the actual deployed API before claiming release readiness.
