"use client";

/**
 * The main product surface is intentionally a single, linear application
 * journey. It is not a dashboard: a person sees one useful decision at a time
 * and always knows what happens after it.
 */

type ServiceStatus = "checking" | "online" | "offline" | "demo-only";
type RunState = "idle" | "running" | "needs_evidence" | "awaiting_approval" | "approved" | "failed";
type Origin = "demo_fixture" | "public_cache" | "user_pasted";

type Candidate = {
  name: string;
  evidence: { evidence_id: string; source_text: string; status: "verified" | "partial" | "unverified" }[];
};

type Job = {
  origin: Origin;
  title: string;
  company: string;
  location: string;
};

type MarketReport = {
  coverage: number;
  verified_strengths: { skill: string }[];
  adjacent_strengths: { skill: string }[];
  gaps: { skill: string; severity: string }[];
};

type Patch = {
  section: string;
  proposed: string;
  evidence_ids: string[];
};

type Turn = { round: number; requirement: string };
type ExportReadiness = { passed: boolean; verified_bullets: number; extracted_characters: number };

type Props = {
  candidate: Candidate;
  selectedJob?: Job;
  usingDemoProfile: boolean;
  serviceStatus: ServiceStatus;
  runState: RunState;
  market: MarketReport | null;
  patches: Patch[];
  turns: Turn[];
  activeAgent: string;
  notice: string | null;
  isMatching: boolean;
  isApproving: boolean;
  isExporting: "docx" | "pdf" | null;
  runIsActive: boolean;
  canStartLiveAction: boolean;
  exportReadiness: ExportReadiness | null;
  onDismissNotice: () => void;
  onOpenCv: () => void;
  onPasteRole: () => void;
  onFindRoles: () => void;
  onCheckFit: () => void;
  onBuildPlan: () => void;
  onEditRole: () => void;
  onApprove: () => void;
  onExport: (format: "docx" | "pdf") => void;
  onRetry: () => void;
  onUseDemo: () => void;
};

type Phase = "cv" | "job" | "fit" | "build" | "review";

function JourneyProgress({ phase, cvReady, jobReady, matchReady, approved }: {
  phase: Phase;
  cvReady: boolean;
  jobReady: boolean;
  matchReady: boolean;
  approved: boolean;
}) {
  const current = ({ cv: 0, job: 1, fit: 2, build: 3, review: 3 } as const)[phase];
  const labels = ["CV", "Job", "Fit", "Files"];
  const done = [cvReady, jobReady, matchReady, approved];
  return <ol className="simple-progress" aria-label={`Application step ${current + 1} of 4`}>
    {labels.map((label, index) => <li key={label} className={done[index] ? "done" : index === current ? "current" : ""}>
      <span>{done[index] ? "✓" : index + 1}</span><b>{label}</b>
    </li>)}
  </ol>;
}

function JobSummary({ job, onEdit }: { job: Job; onEdit: () => void }) {
  const source = job.origin === "user_pasted" ? "Job you added" : "Public job listing";
  return <section className="simple-job-summary" aria-label="Selected job">
    <div><small>{source}</small><h2>{job.title}</h2><p>{job.company} · {job.location}</p></div>
    <button type="button" onClick={onEdit}>Change job</button>
  </section>;
}

export function SimpleApplicationFlow(props: Props) {
  const {
    candidate, selectedJob, usingDemoProfile, serviceStatus, runState, market, patches, turns,
    activeAgent, notice, isMatching, isApproving, isExporting, runIsActive, canStartLiveAction,
    exportReadiness, onDismissNotice, onOpenCv, onPasteRole, onFindRoles, onCheckFit,
    onBuildPlan, onEditRole, onApprove, onExport, onRetry, onUseDemo,
  } = props;

  const cvReady = !usingDemoProfile && candidate.evidence.some((item) => item.status === "verified");
  const jobReady = Boolean(selectedJob && selectedJob.origin !== "demo_fixture");
  const matchReady = Boolean(market);
  const approved = runState === "approved";
  let phase: Phase = !cvReady ? "cv" : !jobReady ? "job" : runState === "running" ? "build" : runState === "awaiting_approval" || runState === "approved" ? "review" : "fit";
  if (runState === "needs_evidence") phase = "fit";

  const connection = serviceStatus === "online" ? "Live" : serviceStatus === "checking" ? "Connecting" : serviceStatus === "demo-only" ? "Sample only" : "Offline";
  const displayName = candidate.name.trim().split(/\s+/)[0] || "your";
  const visiblePatches = patches.slice(0, 3);

  return <main className="simple-flow" aria-labelledby="simple-flow-title">
    <header className="simple-header">
      <a href="/" className="simple-brand" aria-label="HireSwarm home"><span>h.</span><b>hire<span>swarm</span></b></a>
      <button type="button" className={`simple-connection ${serviceStatus}`} onClick={onRetry} aria-label="Check live workspace connection">
        <i aria-hidden="true" />{connection}
      </button>
    </header>

    <div className="simple-shell">
      {notice && <div className="simple-notice" role="status"><p>{notice}</p><button type="button" onClick={onDismissNotice} aria-label="Dismiss message">×</button></div>}
      {serviceStatus === "offline" && <section className="simple-offline" role="alert"><b>Live workspace is temporarily unavailable.</b><span>Your draft is safe. Try again before uploading a CV or creating files.</span><button type="button" onClick={onRetry}>Try again</button></section>}
      {serviceStatus === "demo-only" && <section className="simple-offline sample" role="note"><b>You are looking at a sample.</b><span>It is not your application and cannot be exported.</span><button type="button" onClick={onRetry}>Try live workspace</button></section>}

      <div className="simple-intro">
        <p>ONE JOB AT A TIME</p>
        <h1 id="simple-flow-title">{phase === "cv" ? "Start with your CV." : phase === "job" ? "Now choose one job." : phase === "fit" ? "See what your CV supports." : phase === "build" ? "Preparing your application." : approved ? "Your files are ready." : "Review before you download."}</h1>
        <span>{phase === "cv" ? "Upload your CV first. We will only use work you can support." : phase === "job" ? "Add a job you found, then we will compare it with your CV." : phase === "fit" ? "We keep direct evidence, related experience, and gaps separate." : phase === "build" ? "We are creating safe wording and practice prompts from your CV." : "Nothing is sent to an employer. You decide whether to download the files."}</span>
      </div>

      <JourneyProgress phase={phase} cvReady={cvReady} jobReady={jobReady} matchReady={matchReady} approved={approved} />

      <section className="simple-card" aria-busy={isMatching || runState === "running"}>
        {phase === "cv" && <>
          <p className="simple-step">STEP 1 · YOUR CV</p>
          <h2>Add your CV</h2>
          <p className="simple-lede">Upload a PDF, DOCX, or TXT file. We turn it into a short list of real work examples for this application only.</p>
          <div className="simple-explainer"><b>What is evidence?</b><span>A real CV line, project, or result that supports a skill. We do not invent anything.</span></div>
          {usingDemoProfile && <p className="simple-sample-note"><b>No CV added yet.</b> The default profile is example data only; upload your own CV for real work.</p>}
          <button type="button" className="simple-primary" onClick={onOpenCv} disabled={runIsActive}>Upload my CV <span>→</span></button>
          <p className="simple-after">After upload, you will go straight to choosing a job.</p>
          <button type="button" className="simple-text-button" onClick={onUseDemo} disabled={runIsActive}>Or view a clearly labelled sample</button>
        </>}

        {phase === "job" && <>
          <p className="simple-step">STEP 2 · YOUR JOB</p>
          <h2>Choose one job</h2>
          <p className="simple-lede"><b>{displayName}&rsquo;s CV is ready.</b> We found {candidate.evidence.length} work example{candidate.evidence.length === 1 ? "" : "s"}. Now add the one job you want to prepare for.</p>
          <div className="simple-ready-line"><span>✓</span><div><b>CV added</b><small>{candidate.evidence.length} evidence line{candidate.evidence.length === 1 ? "" : "s"} ready to use</small></div><button type="button" onClick={onOpenCv}>Change CV</button></div>
          <div className="simple-action-row"><button type="button" className="simple-primary" onClick={onPasteRole} disabled={runIsActive}>Paste a job listing <span>→</span></button><button type="button" className="simple-secondary" onClick={onFindRoles} disabled={runIsActive}>Find public jobs</button></div>
          <p className="simple-after">Use a listing you trust. HireSwarm never applies for you.</p>
        </>}

        {phase === "fit" && selectedJob && !market && runState !== "needs_evidence" && <>
          <p className="simple-step">STEP 3 · YOUR FIT</p>
          <JobSummary job={selectedJob} onEdit={onEditRole} />
          <h2>Check this job against your CV</h2>
          <p className="simple-lede">You will see what you can directly support, what is related, and what should stay an honest gap.</p>
          <button type="button" className="simple-primary" onClick={onCheckFit} disabled={!canStartLiveAction || isMatching || runIsActive}>{isMatching ? "Checking your CV…" : "Check my match"} <span>→</span></button>
        </>}

        {phase === "fit" && selectedJob && market && runState !== "needs_evidence" && <>
          <p className="simple-step">STEP 3 · YOUR FIT</p>
          <JobSummary job={selectedJob} onEdit={onEditRole} />
          <div className="simple-fit-score"><b>{market.coverage}<small>%</small></b><span>of the listed requirements have direct CV evidence</span></div>
          <div className="simple-fit-list"><div><b>Supported now</b><p>{market.verified_strengths.map((item) => item.skill).slice(0, 5).join(" · ") || "No direct matches yet"}</p></div>{market.adjacent_strengths.length > 0 && <div className="related"><b>Related experience</b><p>{market.adjacent_strengths.map((item) => item.skill).slice(0, 3).join(" · ")}</p></div>}{market.gaps.length > 0 && <div className="gap"><b>Keep honest</b><p>{market.gaps.map((item) => item.skill).slice(0, 4).join(" · ")}</p></div>}</div>
          <button type="button" className="simple-primary" onClick={onBuildPlan} disabled={!canStartLiveAction || runIsActive}>Create my application plan <span>→</span></button>
          <p className="simple-after">We will write only from evidence already in your CV.</p>
        </>}

        {phase === "fit" && runState === "needs_evidence" && <>
          <p className="simple-step">STEP 3 · YOUR FIT</p>
          <h2>This job needs stronger direct evidence</h2>
          <p className="simple-lede">That is useful information. Add a real CV line only if you genuinely did the work, or choose a better-fitting job.</p>
          {market && <div className="simple-fit-list"><div className="gap"><b>Gaps to keep visible</b><p>{market.gaps.map((item) => item.skill).join(" · ")}</p></div></div>}
          <div className="simple-action-row"><button type="button" className="simple-primary" onClick={onOpenCv}>Update my CV <span>→</span></button><button type="button" className="simple-secondary" onClick={onPasteRole}>Choose another job</button></div>
        </>}

        {phase === "build" && <>
          <p className="simple-step">STEP 4 · PREPARING</p>
          <h2>Building your application plan</h2>
          <p className="simple-lede">We are checking your CV evidence, creating honest practice prompts, and preparing safe wording for this job.</p>
          <div className="simple-building"><span aria-hidden="true"><i /><i /><i /></span><div><b>{activeAgent || "Checking your work examples"}</b><small>Your gaps remain visible. Nothing is sent anywhere.</small></div></div>
          <div className="simple-build-list"><span>1. Check evidence</span><span>2. Prepare practice answers</span><span>3. Draft safe CV wording</span></div>
        </>}

        {phase === "review" && <>
          <p className="simple-step">STEP 4 · REVIEW & DOWNLOAD</p>
          <h2>{approved ? "Your files are ready" : "Review before download"}</h2>
          <p className="simple-lede">Read the supported updates below. You remain in control: approval unlocks downloads only, never an application submission.</p>
          <div className="simple-review-numbers"><div><b>{patches.length}</b><span>supported CV updates</span></div><div><b>{turns.length}</b><span>practice prompts</span></div><div><b>0</b><span>automatic applications</span></div></div>
          {visiblePatches.length > 0 && <details className="simple-updates" open><summary>Your supported updates <span>⌄</span></summary><div>{visiblePatches.map((patch, index) => <article key={`${patch.section}-${index}`}><small>{patch.section} · {patch.evidence_ids.join(", ")}</small><p>{patch.proposed}</p></article>)}</div></details>}
          {exportReadiness?.passed && <p className="simple-qa">✓ Document QA passed: {exportReadiness.verified_bullets} supported bullet{exportReadiness.verified_bullets === 1 ? "" : "s"} checked before release.</p>}
          {!approved && <button type="button" className="simple-primary" onClick={onApprove} disabled={!canStartLiveAction || isApproving}>{isApproving ? "Saving your approval…" : "Approve final files"} <span>→</span></button>}
          {approved && <div className="simple-action-row"><button type="button" className="simple-primary" onClick={() => onExport("docx")} disabled={!canStartLiveAction || isExporting !== null}>{isExporting === "docx" ? "Preparing DOCX…" : "Download DOCX"} <span>↓</span></button><button type="button" className="simple-secondary" onClick={() => onExport("pdf")} disabled={!canStartLiveAction || isExporting !== null}>{isExporting === "pdf" ? "Preparing PDF…" : "Download PDF"}</button></div>}
        </>}
      </section>
    </div>

    <footer className="simple-footer">Your evidence stays tied to real work. <span>·</span> No automatic applications.</footer>
  </main>;
}
