"use client";

export type GuidedStage = "welcome" | "starting-point" | "profile" | "role";

type GuidedStartProps = {
  stage: GuidedStage;
  onStart: () => void;
  onExploreDemo: () => void;
  onChooseCv: () => void;
  onChooseRole: () => void;
  onChooseSearch: () => void;
  onOpenCv: () => void;
  onFindRoles: () => void;
  onPasteRole: () => void;
  onUseDemoRole: () => void;
  onBack: () => void;
  isActionChecking: boolean;
  serviceStatus: "checking" | "online" | "offline" | "demo-only";
  onRetry: () => void;
};

function Brand() {
  return <div className="guided-brand" aria-label="HireSwarm"><span className="guided-mark" aria-hidden="true">h.</span><b>hire<span>swarm</span></b></div>;
}

function InitialProgress({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Add your CV", "Choose one job", "Get your plan"];
  return <ol className="guided-progress" aria-label={`Step ${current} of 3`}>
    {steps.map((label, index) => <li key={label} className={index + 1 === current ? "active" : index + 1 < current ? "complete" : ""}><span>{index + 1 < current ? "✓" : String(index + 1).padStart(2, "0")}</span><b>{label}</b></li>)}
  </ol>;
}

export function GuidedStart({ stage, onStart, onExploreDemo, onChooseCv, onChooseRole, onChooseSearch, onOpenCv, onFindRoles, onPasteRole, onUseDemoRole, onBack, isActionChecking, serviceStatus, onRetry }: GuidedStartProps) {
  const showProgress = stage === "profile" || stage === "role";
  const progressStep = stage === "profile" ? 1 : 2;

  return <main className="guided-app" aria-labelledby="guided-title">
    <header className="guided-header">
      <Brand />
      <p><span aria-hidden="true">✓</span> You approve every export</p>
    </header>
    <div className="guided-content">
      {serviceStatus === "offline" && <section className="guided-service-outage" role="alert" aria-labelledby="guided-service-outage-title"><div><p>LIVE WORKSPACE PAUSED</p><h2 id="guided-service-outage-title">The workspace is temporarily unavailable.</h2><span>Your draft is safe. Try again or continue with the demo.</span></div><div><button onClick={onRetry}>Try again</button><button onClick={onExploreDemo}>Continue with demo</button></div></section>}
      {serviceStatus === "checking" && <p className="guided-service-check" role="status">Preparing the live workspace. You can still choose your starting point now.</p>}
      {showProgress && <div className="guided-back-row"><button className="guided-back" onClick={onBack}>← Back</button><InitialProgress current={progressStep} /></div>}

      {stage === "welcome" && <section className="guided-welcome">
        <div className="guided-welcome-copy">
          <p className="guided-kicker">ONE HONEST APPLICATION AT A TIME</p>
          <h1 id="guided-title">Prepare a stronger application from the work you have <em>actually done.</em></h1>
          <p className="guided-lede">HireSwarm helps you understand your match, improve your story, and practise for one role. You review and approve everything before export.</p>
          <div className="guided-actions">
            <button className="guided-primary" onClick={onStart}>Start a job application <span>→</span></button>
            <button className="guided-secondary" onClick={onExploreDemo}>Explore a demo</button>
          </div>
          <p className="guided-boundary">No invented experience. No automatic applications.</p>
        </div>
        <aside className="guided-outcomes" aria-label="What HireSwarm helps you prepare">
          <p>WHAT YOU WILL GET</p>
          <div><span>01</span><article><b>Your match, explained</b><small>See which parts of your experience support a role.</small></article></div>
          <div><span>02</span><article><b>An honest application plan</b><small>Highlight proof, keep gaps visible, and know what to improve.</small></article></div>
          <div><span>03</span><article><b>Final files you approve</b><small>Review CV points, practice answers, then export PDF or DOCX yourself.</small></article></div>
        </aside>
      </section>}

      {stage === "starting-point" && <section className="guided-step-card">
        <p className="guided-kicker">START A JOB APPLICATION</p>
        <h1 id="guided-title">What do you have ready?</h1>
        <p className="guided-lede compact">Start with one thing. We will guide the next step instead of dropping you into a dashboard.</p>
        <div className="guided-choice-list">
          <button className="guided-choice primary" onClick={onChooseCv}><span>01</span><div><b>My CV</b><small>I want to start with my experience.</small></div><i>→</i></button>
          <button className="guided-choice" onClick={onChooseRole}><span>02</span><div><b>A job listing</b><small>I already know which role I want.</small></div><i>→</i></button>
          <button className="guided-choice" onClick={onChooseSearch} disabled={isActionChecking}><span>03</span><div><b>Neither yet</b><small>{isActionChecking ? "Checking the workspace…" : "Help me find a suitable role."}</small></div><i>→</i></button>
        </div>
        <p className="guided-demo-line">Want to look around first? <button onClick={onExploreDemo}>Explore sample data</button> — nothing is a real application in the demo.</p>
      </section>}

      {stage === "profile" && <section className="guided-step-card guided-task-card">
        <p className="guided-kicker">STEP 1 OF 3</p>
        <h1 id="guided-title">Add your CV</h1>
        <p className="guided-lede compact">We will find real work examples and connect them to job requirements. We will not invent experience.</p>
        <div className="guided-task-preview"><span aria-hidden="true">↗</span><div><b>Upload a PDF, DOCX, or TXT file</b><small>Or paste CV text. Your source document is used only for this session.</small></div></div>
        <div className="guided-actions"><button className="guided-primary" onClick={onOpenCv}>Upload or paste my CV <span>→</span></button></div>
        <p className="guided-helper">After processing, you will review the work examples we found before continuing.</p>
      </section>}

      {stage === "role" && <section className="guided-step-card guided-task-card">
        <p className="guided-kicker">STEP 2 OF 3</p>
        <h1 id="guided-title">Choose one role to prepare for</h1>
        <p className="guided-lede compact">Use a listing you trust. We only prepare material for the role you choose — HireSwarm never applies on your behalf.</p>
        <div className="guided-role-actions">
          <button className="guided-choice primary" onClick={onFindRoles} disabled={isActionChecking}><span>⌕</span><div><b>{isActionChecking ? "Checking workspace…" : "Find public roles"}</b><small>Search published listings when you are ready.</small></div><i>→</i></button>
          <button className="guided-choice" onClick={onPasteRole}><span>+</span><div><b>Paste a job listing</b><small>Add a role you already found.</small></div><i>→</i></button>
          <button className="guided-choice quiet" onClick={onUseDemoRole}><span>◎</span><div><b>Use the demo role</b><small>Practice safely with clearly labelled sample data.</small></div><i>→</i></button>
        </div>
      </section>}
    </div>
    <footer className="guided-footer"><span>Evidence stays linked to your real work.</span><span>·</span><span>Nothing is submitted automatically.</span></footer>
  </main>;
}
