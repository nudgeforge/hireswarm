"use client";

/**
 * The default application surface intentionally has one job: get a person to
 * their next useful decision. The complete application studio remains
 * available through the intentionally-labelled "More tools" route; it is not
 * removed or hidden behind an account upgrade.
 */

type ServiceStatus = "checking" | "online" | "offline" | "demo-only";
type RunState = "idle" | "running" | "needs_evidence" | "awaiting_approval" | "approved" | "failed";
type Origin = "demo_fixture" | "public_cache" | "user_pasted";

type Candidate = {
  name: string;
  headline: string;
  location: string;
  evidence: { evidence_id: string; source_text: string; skills: string[]; status: "verified" | "partial" | "unverified" }[];
};

type Job = {
  id: string;
  origin: Origin;
  source: string;
  title: string;
  company: string;
  location: string;
  type: string;
  url: string;
  skills?: string[];
  must_have?: string[];
  preferred?: string[];
};

type MarketReport = {
  score: number;
  coverage: number;
  verified_strengths: { skill: string; evidence_ids: string[]; preferred?: boolean }[];
  adjacent_strengths: { skill: string; evidence_ids: string[]; reason: string; preferred?: boolean }[];
  gaps: { skill: string; severity: string }[];
};

type Patch = { section: string };
type Turn = { round: number };

type FocusedApplicationProps = {
  candidate: Candidate;
  selectedJob?: Job;
  usingDemoProfile: boolean;
  selectedIsPractice: boolean;
  serviceStatus: ServiceStatus;
  runState: RunState;
  market: MarketReport | null;
  patches: Patch[];
  turns: Turn[];
  activeAgent: string;
  notice: string | null;
  isBootstrapping: boolean;
  isMatching: boolean;
  isApproving: boolean;
  isExporting: "docx" | "pdf" | null;
  runIsActive: boolean;
  canStartLiveAction: boolean;
  onDismissNotice: () => void;
  onOpenCv: () => void;
  onFindRoles: () => void;
  onPasteRole: () => void;
  onCheckFit: () => void;
  onBuildPlan: () => void;
  onEditRole: () => void;
  onOpenOfficial: (url?: string) => void;
  onRetry: () => void;
  onApprove: () => void;
  onExport: (format: "docx" | "pdf") => void;
  onOpenFullWorkspace: (view?: "match" | "rehearse" | "tailor" | "review") => void;
};

type FocusStep = "cv" | "role" | "match" | "finish";

const skillsFor = (job?: Job) => job?.must_have?.length ? job.must_have : job?.skills || [];

function sourceName(job?: Job) {
  if (!job || job.origin === "demo_fixture") return "Sample role";
  if (job.origin === "user_pasted") return "Added by you";
  return "Public listing";
}

function completionState(
  usingDemoProfile: boolean,
  hasReviewableEvidence: boolean,
  selectedIsPractice: boolean,
  market: MarketReport | null,
  runState: RunState,
): FocusStep {
  if (runState === "running" || runState === "awaiting_approval" || runState === "approved") return "finish";
  if (market || runState === "needs_evidence") return "match";
  // Editing a CV clears the old evidence ledger on purpose. Do not let a
  // person jump to a match until they have refreshed reviewable source lines.
  if (!usingDemoProfile && !hasReviewableEvidence) return "cv";
  if (!usingDemoProfile && !selectedIsPractice) return "match";
  if (!usingDemoProfile) return "role";
  return "cv";
}

function StepProgress({ current, usingDemoProfile, hasReviewableEvidence, selectedIsPractice, market, runState }: {
  current: FocusStep;
  usingDemoProfile: boolean;
  hasReviewableEvidence: boolean;
  selectedIsPractice: boolean;
  market: MarketReport | null;
  runState: RunState;
}) {
  const activeIndex = ["cv", "role", "match", "finish"].indexOf(current);
  const cvDone = !usingDemoProfile && hasReviewableEvidence;
  const roleDone = !selectedIsPractice && cvDone;
  const matchDone = Boolean(market) || ["running", "awaiting_approval", "approved"].includes(runState);
  const complete = [cvDone, roleDone, matchDone, runState === "approved"];
  const labels = ["Your CV", "Job", "Match", "Finish"];

  return <ol className="focus-progress" aria-label={`Application progress: step ${activeIndex + 1} of 4`}>
    {labels.map((label, index) => <li key={label} className={index < activeIndex || complete[index] ? "complete" : index === activeIndex ? "active" : ""}>
      <span>{complete[index] ? "✓" : index + 1}</span>
      <b>{label}</b>
    </li>)}
  </ol>;
}

function RoleSnapshot({ job, onEdit, onOpenOfficial, compact = false }: { job?: Job; onEdit: () => void; onOpenOfficial: (url?: string) => void; compact?: boolean }) {
  if (!job) return null;
  const skills = skillsFor(job).slice(0, compact ? 3 : 5);
  return <section className="focus-role-snapshot" aria-label="Selected job">
    <div className="focus-role-topline">
      <span className={job.origin === "demo_fixture" ? "sample" : ""}>{sourceName(job)}</span>
      <div>
        {job.origin !== "demo_fixture" && job.url && <button type="button" onClick={() => onOpenOfficial(job.url)}>Open listing ↗</button>}
        <button type="button" onClick={onEdit}>{compact ? "Change" : "Edit job"}</button>
      </div>
    </div>
    <div className="focus-role-main">
      <div className="focus-company-mark" aria-hidden="true">{job.company.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
      <div>
        <h2>{job.title}</h2>
        <p>{job.company} <span>·</span> {job.location}</p>
        {skills.length > 0 && <div className="focus-skill-list">{skills.map((skill) => <span key={skill}>{skill}</span>)}</div>}
      </div>
    </div>
  </section>;
}

function FitSnapshot({ market }: { market: MarketReport }) {
  const direct = market.verified_strengths.slice(0, 4).map((item) => item.skill);
  const related = market.adjacent_strengths.slice(0, 2).map((item) => item.skill);
  const gaps = market.gaps.slice(0, 3).map((item) => item.skill);

  return <section className="focus-fit-snapshot" aria-label="Honest match summary">
    <div className="focus-coverage-ring" aria-label={`${market.coverage}% of listed requirements have direct CV evidence`}><span>{market.coverage}<small>%</small></span></div>
    <div className="focus-fit-copy">
      <p><b>{market.coverage}%</b> of the listed requirements have direct CV evidence.</p>
      <small>This is a requirement check, not a verdict on your potential.</small>
    </div>
    <div className="focus-fit-groups">
      <div><b>Directly supported</b><p>{direct.length ? direct.join(" · ") : "No direct matches yet"}</p></div>
      {related.length > 0 && <div className="related"><b>Related experience</b><p>{related.join(" · ")}</p></div>}
      {gaps.length > 0 && <div className="gaps"><b>Keep visible</b><p>{gaps.join(" · ")}</p></div>}
    </div>
  </section>;
}

function OutputPreview() {
  return <details className="focus-output-preview">
    <summary><span>What you will get from this application</span><i aria-hidden="true">⌄</i></summary>
    <ul>
      <li><b>Honest match</b><span>Which requirements your CV supports, and which ones it does not.</span></li>
      <li><b>Better wording</b><span>CV and cover-letter points tied to work you can back up.</span></li>
      <li><b>Practice and final files</b><span>Role-specific answers, then files you review and approve yourself.</span></li>
    </ul>
  </details>;
}

function MoreOptions({ candidate, selectedJob, runIsActive, onOpenCv, onFindRoles, onPasteRole, onOpenFullWorkspace }: {
  candidate: Candidate;
  selectedJob?: Job;
  runIsActive: boolean;
  onOpenCv: () => void;
  onFindRoles: () => void;
  onPasteRole: () => void;
  onOpenFullWorkspace: (view?: "match" | "rehearse" | "tailor" | "review") => void;
}) {
  return <details className="focus-more-options">
    <summary><span>Need something else?</span><small>Change your CV, job, or open all tools</small><i aria-hidden="true">⌄</i></summary>
    <div className="focus-more-grid">
      <button type="button" onClick={onOpenCv} disabled={runIsActive}><b>Update my CV</b><span>{candidate.evidence.length ? `${candidate.evidence.length} work examples on this screen` : "Add or paste your experience"}</span></button>
      <button type="button" onClick={onFindRoles} disabled={runIsActive}><b>Find another job</b><span>{selectedJob ? "Search published listings" : "Search when you are ready"}</span></button>
      <button type="button" onClick={onPasteRole} disabled={runIsActive}><b>Paste a job listing</b><span>Use a role you already found</span></button>
      <button type="button" className="full-studio" onClick={() => onOpenFullWorkspace("match")}><b>Open all application tools</b><span>Detailed match, practice, edits, and activity</span></button>
    </div>
  </details>;
}

export function FocusedApplication(props: FocusedApplicationProps) {
  const {
    candidate, selectedJob, usingDemoProfile, selectedIsPractice, serviceStatus,
    runState, market, patches, turns, activeAgent, notice, isBootstrapping,
    isMatching, isApproving, isExporting, runIsActive, canStartLiveAction,
    onDismissNotice, onOpenCv, onFindRoles, onPasteRole, onCheckFit,
    onBuildPlan, onEditRole, onOpenOfficial, onRetry, onApprove, onExport,
    onOpenFullWorkspace,
  } = props;
  const hasReviewableEvidence = candidate.evidence.some((item) => item.status === "verified");
  const step = completionState(usingDemoProfile, hasReviewableEvidence, selectedIsPractice, market, runState);
  const hasRealCv = !usingDemoProfile && hasReviewableEvidence;
  const hasRealRole = Boolean(selectedJob) && !selectedIsPractice;
  const isSample = usingDemoProfile || selectedIsPractice;
  const stepNumber = step === "cv" ? 1 : step === "role" ? 2 : step === "match" ? 3 : 4;
  const isReview = runState === "awaiting_approval" || runState === "approved";

  return <main className="focus-workspace" aria-labelledby="focus-title">
    <header className="focus-header">
      <a className="focus-brand" href="/" aria-label="HireSwarm home"><span aria-hidden="true">h.</span><b>hire<span>swarm</span></b></a>
      <div className="focus-header-actions">
        <button type="button" className={`focus-connection ${serviceStatus}`} onClick={onRetry} title="Check workspace connection">
          <i aria-hidden="true" />
          <span>{serviceStatus === "online" ? "Live workspace" : serviceStatus === "checking" ? "Connecting" : serviceStatus === "demo-only" ? "Sample mode" : "Live work paused"}</span>
        </button>
        <button type="button" className="focus-all-tools" onClick={() => onOpenFullWorkspace("match")}>More tools</button>
      </div>
    </header>

    <div className="focus-content">
      {serviceStatus === "offline" && <section className="focus-service-message offline" role="alert">
        <div><p>LIVE WORKSPACE PAUSED</p><h2>We cannot use live CVs or jobs just now.</h2><span>Your work on screen is safe. You can try again, or look at the clearly labelled sample setup below.</span></div>
        <button type="button" onClick={onRetry}>Try again</button>
      </section>}
      {serviceStatus === "demo-only" && <section className="focus-service-message sample" role="note">
        <div><p>SAMPLE MODE</p><h2>This is an example, not your application.</h2><span>Live CV import, job search, preparation, approval, and export are paused in sample-only mode.</span></div>
        <button type="button" onClick={onRetry}>Try live workspace</button>
      </section>}
      {notice && <div className="focus-notice" role="status" aria-live="polite"><span aria-hidden="true">i</span><p>{notice}</p><button type="button" onClick={onDismissNotice} aria-label="Dismiss message">Dismiss</button></div>}

      <div className="focus-intro">
        <p>{isSample ? "SAMPLE WORKFLOW" : "ONE APPLICATION AT A TIME"}</p>
        <h1 id="focus-title">{isSample ? usingDemoProfile ? "See how the process works — safely." : "This sample role is not your application." : `Let’s prepare ${candidate.name.split(/\s+/)[0] || "your"}’s next application.`}</h1>
        <span>{isSample ? usingDemoProfile ? "The CV and job below are examples only. Nothing is sent anywhere." : "Your CV stays yours. This job is a sample; choose a real role before you prepare an application." : "Keep the work focused: one CV, one job, then a clear plan you can review."}</span>
      </div>

      <StepProgress current={step} usingDemoProfile={usingDemoProfile} hasReviewableEvidence={hasReviewableEvidence} selectedIsPractice={selectedIsPractice} market={market} runState={runState} />

      <section className="focus-task-card" aria-busy={isMatching || runState === "running"}>
        <div className="focus-task-eyebrow"><span>STEP {stepNumber} OF 4</span>{isSample && <b>Sample only</b>}</div>

        {isBootstrapping && <p className="focus-connection-note" role="status">Checking the live workspace. You can start now — no public jobs are loading in the background.</p>}

        {step === "cv" && <>
          <h2>Start with your CV</h2>
          <p className="focus-task-lede">We will pull out the real work examples you can stand behind. You review them before they are used for any job.</p>
          <div className="focus-result-promise"><span aria-hidden="true">01</span><div><b>You will get a short, reviewable list of your work examples.</b><small>A work example is a CV line, project, or result that supports a claim.</small></div></div>
          <div className="focus-primary-row"><button type="button" className="focus-primary" onClick={onOpenCv} disabled={runIsActive}>Start with my CV <span aria-hidden="true">→</span></button>{selectedIsPractice && <button type="button" className="focus-secondary" onClick={onCheckFit} disabled={!canStartLiveAction || isMatching || runIsActive}>{isMatching ? "Checking the sample…" : "See a sample match"}</button>}</div>
          <p className="focus-boundary">Your CV is used for this session. HireSwarm does not submit applications for you.</p>
          <OutputPreview />
        </>}

        {step === "role" && <>
          <h2>Choose one job to prepare for</h2>
          <p className="focus-task-lede">Add a role you already found, or browse published listings. We will only prepare material for the job you choose.</p>
          <div className="focus-cv-check"><span aria-hidden="true">✓</span><div><b>{candidate.name || "Your CV"} is ready</b><small>{candidate.evidence.length} work example{candidate.evidence.length === 1 ? "" : "s"} ready to compare with a job.</small></div><button type="button" onClick={onOpenCv}>Change CV</button></div>
          <div className="focus-primary-row"><button type="button" className="focus-primary" onClick={onPasteRole} disabled={runIsActive}>Add a job listing <span aria-hidden="true">→</span></button><button type="button" className="focus-secondary" onClick={onFindRoles} disabled={runIsActive}>Find a public job</button></div>
          <p className="focus-boundary">A sample role is not enough for a real application. Choose or paste a real job when you are ready.</p>
          <OutputPreview />
        </>}

        {step === "match" && !market && runState !== "needs_evidence" && <>
          <h2>See how you match this job</h2>
          <p className="focus-task-lede">We compare the job requirements with the work examples in your CV. Gaps stay visible — we do not fill them with invented experience.</p>
          <RoleSnapshot job={selectedJob} onEdit={onEditRole} onOpenOfficial={onOpenOfficial} />
          <div className="focus-primary-row"><button type="button" className="focus-primary" onClick={onCheckFit} disabled={!canStartLiveAction || isMatching || runIsActive}>{isMatching ? "Checking your match…" : isSample ? "See the sample match" : "See my honest match"} <span aria-hidden="true">→</span></button></div>
          <p className="focus-boundary">You will get direct support, related experience, and honest gaps — not a rejection score.</p>
        </>}

        {step === "match" && market && runState !== "needs_evidence" && <>
          <h2>Your match is clear</h2>
          <p className="focus-task-lede">This is the useful part: what you can support today, what is related, and what should stay honest.</p>
          <RoleSnapshot job={selectedJob} onEdit={onEditRole} onOpenOfficial={onOpenOfficial} compact />
          <FitSnapshot market={market} />
          <div className="focus-primary-row"><button type="button" className="focus-primary" onClick={onBuildPlan} disabled={!canStartLiveAction || runIsActive}>Build my application plan <span aria-hidden="true">→</span></button><button type="button" className="focus-secondary" onClick={() => onOpenFullWorkspace("match")}>Review the full match</button></div>
          <p className="focus-boundary">Next, HireSwarm will draft evidence-linked improvements and practice prompts. You still review every change.</p>
        </>}

        {step === "match" && runState === "needs_evidence" && <>
          <h2>Strengthen this application first</h2>
          <p className="focus-task-lede">There is not enough direct support to safely prepare final files for this role. That is useful information, not a failure.</p>
          {market && <FitSnapshot market={market} />}
          <div className="focus-primary-row"><button type="button" className="focus-primary" onClick={onOpenCv}>Add a real work example <span aria-hidden="true">→</span></button><button type="button" className="focus-secondary" onClick={onFindRoles}>Choose another job</button></div>
          <p className="focus-boundary">Only add a CV line if it genuinely supports the missing requirement.</p>
        </>}

        {step === "finish" && runState === "running" && <>
          <h2>Building your application plan</h2>
          <p className="focus-task-lede">We are turning your confirmed work examples into CV improvements and practice prompts for this one role.</p>
          {market && <FitSnapshot market={market} />}
          <div className="focus-running"><span aria-hidden="true"><i /><i /><i /></span><div><b>{activeAgent || "Preparing your application"}</b><small>We keep unsupported claims out and will ask for your approval before any export.</small></div></div>
          <button type="button" className="focus-link-button" onClick={() => onOpenFullWorkspace("rehearse")}>Watch the detailed preparation</button>
        </>}

        {isReview && <>
          <h2>{runState === "approved" ? "Your files are ready" : "Review your application before export"}</h2>
          <p className="focus-task-lede">Your application plan is ready for a human check. Read the changes, practice if useful, then decide whether to approve the files.</p>
          <div className="focus-review-summary">
            <div><b>{patches.length}</b><span>evidence-linked CV improvement{patches.length === 1 ? "" : "s"}</span></div>
            <div><b>{turns.length}</b><span>role-specific practice prompt{turns.length === 1 ? "" : "s"}</span></div>
            <div><b>0</b><span>automatic submissions</span></div>
          </div>
          <div className="focus-primary-row">
            {runState === "awaiting_approval" && <button type="button" className="focus-primary" onClick={onApprove} disabled={!canStartLiveAction || isApproving}>{isApproving ? "Saving your approval…" : "Approve final files"} <span aria-hidden="true">→</span></button>}
            {runState === "approved" && <><button type="button" className="focus-primary" onClick={() => onExport("docx")} disabled={!canStartLiveAction || isExporting !== null}>{isExporting === "docx" ? "Preparing DOCX…" : "Download DOCX"} <span aria-hidden="true">↓</span></button><button type="button" className="focus-secondary" onClick={() => onExport("pdf")} disabled={!canStartLiveAction || isExporting !== null}>{isExporting === "pdf" ? "Preparing PDF…" : "Download PDF"}</button></>}
            <button type="button" className="focus-secondary" onClick={() => onOpenFullWorkspace("review")}>Review all changes</button>
          </div>
          <p className="focus-boundary">Approval unlocks a file download only. Applying remains your decision on the employer’s site.</p>
        </>}
      </section>

      {step !== "cv" && selectedJob && <section className="focus-current-line"><span>{hasRealCv && hasRealRole ? "CURRENT APPLICATION" : "SAMPLE CONTEXT"}</span><b>{selectedJob.title} at {selectedJob.company}</b><button type="button" onClick={onEditRole}>Change job</button></section>}
      {<MoreOptions candidate={candidate} selectedJob={selectedJob} runIsActive={runIsActive} onOpenCv={onOpenCv} onFindRoles={onFindRoles} onPasteRole={onPasteRole} onOpenFullWorkspace={onOpenFullWorkspace} />}
    </div>

    <footer className="focus-footer"><span>Evidence stays tied to your real work.</span><i aria-hidden="true">·</i><span>Nothing is submitted automatically.</span></footer>
  </main>;
}
