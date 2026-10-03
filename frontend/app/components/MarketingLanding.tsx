import Link from "next/link";
import { Brand, Icon } from "./ProductPrimitives";

const steps = [
  ["01", "Upload your CV", "We turn your own writing into a reviewable evidence ledger."],
  ["02", "Choose your opportunity", "Paste a role or inspect a published job listing before committing."],
  ["03", "Collaborate with your AI team", "Your team maps fit, tests claims, and proposes source-linked wording."],
  ["04", "Approve your verified resume", "Nothing is exported — and nothing is submitted — until you decide."],
];

const team = [
  ["Candidate Twin", "Builds an evidence-bound professional narrative from your actual experience.", "CT"],
  ["HR Interrogator", "Challenges every requirement so unsupported claims stay visible.", "HR"],
  ["Resume Surgeon", "Turns verified examples into role-relevant, source-linked edits.", "RS"],
];

export default function MarketingLanding() {
  return <main className="hs-marketing">
    <header className="hs-marketing-nav">
      <Brand />
      <nav aria-label="Main navigation" className="hs-marketing-links">
        <a href="#how-it-works">How it works</a>
        <a href="#features">Features</a>
        <a href="#trust">Trust &amp; evidence</a>
      </nav>
      <div className="hs-marketing-actions">
        <Link className="hs-text-link" href="/workspace">Dashboard</Link>
        <Link className="hs-button hs-button-primary hs-button-small" href="/new">Get started <Icon name="arrow-right" size={15} /></Link>
      </div>
    </header>

    <section className="hs-hero" aria-labelledby="hero-title">
      <div className="hs-hero-copy">
        <p className="hs-eyebrow"><span className="hs-eyebrow-dot" /> Evidence-first application studio</p>
        <h1 id="hero-title">Your next application deserves a smarter team.</h1>
        <p className="hs-hero-lede">Three AI agents work together to challenge your experience, verify your evidence, and build a job-specific resume — with you in control.</p>
        <div className="hs-hero-actions">
          <Link className="hs-button hs-button-primary hs-button-large" href="/new">Build my resume <Icon name="arrow-right" /></Link>
          <a className="hs-button hs-button-secondary hs-button-large" href="#how-it-works"><Icon name="play" size={16} /> See how it works</a>
        </div>
        <p className="hs-hero-note"><Icon name="lock" size={15} /> No automatic applications. You approve every export.</p>
      </div>

      <div className="hs-product-preview" aria-label="Illustration of HireSwarm's evidence-backed application workflow">
        <div className="hs-preview-topbar"><span className="hs-preview-wordmark">HireSwarm <small>Product preview</small></span><span className="hs-preview-live"><i /> Evidence active</span></div>
        <div className="hs-preview-body">
          <aside className="hs-preview-agents">
            <p>AI TEAM</p>
            {team.map(([name, , initials], index) => <div className={`hs-preview-agent tone-${index + 1}`} key={name}><span>{initials}</span><b>{name}</b><small>{index === 1 ? "Reviewing fit" : "Ready"}</small></div>)}
          </aside>
          <section className="hs-preview-stream">
            <div className="hs-preview-heading"><span>MARKET SCOUT · OPPORTUNITY MAP</span><strong>Evidence collaboration</strong></div>
            <div className="hs-preview-event"><i className="tone-1">CT</i><p><b>Candidate Twin</b><span>Mapped FastAPI delivery to evidence <em>EV-03</em></span></p><Icon name="check" size={15} /></div>
            <div className="hs-preview-event"><i className="tone-2">HR</i><p><b>HR Interrogator</b><span>Kept Kubernetes as an honest gap</span></p><Icon name="warning" size={15} /></div>
            <div className="hs-preview-event"><i className="tone-3">RS</i><p><b>Resume Surgeon</b><span>Prepared a source-linked experience edit</span></p><Icon name="spark" size={15} /></div>
            <div className="hs-preview-line"><span /><span /><span /></div>
          </section>
          <aside className="hs-preview-document">
            <p>RESUME UPDATE</p>
            <b>Backend delivery</b>
            <span className="hs-preview-redacted w-100" /><span className="hs-preview-redacted w-82" />
            <div className="hs-preview-proof"><Icon name="evidence" size={15} /><span>Supported by<br /><b>EV-03 · EV-05</b></span></div>
            <div className="hs-preview-approve"><Icon name="check" size={14} /> Ready for review</div>
          </aside>
        </div>
      </div>
    </section>

    <section className="hs-logo-strip" aria-label="Product principles"><span>Evidence before embellishment</span><i /> <span>Human approval always</span><i /> <span>One role at a time</span></section>

    <section id="how-it-works" className="hs-section hs-steps-section" aria-labelledby="how-title">
      <div className="hs-section-intro"><p className="hs-eyebrow">HOW IT WORKS</p><h2 id="how-title">A clear path from experience to application.</h2><p>HireSwarm keeps the work focused. Each stage earns the next one with real source material.</p></div>
      <ol className="hs-steps-list">{steps.map(([number, title, copy]) => <li key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></li>)}</ol>
    </section>

    <section id="features" className="hs-section hs-team-section" aria-labelledby="team-title">
      <div className="hs-section-intro"><p className="hs-eyebrow">MEET YOUR AI TEAM</p><h2 id="team-title">Different perspectives. One evidence standard.</h2><p>Each agent has a distinct job. None of them gets to invent your experience.</p></div>
      <div className="hs-team-grid">{team.map(([name, copy, initials], index) => <article className={`hs-team-card tone-${index + 1}`} key={name}><span className="hs-agent-initials">{initials}</span><h3>{name}</h3><p>{copy}</p><span className="hs-team-rule">Source-linked by design</span></article>)}</div>
    </section>

    <section id="trust" className="hs-section hs-trust-section" aria-labelledby="trust-title">
      <div className="hs-trust-copy"><p className="hs-eyebrow">TRUST &amp; EVIDENCE</p><h2 id="trust-title">Useful AI should show its work.</h2><p>Generic resume tools can turn a job description into impressive-sounding claims. HireSwarm takes the harder route: it connects recommendations to your source statements and keeps gaps visible.</p><Link className="hs-text-link hs-text-link-brand" href="/new">See your evidence workspace <Icon name="arrow-right" size={16} /></Link></div>
      <div className="hs-evidence-comparison" aria-label="Comparison of unsupported and evidence-backed AI output">
        <section className="hs-claim-card hs-claim-unsupported"><div><Icon name="warning" size={18} /><span>UNSUPPORTED CLAIM</span></div><p>“Led a cloud-native Kubernetes migration.”</p><small>No source statement found</small></section>
        <section className="hs-claim-card hs-claim-supported"><div><Icon name="check" size={18} /><span>EVIDENCE-BACKED IMPROVEMENT</span></div><p>“Containerized a FastAPI service with Docker for an operations platform.”</p><small><Icon name="evidence" size={13} /> Linked to your CV evidence</small></section>
      </div>
    </section>

    <section className="hs-final-cta" aria-labelledby="cta-title"><div><p className="hs-eyebrow">HUMAN CONTROL, BUILT IN</p><h2 id="cta-title">Make your experience count.</h2><p>Review every source-linked change before exporting a resume or cover letter.</p></div><Link className="hs-button hs-button-primary hs-button-large" href="/new">Build my resume <Icon name="arrow-right" /></Link></section>

    <footer className="hs-marketing-footer"><Brand /><p>Evidence-backed career preparation. Never automatic applications.</p><Link href="/workspace">Open dashboard <Icon name="arrow-up-right" size={15} /></Link></footer>
  </main>;
}
