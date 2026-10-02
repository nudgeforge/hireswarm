# HireSwarm — Resilience & Command-Surface Retest

**Date:** 2026-10-02  
**Release focus:** eliminate non-JSON API crashes, make every header action explicit and testable, and replace the previous flat workspace treatment with a tactile spatial command surface.

## Incident fixed: HTML parsed as JSON

### Symptom
A failed reverse-proxy/API response could be HTML (for example, a Next.js error page). The browser UI previously called `response.json()` directly, causing the raw error:

```text
Unexpected token '<', "<!DOCTYPE ..." is not valid JSON
```

### Fix
`frontend/app/page.tsx` now uses a single guarded request layer for every JSON endpoint:

- Reads the response body once and parses it deliberately.
- Detects HTML/non-JSON responses before JSON parsing can leak an exception to the user.
- Preserves FastAPI JSON validation messages where available.
- Gives a clear, non-destructive recovery message: the user is told that no draft/action was changed and can retry.
- Covers bootstrap, CV import/normalization, manual roles, public-role discovery, public boards, rehearsal creation, approval, and download failures.
- Adds a visible, clickable **Live workspace / Retry connection** header state driven by `/backend/healthz`.

### Forced failure validation
A browser test intercepted every `/backend/**` request and intentionally returned a `502` HTML document. Result:

- Friendly HTML/API failure notice rendered.
- Workspace switched to a visible retry state.
- No React page error occurred.
- No `Unexpected token`/JSON parsing error reached the UI.

## Command header validation

The header is now made of individually labeled, visible controls instead of ambiguous text buttons:

| Header control | Verified behavior |
|---|---|
| **Evidence Lab / CrewAI relay** | Opens a menu, switches both ways, confirms the selected engine. |
| **Guide** | Opens the four-step real-use guide; its CV action opens the profile/import modal. |
| **Find roles** | Opens the public-source workflow and can submit a role search. |
| **Paste role** | Opens the applicant-provided role form and accepts a full role submission. |
| **Profile** | Opens the CV/evidence profile. |
| **Live workspace / Retry connection** | Checks backend health and visibly confirms connection or tells the user to retry. |
| **Applications / target breadcrumbs** | Navigate to the shortlist and open the selected-target adaptation form. |

## Functional browser coverage

A production-build Playwright pass completed successfully:

- Header engine menu, Guide, Find roles, Paste role, profile pathway, connection-status check, and breadcrumbs.
- Applicant-provided role creation with source/provenance label.
- Real rehearsal through the human approval gate.
- Export locked before approval and unlocked only after explicit applicant review.
- Live public-source search: **23** currently fetched roles from Remotive and Arbeitnow, with provenance and source-link action retained.
- Desktop no-overflow check at 1440px.
- Mobile no document-level horizontal overflow at 390px; Paste role remains reachable in the mobile header.
- No browser page errors during the normal full workflow.
- `npm run typecheck`, optimized Next.js production build, and all **35** backend unit/workflow tests passed.

## Visual / UX implementation

- High-contrast responsive command surface, replacing tiny flat dashboard styling.
- Clear primary route: **CV → public/pasted role → evidence rehearsal → review → human approval**.
- CSS-only spatial hero with layered 3D cards, orbit grid, depth, and reduced-motion support—no opaque 3D package or external visual dependency.
- Larger touch targets, header labels, readable hierarchy, live service state, and clearly separated safe practice versus real-role routes.
- Retains product boundaries: read-only public discovery, truthful evidence, visible gaps, no employer credentials, and no automatic application submission.
