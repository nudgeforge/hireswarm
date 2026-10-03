"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

type Evidence = { evidence_id: string; source_section: string; source_text: string; skills: string[]; metric?: string; status: "verified" | "partial" | "unverified" };
type Candidate = { name: string; headline: string; location: string; preferences: string[]; resume_text: string; evidence: Evidence[] };

type ServiceStatus = "checking" | "online" | "offline" | "demo-only";

export function CandidateModal({ candidate, isDemoProfile, onClose, onChange, onRestore, onAnalyze, onUpload, isAnalyzing, isImporting, serviceStatus, runIsActive }: { candidate: Candidate; isDemoProfile: boolean; onClose: () => void; onChange: (field: keyof Candidate, value: string) => void; onRestore: () => void; onAnalyze: () => void; onUpload: (file: File) => void; isAnalyzing: boolean; isImporting: boolean; serviceStatus: ServiceStatus; runIsActive: boolean }) {
  const liveUnavailable = serviceStatus === "offline" || serviceStatus === "demo-only";
  const controlsLocked = liveUnavailable || runIsActive;
  return <ModalShell onClose={onClose} eyebrow={isDemoProfile ? "DEMO PROFILE · YOUR CV" : "YOUR CV"} title="Add your CV">
    {isDemoProfile && <p className="modal-demo-note" role="note"><b>Demo profile:</b> Hussain Ahmed and the text below are sample data only. Use your own CV before a real fit summary.</p>}
    {isDemoProfile && <aside className="evidence-first-use" role="note" aria-label="What Evidence means"><span aria-hidden="true">i</span><div><b>What does Evidence mean?</b><p>Evidence means a real CV line, project, or work example that supports a skill. We keep the source visible so you can check it before using it.</p></div></aside>}
    <p className="modal-copy">Upload a real PDF, DOCX, or TXT CV, or paste your CV text below. <b>Work examples</b> are real CV lines or projects that support a skill or claim. Your document is parsed in memory for this session; HireSwarm does not retain the original file.</p>
    {serviceStatus === "checking" && <p className="modal-service-note" role="status">The live workspace is being confirmed. You can choose a file or edit your CV now; upload and refresh will continue as soon as it is ready.</p>}
    {liveUnavailable && <p className="modal-service-note" role="status">{serviceStatus === "demo-only" ? "You chose the sample-only workspace." : "The live workspace is unavailable."} You may review or edit this local draft, but importing and refreshing work examples are paused.</p>}
    {runIsActive && <p className="modal-service-note" role="status">A practice session is using your current work examples. Profile edits are locked until its review is complete.</p>}
    <label className="upload-drop"><span>UPLOAD CV</span><input type="file" disabled={controlsLocked} accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} /><b>{isImporting ? serviceStatus === "checking" ? "Checking workspace before upload…" : "Reading your document…" : runIsActive ? "Upload paused until the active session finishes" : liveUnavailable ? "Upload paused while live workspace is unavailable" : serviceStatus === "checking" ? "Choose a file — we will check the workspace next" : "Choose a PDF, DOCX, or TXT file"}</b><small>Text-based PDFs only · 6 MB maximum · source file is not stored</small></label>
    <label>Name<input disabled={runIsActive} value={candidate.name} onChange={(event) => onChange("name", event.target.value)} /></label>
    <label>Professional headline<input disabled={runIsActive} value={candidate.headline} onChange={(event) => onChange("headline", event.target.value)} /></label>
    <label>Paste CV text<textarea disabled={runIsActive} rows={8} value={candidate.resume_text} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange("resume_text", event.target.value)} /></label>
    <div className="modal-evidence"><b>{isDemoProfile ? `${candidate.evidence.length} sample work examples` : candidate.evidence.length ? `We found ${candidate.evidence.length} work example${candidate.evidence.length === 1 ? "" : "s"}.` : "Work examples will appear here."}</b><span>Every suggested claim stays linked to a real source.</span></div>
    {!isDemoProfile && candidate.evidence.length > 0 && <details className="modal-example-review"><summary>Review found work examples <span>⌄</span></summary><ul>{candidate.evidence.slice(0, 6).map((item) => <li key={item.evidence_id}><b>{item.source_section}</b><span>{item.source_text}</span></li>)}</ul></details>}
    <div className="modal-actions"><button className="text-action" onClick={onRestore} disabled={runIsActive}>Use demo profile</button><div><button className="outline-action" onClick={onAnalyze} disabled={controlsLocked || isAnalyzing || isImporting}>{isAnalyzing ? serviceStatus === "checking" ? "Checking workspace…" : "Reading CV…" : serviceStatus === "checking" ? "Check and refresh work examples" : "Refresh work examples"}</button><button className="primary-action small" onClick={onClose}>Save changes</button></div></div>
  </ModalShell>;
}

export function JobModal({ title, company, location, url, description, onTitle, onCompany, onLocation, onUrl, onDescription, onClose, onSubmit }: { title: string; company: string; location: string; url: string; description: string; onTitle: (value: string) => void; onCompany: (value: string) => void; onLocation: (value: string) => void; onUrl: (value: string) => void; onDescription: (value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell onClose={onClose} eyebrow="PASTE A JOB LISTING" title="Which role are you preparing for?"><p className="modal-copy">Paste a listing from a source you trust. It stays visibly labeled as added by you, and the original URL remains available for your final application. HireSwarm does not fetch this URL or apply for you.</p><form onSubmit={onSubmit}><div className="field-grid"><label>Role title<input required minLength={2} value={title} onChange={(event) => onTitle(event.target.value)} /></label><label>Company<input required minLength={2} value={company} onChange={(event) => onCompany(event.target.value)} /></label><label>Location<input value={location} onChange={(event) => onLocation(event.target.value)} /></label><label>Official listing URL <input type="url" pattern="https://.*" value={url} onChange={(event) => onUrl(event.target.value)} placeholder="https://…" title="Use a public HTTPS listing URL, or leave this optional field blank." /><small>Optional · public HTTPS only · kept as a link, never fetched by HireSwarm</small></label></div><label>Job description<textarea required minLength={20} rows={9} value={description} onChange={(event) => onDescription(event.target.value)} placeholder="Paste the role, responsibilities, and requirements here…" /></label><div className="modal-actions"><button type="button" className="text-action" onClick={onClose}>Cancel</button><button className="primary-action small" type="submit">Add to my applications <span>→</span></button></div></form></ModalShell>;
}

export function LiveRolesModal({ onClose, onDiscover, onConnect }: { onClose: () => void; onDiscover: (query: string, source: "all" | "remotive" | "arbeitnow") => Promise<void>; onConnect: (source: "greenhouse" | "lever", board: string) => Promise<void> }) {
  const [query, setQuery] = useState("Python developer");
  const [settledQuery, setSettledQuery] = useState("Python developer");
  const [feed, setFeed] = useState<"all" | "remotive" | "arbeitnow">("all");
  const [boardSource, setBoardSource] = useState<"greenhouse" | "lever">("greenhouse");
  const [board, setBoard] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(query.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [query]);
  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestedQuery = query.trim();
    setBusy(true);
    try {
      // The live provider is intentionally reached only after this button/form
      // action. This small wait debounces rapid type-and-submit input.
      if (settledQuery !== requestedQuery) await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
      await onDiscover(requestedQuery, feed);
    } finally { setBusy(false); }
  }
  async function connect(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!board.trim()) return; setBusy(true); try { await onConnect(boardSource, board.trim()); } finally { setBusy(false); } }
  return <ModalShell onClose={onClose} eyebrow="PUBLIC JOB SOURCES" title="Find a suitable role."><p className="modal-copy">Search public listings when you are ready. HireSwarm reads published role details only; it never asks for employer credentials and never sends an application on your behalf.</p><section className="source-option"><div><span className="source-badge live">PUBLIC FEEDS</span><h3>Discover public remote roles</h3><p>Remotive and Arbeitnow are fetched only after you choose Find public roles. Search text settles for 400 ms as you type; no per-keystroke request is sent. Results are capped at 12, with server-side cache protection.</p></div><form onSubmit={find}><div className="field-grid compact"><label>Search terms (2+ characters)<input required minLength={2} maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Python backend" /></label><label>Source<select value={feed} onChange={(event) => setFeed(event.target.value as "all" | "remotive" | "arbeitnow")}><option value="all">All public feeds</option><option value="remotive">Remotive</option><option value="arbeitnow">Arbeitnow</option></select></label></div><button className="outline-action" disabled={busy}>{busy ? "Checking…" : "Find public roles"} <span>↗</span></button></form></section><section className="source-option"><div><span className="source-badge official">OFFICIAL COMPANY BOARD</span><h3>Connect one company&apos;s public board</h3><p>Paste a board token or an HTTPS URL on boards.greenhouse.io, job-boards.greenhouse.io, or jobs.lever.co. HireSwarm reads published roles only and keeps the official apply link intact.</p></div><form onSubmit={connect}><div className="field-grid compact"><label>Board type<select value={boardSource} onChange={(event) => setBoardSource(event.target.value as "greenhouse" | "lever")}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option></select></label><label>Public board URL or token<input required value={board} onChange={(event) => setBoard(event.target.value)} placeholder={boardSource === "greenhouse" ? "boards.greenhouse.io/company" : "jobs.lever.co/company"} /></label></div><button className="primary-action small" disabled={busy}>{busy ? "Connecting…" : "Read published roles"} <span>→</span></button></form></section><p className="source-footnote">If a public source is unavailable, no lookalike fixture is shown. You can always paste the role directly.</p></ModalShell>;
}

export function HowItWorksModal({ onClose, onOpenProfile, onOpenLive, onOpenManual }: { onClose: () => void; onOpenProfile: () => void; onOpenLive: () => void; onOpenManual: () => void }) {
  return <ModalShell onClose={onClose} eyebrow="YOUR GUIDED PATH" title="Use HireSwarm for one real application.">
    <p className="modal-copy">A demo uses clearly labeled sample data so you can explore safely. For real work, add your own CV and choose a role you trust. HireSwarm prepares evidence-backed material only; it never submits an application.</p>
    <ol className="testing-guide">
      <li><span>01</span><div><b>Add your CV</b><p>Upload a text-based PDF, DOCX, or TXT file, or paste your experience. Review the work examples found in your real CV.</p><button className="text-action" onClick={onOpenProfile}>Start with my CV →</button></div></li>
      <li><span>02</span><div><b>Choose a job</b><p>Find a public role, use an official company board, or paste a listing you have already found.</p><div className="guide-inline-actions"><button className="outline-action small" onClick={onOpenLive}>Find public roles</button><button className="outline-action small" onClick={onOpenManual}>Paste a listing</button></div></div></li>
      <li><span>03</span><div><b>Understand your fit</b><p>See direct evidence, related experience, and honest gaps requirement by requirement. It is not a rejection score.</p></div></li>
      <li><span>04</span><div><b>Build your application story</b><p>Turn supported work into CV points, cover letter points, and interview proof. Every suggestion remains linked to its source.</p></div></li>
      <li><span>05</span><div><b>Practice, then review</b><p>Prepare likely interview answers, review every proposed claim, and approve the final packet yourself before PDF or DOCX export.</p></div></li>
    </ol>
    <div className="guide-boundary"><span>✓</span><p><b>Safe test rule:</b> Start with a copied job description and a non-sensitive CV version. Do not paste credentials, national ID details, or private employer information.</p></div>
    <div className="modal-actions"><span className="guide-status">No automatic applications. No unsupported claims.</span><button className="primary-action small" onClick={onClose}>Got it — open workspace</button></div>
  </ModalShell>;
}

function ModalShell({ eyebrow, title, children, onClose }: { eyebrow: string; title: string; children: React.ReactNode; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const closeAction = useRef(onClose);
  useEffect(() => { closeAction.current = onClose; }, [onClose]);
  useEffect(() => {
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeAction.current(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><button ref={closeButton} className="close-modal" onClick={onClose} aria-label={`Close ${title}`}>×</button><p className="kicker">{eyebrow}</p><h2>{title}</h2>{children}</section></div>;
}
