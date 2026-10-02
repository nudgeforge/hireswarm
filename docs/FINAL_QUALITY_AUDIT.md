# HireSwarm final quality audit

> **Superseded by later feature-by-feature retests:** see [`DETAILED_FEATURE_RETEST_2026-10-02.md`](./DETAILED_FEATURE_RETEST_2026-10-02.md) and the current [`SPATIAL_UI_AND_GENERATED_DATA_RETEST_2026-10-02.md`](./SPATIAL_UI_AND_GENERATED_DATA_RETEST_2026-10-02.md). The current suite is **35 passing tests**; the historic 24-test count below is retained only as an earlier audit snapshot.

**Audit date:** 2026-10-02  
**Scope:** end-to-end reliability, truthful-evidence boundaries, exports, public-source paths, UI behavior, and deployment configuration.

## Verified outcomes

- **Backend:** `python -m unittest discover -s tests -v` passed **24/24** tests.
- **Frontend:** `npm run typecheck` passed; production `next build` passed and generated the workspace route successfully.
- **Live API audit:** **33 checks passed** against the running FastAPI service.
- **Browser audit:** Chromium/Playwright exercised the production Next.js build with no page exceptions across:
  - complete rehearsal → human approval → real DOCX/PDF downloads;
  - unsafe pasted-URL feedback and valid pasted-role selection;
  - no-relevant-evidence stop state;
  - CV upload, stale-ledger clearing, and explicit ledger refresh;
  - mobile layout with no horizontal overflow.
- **Archive:** `unzip -t HireSwarm_Complete_Project.zip` completed with no errors.

## Important hardening completed during this audit

1. **Duplicate document bullets blocked.** When one literal source sentence supports FastAPI, REST APIs, Docker, or other multiple requirements, the evidence engine merges its requirement/evidence references and emits the sentence once. The document layer independently deduplicates bullets as a second safeguard.
2. **No generic packet from irrelevant proof.** Tailoring now creates a revision only for a direct requirement in the selected target. A candidate with related-only experience (for example Docker against a Kubernetes-only role) reaches `needs_evidence`; approval and export remain locked.
3. **Broader truthful tailoring.** Direct evidence for non-backend requirements such as React is now eligible for a literal, source-linked patch instead of being ignored by a backend-only rule; output follows the selected role's requirement order rather than a backend-demo priority.
4. **Verified evidence only.** Draft, partial, and unverified ledger entries cannot affect the fit score, interview proof, cover-letter evidence IDs, validator, or exportable revisions.
5. **Stale proof is cleared.** Editing resume text in the UI clears the old evidence ledger; the applicant must refresh it. The API also clears evidence when a refresh yields no reviewable statement.
6. **Input and document gates strengthened.** Runs require a candidate name plus at least one verified source statement. Manual official URLs accept only full `http(s)` URLs. PDF readiness now requires at least one evidence-linked revision.
7. **UI/runtime fixes.** Corrected review text rendering, made zero direct coverage render as `0%`, surfaced detailed URL validation feedback, and prevented a normal terminal SSE event from appearing as a browser-side aborted request.
8. **Container correctness.** Docker Compose now passes `BACKEND_URL=http://api:8000` at Next.js build time, where its rewrite configuration is resolved.

## Live-source behavior checked

- Greenhouse public board (Stripe) returned published roles.
- Lever public board (Metabase) returned published roles.
- Remotive returned provenance-labeled public rows with official links.
- An invalid public board failed transparently rather than being substituted with a fixture.
- CrewAI mode without credentials emitted its explicit Evidence Lab fallback and completed safely.

## Remaining intentional boundaries

- HireSwarm is an applicant-side tool; it never applies to an external job on the applicant's behalf.
- Public sources can legitimately be unavailable or rate-limited; the UI/API reports that state rather than inventing a live result.
- The optional CrewAI relay requires its documented optional dependency plus a free-provider key. The no-key Evidence Lab is fully functional and remains authoritative for claim validation.
