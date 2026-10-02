"use client";

import { useState } from "react";

type Origin = "demo_fixture" | "public_cache" | "user_pasted";
type RunState = "idle" | "running" | "needs_evidence" | "awaiting_approval" | "approved" | "failed";
type Job = { id: string; origin: Origin; source: string; title: string; company: string; location: string; type: string; salary?: string; posted: string; retrieved_at?: string | null; cache_state?: string; url: string; skills?: string[]; description?: string; must_have?: string[]; preferred?: string[]; detail_loaded?: boolean };
type Evidence = { evidence_id: string; source_section: string; source_text: string; skills: string[]; metric?: string; status: "verified" | "partial" | "unverified" };
type Candidate = { evidence: Evidence[] };
type Turn = { round: number; requirement: string; question?: string; answer?: string; status?: string; evidence_ids?: string[]; verdict?: string };
type Patch = { section: string; original: string; proposed: string; evidence_ids: string[]; covered_requirements: string[]; status: string; reason: string };
type MarketReport = { score: number; coverage: number; verified_strengths: { skill: string; evidence_ids: string[]; preferred?: boolean }[]; adjacent_strengths: { skill: string; evidence_ids: string[]; reason: string; preferred?: boolean }[]; gaps: { skill: string; severity: string }[] };
type ExportCheck = { label: string; passed: boolean; detail: string };
type ExportReadiness = { passed: boolean; checks: ExportCheck[]; extracted_characters: number; verified_bullets: number };

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");
const roleSkills = (job?: Job) => job?.must_have?.length ? job.must_have : job?.skills || [];
const hasRoleDetail = (job?: Job) => Boolean(job?.detail_loaded || job?.description || job?.must_have?.length);

function evidenceText(candidate: Candidate, evidenceIds: string[] = []) {
  const snippets = evidenceIds.map((id) => candidate.evidence.find((item) => item.evidence_id === id)?.source_text).filter((item): item is string => Boolean(item));
  return snippets.length ? snippets[0] : "No source-linked work example was found yet.";
}

export function MatchPanel({ selectedJob, candidate, market, onStart, onSampleStart, onImport, onReviewRole, isRoleLoading, runState, canRun, usingDemoProfile, selectedIsPractice }: { selectedJob?: Job; candidate: Candidate; market: MarketReport | null; onStart: () => void; onSampleStart: () => void; onImport: () => void; onReviewRole: () => void; isRoleLoading: boolean; runState: RunState; canRun: boolean; usingDemoProfile: boolean; selectedIsPractice: boolean }) {
  const sampleCheck = selectedIsPractice;
  const needsCv = usingDemoProfile && !selectedIsPractice;
  if (!hasRoleDetail(selectedJob)) {
    return <div className="match-layout role-detail-gate" aria-live="polite">
      <div className="match-story"><p className="kicker">JOB SUMMARY LOADED</p><h3>Review this role before checking the fit.</h3><p>Live search keeps long third-party descriptions out of the list. Open this one role to load its published requirements, then map them to your work examples.</p><button className="inline-primary" onClick={onReviewRole} disabled={!canRun || isRoleLoading}>{isRoleLoading ? "Loading job details…" : "Review this role"} <span>→</span></button></div>
      <div className="requirements-list compact-loading"><div className="requirement-header"><span>JOB REQUIREMENTS</span><small>{isRoleLoading ? "loading published details" : "review to load"}</small></div><div className="requirement-row skeleton-row"><span /><div><b /><p /></div></div><div className="requirement-row skeleton-row"><span /><div><b /><p /></div></div></div>
    </div>;
  }

  const requirementRows = roleSkills(selectedJob);
  const directCount = market?.verified_strengths.filter((item) => requirementRows.includes(item.skill)).length || 0;
  const adjacentCount = market?.adjacent_strengths.filter((item) => requirementRows.includes(item.skill)).length || 0;
  const supportedCount = directCount + adjacentCount;
  const matchLabel = !market ? "Fit check ready" : directCount >= Math.max(1, Math.ceil(requirementRows.length * .7)) ? "Strong match" : supportedCount ? "Developing match" : "Evidence gap to review";
  const action = needsCv ? onImport : sampleCheck ? onSampleStart : onStart;
  const actionLabel = runState === "running" ? "Checking fit…" : !canRun ? "Fit check paused" : needsCv ? "Add your CV to check this fit" : sampleCheck ? "Try demo fit check" : "Check my fit";

  return <div className="match-layout evidence-match-layout">
    <div className="match-story">
      <p className="match-description">{selectedJob?.description || "Published job details are available for this review."}</p>
      <div className="fit-readout"><span>{market ? `${market.score}%` : "—"}</span><div><b>{matchLabel}</b><p>{market ? `${supportedCount} of ${requirementRows.length || 0} important requirements supported` : "Run a fit check to map this job to your work examples."}</p></div></div>
      <div className="story-callout"><span>✓</span><div><b>This is not a rejection score.</b><p>It shows what to highlight, what to explain, and what to improve. Related experience stays separate from direct evidence.</p></div></div>
      <button className="inline-primary" onClick={action} disabled={runState === "running" || !canRun}>{actionLabel} <span>→</span></button>
      {needsCv && <p className="fit-prerequisite" role="note">A real fit check needs your CV. You can still explore the demo role separately.</p>}
    </div>
    <div className="requirements-list requirement-table-wrap">
      <div className="requirement-header"><span>REQUIREMENT MAP</span><small>{market ? "linked to your work examples" : "ready to assess"}</small></div>
      <div className="requirement-table" role="table" aria-label="Job requirement evidence map">
        <div className="requirement-table-head" role="row"><span>Requirement</span><span>Status</span><span>Explanation</span></div>
        {requirementRows.map((skill) => {
          const direct = market?.verified_strengths.find((item) => item.skill === skill);
          const adjacent = market?.adjacent_strengths.find((item) => item.skill === skill);
          const status = direct ? "Strong evidence" : adjacent ? "Related experience" : market ? "Gap" : "Not checked";
          const explanation = direct ? evidenceText(candidate, direct.evidence_ids) : adjacent ? `${evidenceText(candidate, adjacent.evidence_ids)} Related experience — confirm the boundary.` : market ? `No direct evidence found for ${skill}.` : "Check this job to find related work examples.";
          return <div className={cx("requirement-table-row", direct && "direct", adjacent && "adjacent", market && !direct && !adjacent && "gap")} role="row" key={skill}><b>{skill}</b><span>{status}</span><p>{explanation}</p></div>;
        })}
      </div>
      {market?.gaps.length ? <div className="honest-gap-note" role="note"><b>Honest gap:</b> We could not find direct evidence for {market.gaps.slice(0, 2).map((gap) => gap.skill).join(" and ")}. Do not claim professional experience unless you can support it.</div> : null}
    </div>
  </div>;
}

export function RehearsalPanel({ turns, currentTurn, runState, onStart, canRun }: { turns: Turn[]; currentTurn?: Turn; runState: RunState; onStart: () => void; canRun: boolean }) {
  const [showAnswerGuide, setShowAnswerGuide] = useState(false);
  const answerGuide = <div className="answer-guide" role="note"><b>Your answer should include:</b><ul><li>What problem you solved</li><li>What technologies you used</li><li>What you were responsible for</li><li>What result you achieved</li></ul></div>;
  if (!turns.length && runState !== "running") return <div className="rehearsal-empty"><div className="conversation-preview"><div className="speaker-card hr"><span>LIKELY INTERVIEW QUESTION</span><p>“Tell me about the evidence behind your most relevant work.”</p></div><div className="speaker-card candidate"><span>YOUR EVIDENCE-BASED ANSWER</span><p>“I will answer only from work examples already in my profile.”</p></div></div><div><p className="kicker">STEP 5 OF 6</p><h3>Practice for this specific role.</h3><p>See what the employer is testing, then build an answer from work you can stand behind. If proof is missing, the gap stays visible.</p><div className="practice-actions"><button className="inline-primary" onClick={onStart} disabled={!canRun}>{canRun ? "Start practice" : "Practice paused"} <span>→</span></button><button className="outline-action small" onClick={() => setShowAnswerGuide((value) => !value)}> {showAnswerGuide ? "Hide example" : "Show an example"}</button></div>{showAnswerGuide && answerGuide}</div></div>;
  return <div className="rehearsal-wrap"><div className="interview-status"><div><span className={cx("record-dot", runState === "running" && "recording")} /> {runState === "running" ? "Practice in progress" : "Practice notes"}</div><b>{turns.length}/4 prompts reviewed</b></div><div className="conversation-list">{turns.map((turn) => <article className="conversation-turn" key={turn.round}><div className="turn-marker">{String(turn.round).padStart(2, "0")}</div><div className="turn-content"><div className="question-bubble"><span>LIKELY INTERVIEW QUESTION</span><p>{turn.question || "Preparing the next role-specific question…"}</p><small><b>What the employer is testing:</b> {turn.requirement}</small></div>{turn.answer && <div className="answer-bubble"><span>YOUR EVIDENCE-BASED ANSWER · <b className={cx("status-word", turn.status?.toLowerCase())}>{turn.status}</b></span><p>{turn.answer}</p>{turn.evidence_ids?.length ? <div className="source-pills">{turn.evidence_ids.map((id) => <i key={id}>{id}</i>)}</div> : null}</div>}{turn.verdict && <div className={cx("verdict", turn.status?.toLowerCase())}>{turn.verdict}</div>}</div></article>)}</div><div className="practice-footer"><button className="outline-action small" onClick={() => setShowAnswerGuide((value) => !value)}>{showAnswerGuide ? "Hide answer guide" : "Improve my answer"}</button>{showAnswerGuide && answerGuide}</div>{runState === "running" && <div className="now-thinking"><span /><p>{currentTurn?.question ? "Checking the answer against your work examples…" : "Preparing the next interview prompt…"}</p></div>}</div>;
}

export function TailorPanel({ patches, coverLetter, coverLetterEvidenceIds, showCoverLetter, onToggleCoverLetter, onStart, canRun, runState }: { patches: Patch[]; coverLetter: string; coverLetterEvidenceIds: string[]; showCoverLetter: boolean; onToggleCoverLetter: () => void; onStart: () => void; canRun: boolean; runState: RunState }) {
  if (!patches.length) return <div className="tailor-empty"><div className="paper-stack"><span /><span /><article><small>YOUR APPLICATION</small><b>Relevant work, clearly stated.</b><p>The strongest application is specific about what you did — and careful about what you did not do.</p></article></div><div><p className="kicker">STEP 4 OF 6</p><h3>Turn your experience into application-ready proof.</h3><p>Once practice is complete, HireSwarm suggests small, source-linked changes. You see every original sentence before deciding what to use.</p><button className="inline-primary" onClick={onStart} disabled={!canRun || runState === "running"}>{runState === "running" ? "Evidence check in progress" : canRun ? "Build my application story" : "Evidence check paused"} <span>→</span></button></div></div>;
  if (showCoverLetter) return <div className="letter-view"><div className="letter-toolbar"><div><span>COVER LETTER POINTS</span><b>Draft cover letter</b></div><button className="text-action" onClick={onToggleCoverLetter}>Back to CV points</button></div>{coverLetterEvidenceIds.length > 0 && <div className="letter-evidence"><span>Supported by work examples</span>{coverLetterEvidenceIds.map((id) => <i key={id}>{id}</i>)}</div>}<pre>{coverLetter}</pre></div>;
  return <div className="revision-wrap"><div className="revision-toolbar"><div><span>TURN YOUR EXPERIENCE INTO APPLICATION-READY PROOF</span><p>{patches.length} useful CV point{patches.length === 1 ? "" : "s"}, each tied to the work you already did.</p></div><button className="outline-action small" onClick={onToggleCoverLetter} disabled={!coverLetter}>View cover letter points</button></div><div className="revision-list">{patches.map((patch, index) => <article className="revision application-proof-card" key={`${patch.original}-${index}`}><div className="revision-number">{String(index + 1).padStart(2, "0")}</div><div className="revision-body"><div className="revision-section">{patch.section}</div>{patch.proposed.trim() === patch.original.trim() ? <><p className="before source-only">YOUR WORK EXAMPLE</p><p className="after">{patch.original}</p></> : <><p className="before"><s>{patch.original}</s></p><p className="after">{patch.proposed}</p></>}<div className="proof-why"><b>Why it matters:</b><p>{patch.reason}</p></div><div className="use-this-in"><span>Use this in:</span><i>CV</i><i>Cover letter</i><i>Interview answer</i></div><div className="revision-meta"><span>Supported by {patch.evidence_ids.map((id) => <i key={id}>{id}</i>)}</span><em>{patch.covered_requirements.length ? `Supports ${patch.covered_requirements.join(", ")}` : "Relevant to this job"}</em></div></div></article>)}</div></div>;
}

export function ReviewPanel({ runState, patches, gaps, readiness, selectedJob, onApprove, onExport, onOpenOfficial, serviceOnline, isApproving, isExporting }: { runState: RunState; patches: Patch[]; gaps: { skill: string; severity: string }[]; readiness: ExportReadiness | null; selectedJob?: Job; onApprove: () => void; onExport: (format: "docx" | "pdf") => void; onOpenOfficial: (url?: string) => void; serviceOnline: boolean; isApproving: boolean; isExporting: "docx" | "pdf" | null }) {
  const ready = runState === "awaiting_approval" || runState === "approved";
  const isRunning = runState === "running";
  const extractionPassed = readiness?.checks.find((item) => item.label === "PDF text round-trip")?.passed ?? false;
  return <div className="review-layout">
    <div className="review-lead"><div className={cx("review-seal", runState === "approved" && "approved")}>{runState === "approved" ? "✓" : "05"}</div><div><p className="kicker">STEP 6 OF 6</p><h3>{runState === "approved" ? "Your packet is ready to use." : ready ? "Review before you use it." : isRunning ? "Your application story is still being prepared." : "Review before you use it."}</h3><p>{runState === "approved" ? "Your supported CV points and cover letter are ready to take with you. HireSwarm never submits an application for you." : ready ? "Read every suggested sentence, acknowledge any gaps, then approve only what sounds true to you." : isRunning ? "Approval and exports stay locked until the application story reaches your review step." : "Complete the fit check and practice steps to create a packet you can review."}</p></div></div>
    {isRunning && <p className="review-running-note" role="status">Practice is active. Approval and exports unlock only after you see the evidence-backed review.</p>}
    <div className="review-checks"><ReviewCheck complete={patches.length > 0} label={patches.length ? "All suggested claims are connected to your work examples" : "Claims will be connected to work examples before approval"} /><ReviewCheck complete label={gaps.length ? `${gaps.length} unsupported or missing requirement${gaps.length > 1 ? "s are" : " is"} clearly visible` : "No unsupported requirement is hidden"} /><ReviewCheck complete={Boolean(readiness?.passed && extractionPassed)} label={readiness?.passed ? "Document checks passed before approval" : "Document checks will run before approval"} /><ReviewCheck complete={ready} label={ready ? "You reviewed the generated content" : "Your review is still required"} /><ReviewCheck complete label="Nothing is submitted automatically" /></div>
    {readiness && <div className="readiness-note"><span>{readiness.passed ? "✓" : "!"}</span><p><b>Document check</b> · {readiness.verified_bullets} verified bullet{readiness.verified_bullets === 1 ? "" : "s"}; {readiness.extracted_characters} characters read back from the generated PDF.</p></div>}
    <div className="review-actions">
      {runState === "awaiting_approval" && <button className="approve-action" onClick={onApprove} disabled={!serviceOnline || isApproving}>{!serviceOnline ? "Approval paused" : isApproving ? "Saving your approval…" : "Approve application packet"} <span>→</span></button>}
      {runState === "approved" && <><button className="approve-action export" onClick={() => onExport("docx")} disabled={!serviceOnline || Boolean(isExporting)}>{isExporting === "docx" ? "Preparing DOCX…" : "Export DOCX"} <span>↓</span></button><button className="outline-action" onClick={() => onExport("pdf")} disabled={!serviceOnline || Boolean(isExporting)}>{isExporting === "pdf" ? "Preparing PDF…" : "Export PDF"} <span>↓</span></button>{selectedJob?.url && selectedJob.origin !== "demo_fixture" && <button className="outline-action" onClick={() => onOpenOfficial(selectedJob.url)} disabled={Boolean(isExporting)}>Open official listing ↗</button>}</>}
      {!ready && !isRunning && <span className="locked-action">Complete the earlier steps to unlock review</span>}
    </div>
  </div>;
}

function ReviewCheck({ complete, label }: { complete: boolean; label: string }) { return <div className={cx("review-check", complete && "complete")}><span>{complete ? "✓" : "○"}</span><p>{label}</p></div>; }
