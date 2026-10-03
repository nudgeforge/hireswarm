"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type ServiceState = "checking" | "online" | "offline";
type Stage = "welcome" | "cv" | "job" | "match" | "preparing" | "review";
type RunState = "idle" | "running" | "awaiting_approval" | "approved" | "failed";

type Evidence = {
  evidence_id: string;
  source_section: string;
  source_text: string;
  skills: string[];
  metric?: string;
  status: "verified" | "partial" | "unverified";
};

type Candidate = {
  name: string;
  headline: string;
  location: string;
  preferences: string[];
  resume_text: string;
  evidence: Evidence[];
};

type Job = {
  id: string;
  origin: "demo_fixture" | "public_cache" | "user_pasted";
  source: string;
  title: string;
  company: string;
  location: string;
  type: string;
  url: string;
  description?: string;
  must_have?: string[];
  preferred?: string[];
  detail_loaded?: boolean;
};

type Match = {
  score: number;
  coverage: number;
  verified_strengths: { skill: string; evidence_ids: string[] }[];
  adjacent_strengths: { skill: string; evidence_ids: string[]; reason: string }[];
  gaps: { skill: string; severity: string }[];
};

type Patch = {
  section: string;
  original: string;
  proposed: string;
  evidence_ids: string[];
  covered_requirements: string[];
  reason: string;
};

type Turn = {
  round: number;
  requirement: string;
  question?: string;
  answer?: string;
  status?: string;
  evidence_ids?: string[];
  verdict?: string;
};

type ExportReadiness = {
  passed: boolean;
  verified_bullets: number;
  extracted_characters: number;
};

type StreamEvent = {
  type: string;
  agent?: string | null;
  title: string;
  message?: string | null;
  payload: Record<string, unknown>;
};

type SourceResponse = { jobs: Job[]; source_errors?: string[]; provenance?: { cache_state?: string } };

const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE;
const API = configuredApiBase === undefined ? "/backend" : configuredApiBase.replace(/\/+$/, "");

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && typeof (payload as { detail?: unknown }).detail === "string") return (payload as { detail: string }).detail;
  return fallback;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("We could not reach HireSwarm. Your work on this screen is still safe.");
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); }
    catch { throw new Error("HireSwarm returned an unreadable response. Please try again."); }
  }
  if (!response.ok) throw new Error(errorMessage(payload, `That action could not be completed (${response.status}).`));
  return payload as T;
}

function initialJobForm() {
  return { title: "", company: "", location: "", url: "", description: "" };
}

function Progress({ stage, hasCv, hasJob, hasMatch, approved }: { stage: Stage; hasCv: boolean; hasJob: boolean; hasMatch: boolean; approved: boolean }) {
  const current = stage === "welcome" || stage === "cv" ? 0 : stage === "job" ? 1 : stage === "match" ? 2 : 3;
  const complete = [hasCv, hasJob, hasMatch, approved];
  return <ol className="clean-progress" aria-label={`Application progress: step ${current + 1} of 4`}>
    {["CV", "Job", "Fit", "Files"].map((label, index) => <li key={label} className={complete[index] ? "complete" : current === index ? "current" : ""}><span>{complete[index] ? "✓" : index + 1}</span><b>{label}</b></li>)}
  </ol>;
}

export default function CleanApp() {
  const [service, setService] = useState<ServiceState>("checking");
  const [stage, setStage] = useState<Stage>("welcome");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [coverLetter, setCoverLetter] = useState("");
  const [readiness, setReadiness] = useState<ExportReadiness | null>(null);
  const [activeWork, setActiveWork] = useState("Getting ready");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"upload" | "cv" | "job" | "search" | "match" | "run" | "approve" | "docx" | "pdf" | null>(null);
  const [cvText, setCvText] = useState("");
  const [jobForm, setJobForm] = useState(initialJobForm);
  const [search, setSearch] = useState("Python developer");
  const [results, setResults] = useState<Job[]>([]);
  const stream = useRef<EventSource | null>(null);

  const hasCv = Boolean(candidate?.evidence.some((item) => item.status === "verified"));
  const hasJob = Boolean(job && job.origin !== "demo_fixture");
  const hasMatch = Boolean(match);
  const approved = runState === "approved";

  async function health() {
    setService("checking");
    try {
      const response = await fetch(`${API}/healthz`);
      const result = await response.json() as { ok?: boolean };
      if (!response.ok || !result.ok) throw new Error("not ready");
      setService("online");
      return true;
    } catch {
      setService("offline");
      return false;
    }
  }

  useEffect(() => { void health(); return () => stream.current?.close(); }, []);

  async function ensureLive() {
    if (service === "online") return true;
    const ready = await health();
    if (!ready) setError("The live workspace is unavailable right now. Please try again in a moment.");
    return ready;
  }

  function clearMessages() { setNotice(""); setError(""); }

  function clearTarget() {
    stream.current?.close();
    stream.current = null;
    setJob(null); setMatch(null); setPatches([]); setTurns([]); setCoverLetter("");
    setReadiness(null); setRunState("idle"); setRunId(null); setResults([]);
  }

  function changeCv() {
    clearMessages(); clearTarget(); setCandidate(null); setCvText(""); setJobForm(initialJobForm()); setStage("cv");
  }

  function changeJob() {
    clearMessages(); clearTarget(); setJobForm(initialJobForm()); setStage("job");
  }

  async function uploadCv(file: File) {
    clearMessages();
    if (!await ensureLive()) return;
    setBusy("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await jsonRequest<{ candidate: Candidate; import: { evidence_count: number } }>(`${API}/api/candidate/upload`, { method: "POST", body: form });
      clearTarget();
      setCandidate(result.candidate);
      setJobForm(initialJobForm());
      setStage("job");
      setNotice(`CV added. We found ${result.import.evidence_count} real work example${result.import.evidence_count === 1 ? "" : "s"}. Next, add one job.`);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "We could not read that CV."); }
    finally { setBusy(null); }
  }

  async function usePastedCv() {
    const text = cvText.trim();
    if (text.length < 80) { setError("Paste a little more of your CV before continuing."); return; }
    const file = new File([text], "pasted-cv.txt", { type: "text/plain" });
    await uploadCv(file);
  }

  async function addJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    if (!candidate || !await ensureLive()) return;
    setBusy("job");
    try {
      const added = await jsonRequest<Job>(`${API}/api/jobs/manual`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(jobForm) });
      clearTarget();
      setJob(added);
      setStage("match");
      setNotice("Job added. Check what your CV supports before preparing anything.");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "We could not add that job."); }
    finally { setBusy(null); }
  }

  async function findJobs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    if (!await ensureLive()) return;
    const term = search.trim();
    if (term.length < 2) { setError("Enter at least two characters to search public jobs."); return; }
    setBusy("search");
    try {
      const found = await jsonRequest<SourceResponse>(`${API}/api/jobs/live?query=${encodeURIComponent(term)}&source=all`);
      if (!found.jobs.length) throw new Error(found.source_errors?.[0] || "No public jobs matched that search. Try another term or paste a listing.");
      setResults(found.jobs.slice(0, 6));
    } catch (issue) { setError(issue instanceof Error ? issue.message : "We could not search public jobs."); }
    finally { setBusy(null); }
  }

  async function selectPublicJob(selected: Job) {
    clearMessages();
    if (!await ensureLive()) return;
    setBusy("search");
    try {
      const detail = await jsonRequest<Job>(`${API}/api/jobs/${encodeURIComponent(selected.id)}`);
      clearTarget();
      setJob(detail);
      setStage("match");
      setNotice("Job selected. Check your fit before preparing files.");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "We could not open that job."); }
    finally { setBusy(null); }
  }

  async function checkMatch() {
    clearMessages();
    if (!candidate || !job || !await ensureLive()) return;
    setBusy("match");
    try {
      const result = await jsonRequest<Match>(`${API}/api/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, candidate }) });
      setMatch(result);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "We could not check this match."); }
    finally { setBusy(null); }
  }

  function updateTurn(round: number, change: Partial<Turn>) {
    setTurns((previous) => {
      const present = previous.find((item) => item.round === round);
      if (present) return previous.map((item) => item.round === round ? { ...item, ...change } : item);
      return [...previous, { round, requirement: String(change.requirement || "Job requirement"), ...change }].sort((a, b) => a.round - b.round);
    });
  }

  function receiveEvent(event: StreamEvent) {
    if (event.agent) setActiveWork(event.agent);
    if (event.type === "market_report") setMatch(event.payload as unknown as Match);
    if (event.type === "interview_question") updateTurn(Number(event.payload.round || 1), { requirement: String(event.payload.requirement || "Job requirement"), question: String(event.payload.question || event.message || "") });
    if (event.type === "candidate_answer") updateTurn(Number(event.payload.round || 1), { answer: String(event.payload.answer || event.message || ""), status: String(event.payload.status || ""), evidence_ids: Array.isArray(event.payload.evidence_ids) ? event.payload.evidence_ids.map(String) : [] });
    if (event.type === "interview_verdict" || event.type === "gap_detected") updateTurn(Number(event.payload.round || 1), { verdict: String(event.payload.verdict || event.message || ""), status: String(event.payload.status || "") });
    if (event.type === "resume_patch") {
      setPatches(Array.isArray(event.payload.patches) ? event.payload.patches as Patch[] : []);
      setCoverLetter(String(event.payload.cover_letter || ""));
    }
    if (event.type === "export_readiness") setReadiness(event.payload as unknown as ExportReadiness);
    if (event.type === "approval_required") { setRunState("awaiting_approval"); setStage("review"); setActiveWork("Ready for your review"); }
    if (event.type === "evidence_needed") { setRunState("idle"); setStage("match"); setError(event.message || "This job needs stronger direct evidence before files can be prepared."); }
    if (event.type === "run_failed") { setRunState("failed"); setStage("match"); setError(event.message || "The preparation could not finish. Please try again."); }
  }

  async function prepareApplication() {
    clearMessages();
    if (!candidate || !job || !await ensureLive()) return;
    setBusy("run"); setRunState("running"); setStage("preparing"); setActiveWork("Checking your CV evidence");
    try {
      const created = await jsonRequest<{ run_id: string }>(`${API}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, candidate, mode: "evidence_lab" }) });
      setRunId(created.run_id);
      stream.current?.close();
      const source = new EventSource(`${API}/api/runs/${created.run_id}/events`);
      stream.current = source;
      let finished = false;
      source.onmessage = (message) => { try { receiveEvent(JSON.parse(message.data) as StreamEvent); } catch { setError("One live update could not be read. Please retry the preparation."); } };
      source.addEventListener("done", () => { finished = true; source.close(); });
      source.onerror = () => { source.close(); if (!finished) { setRunState("failed"); setStage("match"); setError("The live preparation disconnected before it finished. Nothing was exported."); } };
    } catch (issue) { setRunState("failed"); setStage("match"); setError(issue instanceof Error ? issue.message : "We could not start preparation."); }
    finally { setBusy(null); }
  }

  async function approve() {
    clearMessages();
    if (!runId || !await ensureLive()) return;
    setBusy("approve");
    try {
      await jsonRequest(`${API}/api/runs/${encodeURIComponent(runId)}/approve`, { method: "POST" });
      setRunState("approved"); setStage("review"); setNotice("Approved. Your files are ready to download. Nothing has been submitted to an employer.");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "We could not save your approval."); }
    finally { setBusy(null); }
  }

  async function download(format: "docx" | "pdf") {
    clearMessages();
    if (!runId || !await ensureLive()) return;
    setBusy(format);
    try {
      const response = await fetch(`${API}/api/runs/${encodeURIComponent(runId)}/export/${format}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(errorMessage(body, "We could not create that download."));
      }
      const file = await response.blob();
      if (!file.size) throw new Error("That file was empty. Please try again.");
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = format === "docx" ? "HireSwarm_Application.docx" : "HireSwarm_Application.pdf";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "We could not create that download."); }
    finally { setBusy(null); }
  }

  const pageTitle = stage === "welcome" ? "Make one job application stronger." : stage === "cv" ? "Add your CV." : stage === "job" ? "Add one job." : stage === "match" ? match ? "Here is your honest fit." : "Check your fit." : stage === "preparing" ? "Preparing your application." : runState === "approved" ? "Your files are ready." : "Review before download.";

  return <main className="clean-app" aria-labelledby="clean-title">
    <header className="clean-header"><a href="/" className="clean-logo" aria-label="HireSwarm home"><span>h.</span><b>hire<span>swarm</span></b></a><button type="button" className={`clean-status ${service}`} onClick={() => void health()}><i aria-hidden="true" />{service === "online" ? "Live" : service === "checking" ? "Checking" : "Offline"}</button></header>
    <section className="clean-page">
      {(notice || error) && <div className={error ? "clean-message error" : "clean-message"} role={error ? "alert" : "status"}><p>{error || notice}</p><button type="button" onClick={clearMessages} aria-label="Dismiss message">×</button></div>}
      {service === "offline" && <div className="clean-offline" role="alert"><b>The live workspace is unavailable.</b><span>Your work on screen is safe. Try again before uploading or exporting.</span><button type="button" onClick={() => void health()}>Try again</button></div>}
      <p className="clean-kicker">ONE JOB AT A TIME</p><h1 id="clean-title">{pageTitle}</h1><p className="clean-subtitle">{stage === "welcome" ? "Use your real CV to understand one role, improve the wording you can support, and download files only after you approve them." : stage === "cv" ? "We will pull out real work examples. We never add skills you did not provide." : stage === "job" ? "Paste a job you found, or search public listings. We will only work on the one you choose." : stage === "match" ? "Direct evidence, related experience, and gaps stay separate." : stage === "preparing" ? "We are building evidence-based wording and practice prompts. Nothing is being submitted." : "Check what was prepared, then decide whether to unlock downloads."}</p>
      {stage !== "welcome" && <Progress stage={stage} hasCv={hasCv} hasJob={hasJob} hasMatch={hasMatch} approved={approved} />}

      {stage === "welcome" && <section className="clean-card clean-welcome"><div className="clean-welcome-list"><span>1</span><p><b>Add your CV</b><small>We find real work examples.</small></p><span>2</span><p><b>Add one job</b><small>We compare it with your CV.</small></p><span>3</span><p><b>Review and download</b><small>You approve every file yourself.</small></p></div><button type="button" className="clean-primary" onClick={() => setStage("cv")}>Start with my CV <span>→</span></button><p className="clean-boundary">No invented experience. No automatic applications.</p></section>}

      {stage === "cv" && <section className="clean-card"><h2>Your CV</h2><p className="clean-copy">Choose a PDF, DOCX, or TXT file. Or paste its text below. Your source document is only parsed for this session.</p><label className="clean-upload"><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={busy !== null || service === "offline"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCv(file); event.currentTarget.value = ""; }} /><span>{busy === "upload" ? "Reading your CV…" : "Choose CV file"}</span><small>PDF, DOCX, or TXT · up to 6 MB</small></label><div className="clean-divider"><span>or</span></div><label className="clean-field">Paste CV text<textarea value={cvText} onChange={(event) => setCvText(event.target.value)} rows={8} placeholder="Paste your CV text here…" disabled={busy !== null} /></label><button type="button" className="clean-primary" onClick={() => void usePastedCv()} disabled={busy !== null || service === "offline"}>{busy === "upload" ? "Reading your CV…" : "Use this CV"} <span>→</span></button></section>}

      {stage === "job" && candidate && <section className="clean-card"><div className="clean-ready"><span>✓</span><div><b>CV ready</b><small>{candidate.evidence.length} reviewable work example{candidate.evidence.length === 1 ? "" : "s"} found</small></div><button type="button" onClick={changeCv}>Change CV</button></div><h2>Add one job</h2><p className="clean-copy">Paste the role you want to prepare for. You can also search public listings below.</p><form className="clean-job-form" onSubmit={(event) => void addJob(event)}><div className="clean-field-grid"><label className="clean-field">Job title<input required value={jobForm.title} onChange={(event) => setJobForm((value) => ({ ...value, title: event.target.value }))} placeholder="e.g. Backend Engineer" /></label><label className="clean-field">Company<input required value={jobForm.company} onChange={(event) => setJobForm((value) => ({ ...value, company: event.target.value }))} placeholder="Company name" /></label></div><label className="clean-field">Location <span>optional</span><input value={jobForm.location} onChange={(event) => setJobForm((value) => ({ ...value, location: event.target.value }))} placeholder="e.g. Remote · Pakistan" /></label><label className="clean-field">Job description<textarea required minLength={20} rows={8} value={jobForm.description} onChange={(event) => setJobForm((value) => ({ ...value, description: event.target.value }))} placeholder="Paste the job description here…" /></label><details className="clean-optional"><summary>Add the official job link <span>optional</span></summary><label className="clean-field">Official job URL<input type="url" value={jobForm.url} onChange={(event) => setJobForm((value) => ({ ...value, url: event.target.value }))} placeholder="https://…" /></label></details><button className="clean-primary" disabled={busy !== null || service === "offline"}>{busy === "job" ? "Adding job…" : "Use this job"} <span>→</span></button></form><details className="clean-search"><summary>Or search public jobs <span>⌄</span></summary><form onSubmit={(event) => void findJobs(event)}><label className="clean-field">Search term<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. Python backend" /></label><button className="clean-secondary" disabled={busy !== null || service === "offline"}>{busy === "search" ? "Searching…" : "Search jobs"}</button></form>{results.length > 0 && <div className="clean-results">{results.map((result) => <button type="button" key={result.id} onClick={() => void selectPublicJob(result)} disabled={busy !== null}><b>{result.title}</b><span>{result.company} · {result.location}</span><small>Public listing</small></button>)}</div>}</details></section>}

      {stage === "match" && candidate && job && <section className="clean-card"><div className="clean-job"><small>{job.origin === "user_pasted" ? "JOB YOU ADDED" : "PUBLIC JOB"}</small><b>{job.title}</b><span>{job.company} · {job.location}</span><button type="button" onClick={changeJob}>Change job</button></div>{!match && <><h2>Check your fit</h2><p className="clean-copy">We will compare this job with your real CV evidence. Missing skills stay visible — they are never invented.</p><button type="button" className="clean-primary" onClick={() => void checkMatch()} disabled={busy !== null || service === "offline"}>{busy === "match" ? "Checking fit…" : "Check my fit"} <span>→</span></button></>}{match && <><div className="clean-score"><b>{match.coverage}<small>%</small></b><span>of listed requirements have direct CV support</span></div><div className="clean-match-groups"><section><b>Supported now</b><p>{match.verified_strengths.map((item) => item.skill).slice(0, 6).join(" · ") || "No direct support found"}</p></section>{match.adjacent_strengths.length > 0 && <section className="related"><b>Related experience</b><p>{match.adjacent_strengths.map((item) => item.skill).slice(0, 4).join(" · ")}</p></section>}{match.gaps.length > 0 && <section className="gaps"><b>Keep honest</b><p>{match.gaps.map((item) => item.skill).slice(0, 5).join(" · ")}</p></section>}</div><button type="button" className="clean-primary" onClick={() => void prepareApplication()} disabled={busy !== null || service === "offline"}>Create my application plan <span>→</span></button></>}</section>}

      {stage === "preparing" && <section className="clean-card"><h2>Preparing your application</h2><p className="clean-copy">This takes a few seconds. We are checking evidence, preparing interview prompts, and drafting safe wording.</p><div className="clean-working"><i /><i /><i /><div><b>{activeWork}</b><span>Your evidence remains the source of truth.</span></div></div><ol className="clean-work-list"><li>Check each job requirement against your CV</li><li>Prepare evidence-based interview answers</li><li>Draft wording that stays tied to source lines</li></ol></section>}

      {stage === "review" && <section className="clean-card"><h2>{approved ? "Your files are ready" : "Review your application"}</h2><p className="clean-copy">Nothing has been submitted. Review the supported updates, then approve only if they sound true to you.</p><div className="clean-review-counts"><div><b>{patches.length}</b><span>supported CV updates</span></div><div><b>{turns.length}</b><span>practice prompts</span></div><div><b>0</b><span>automatic submissions</span></div></div>{patches.length > 0 && <details className="clean-review-details" open><summary>CV updates prepared <span>⌄</span></summary>{patches.slice(0, 4).map((patch, index) => <article key={`${patch.section}-${index}`}><small>{patch.section} · supported by {patch.evidence_ids.join(", ")}</small><p>{patch.proposed}</p></article>)}</details>}{turns.length > 0 && <details className="clean-review-details"><summary>Practice prompts <span>⌄</span></summary>{turns.map((turn) => <article key={turn.round}><small>{turn.requirement} · {turn.status || "checking"}</small><p>{turn.question || "Preparing question…"}</p>{turn.answer && <p className="clean-answer">{turn.answer}</p>}</article>)}</details>}{coverLetter && <details className="clean-review-details"><summary>Cover letter points <span>⌄</span></summary><p className="clean-letter">{coverLetter}</p></details>}{readiness?.passed && <p className="clean-qa">✓ Document QA passed: {readiness.verified_bullets} supported bullet{readiness.verified_bullets === 1 ? "" : "s"} checked before release.</p>}{!approved && <button type="button" className="clean-primary" onClick={() => void approve()} disabled={busy !== null || service === "offline"}>{busy === "approve" ? "Saving approval…" : "Approve final files"} <span>→</span></button>}{approved && <div className="clean-downloads"><button type="button" className="clean-primary" onClick={() => void download("docx")} disabled={busy !== null || service === "offline"}>{busy === "docx" ? "Preparing DOCX…" : "Download DOCX"} <span>↓</span></button><button type="button" className="clean-secondary" onClick={() => void download("pdf")} disabled={busy !== null || service === "offline"}>{busy === "pdf" ? "Preparing PDF…" : "Download PDF"}</button></div>}</section>}
    </section>
    <footer className="clean-footer">Evidence stays tied to real work. <span>·</span> No automatic applications.</footer>
  </main>;
}
