# HireSwarm responsive and workflow repair — 2026-10-02

## Why this repair was made

A fresh rendered-site audit found that the earlier product pass had missed real user-facing faults: workflow steps were visibly clipped on phone widths, touch targets were undersized, and compact header controls lost their labels. This repair was made against the production build rather than relying on static code inspection.

## Repairs applied

- Replaced the clipped mobile workflow strip with a visible two-by-two progression grid. All four destinations remain in the viewport at 820px, 480px, 390px, and 360px.
- Reworked compact command controls into labelled action tiles: **Engine, Guide, Roles, Paste,** and **You** remain understandable on mobile and tablet.
- Kept tablet command controls in a single concise dock instead of allowing the header to split into disconnected rows.
- Restored readable mobile navigation labels while removing the redundant compact-profile avatar where it was constraining the navigation row. Profile remains available from the labelled command dock.
- Increased practical hit areas for text actions and the desktop profile overflow action.
- Made sidebar navigation and workflow progression buttons scroll to the relevant workspace panel, so changing a view no longer appears to do nothing below the fold.
- Repositioned the dimensional hero scene so the selected-role card is no longer obscured by the central orb. On small displays, the scene becomes a clear compact evidence orb rather than a pile of unreadably small cards.
- Removed remaining light-theme inherited styling in the dark review space. Review checks, document-QA feedback, and secondary export actions now have readable dark-surface contrast and clear enabled states.

## Independent browser validation

### Responsive production audit

`frontend/audit-responsive.mjs` was run against the running optimized site at:

- 1440px desktop
- 1280px laptop
- 1024px tablet landscape
- 820px tablet
- 480px phone
- 390px phone
- 360px phone

Result: each viewport recorded zero browser runtime errors, zero detected control-overflow faults, and zero visible interactive controls below the practical 24px minimum. Local screenshots and machine-readable audit output were used during the repair and are intentionally excluded from the GitHub/deployment package.

### Interaction audit

`frontend/audit-interactions.mjs` exercised the actual browser UI and completed successfully. It covered:

1. workspace service retry/status feedback;
2. direct profile editing and evidence refresh;
3. target adaptation and the practice-role chooser;
4. practice rehearsal start;
5. guide, engine selection, and navigation-to-workspace behaviour;
6. live Remotive discovery and rehearsing a selected public listing;
7. applicant-provided role creation, provenance labelling, and its isolated source-link action;
8. the end-to-end evidence rehearsal, tailoring view, cover-letter view, human approval gate, DOCX export, and PDF export;
9. a 360px mobile check for all four workflow controls, labelled command controls, target size, and viewport containment.

The browser run recorded no React/page runtime errors and no API 5xx responses during these primary workflows.

### Build and backend checks

- `npm run typecheck` — passed.
- `BACKEND_URL=http://127.0.0.1:8000 npm run build` — passed.
- `python -m unittest discover -s tests -v` — passed: **35/35 tests**.

## Product boundary retained

The repair does not weaken the product safeguards: public feeds are only read on request; pasted roles keep applicant-provided provenance; gaps remain visible; no external application is ever submitted; approval is required before either export format unlocks.
