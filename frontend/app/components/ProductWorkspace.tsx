"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Brand, Icon, IconName, StatusDot } from "./ProductPrimitives";

export type ProductView = "overview" | "applications" | "new" | "evidence" | "resumes" | "agents" | "documents" | "settings";
type ServiceState = "checking" | "online" | "offline";
type WorkflowStage = "cv" | "job" | "fit" | "agents" | "review" | "export";
type RunState = "idle" | "running" | "needs_evidence" | "awaiting_approval" | "approved" | "failed";
type ToastKind = "success" | "error" | "info";
type ToastAction = "health" | "stream" | null;
type SourceFilter = "all" | "remotive" | "arbeitnow";

type Evidence = { evidence_id: string; source_section: string; source_text: string; skills: string[]; metric?: string; status: "verified" | "partial" | "unverified" };
type Candidate = { name: string; headline: string; location: string; preferences: string[]; resume_text: string; evidence: Evidence[] };
type Job = { id: string; origin: "demo_fixture" | "public_cache" | "user_pasted" | "public_feed"; source: string; title: string; company: string; location: string; type: string; url: string; description?: string; must_have?: string[]; preferred?: string[]; skills?: string[]; posted?: string; retrieved_at?: string | null; cache_state?: string; detail_loaded?: boolean };
type Match = { score: number; coverage: number; verified_strengths: { skill: string; evidence_ids: string[]; reason?: string }[]; adjacent_strengths: { skill: string; evidence_ids: string[]; reason: string }[]; gaps: { skill: string; severity: string }[] };
type Patch = { section: string; original: string; proposed: string; evidence_ids: string[]; covered_requirements: string[]; reason: string; status?: string };
type Turn = { round: number; requirement: string; question?: string; answer?: string; status?: string; evidence_ids?: string[]; verdict?: string };
type ExportCheck = { label: string; passed: boolean; detail: string };
type ExportReadiness = { passed: boolean; checks: ExportCheck[]; verified_bullets: number; extracted_characters: number };
type ActivityEvent = { type: string; title: string; agent?: string | null; message?: string | null; payload: Record<string, unknown>; at?: string | null };
type SourceResponse = { jobs: Job[]; source_errors?: string[]; provenance?: { label?: string; cache_state?: string; retrieved_at?: string | null; polling_policy?: string } };
type RunCheckpoint = { id: string; status: RunState; selected_job_id: string; mode: string; event_count: number; job?: Job | null };
type ApplicationRecord = { id: string; candidate: Candidate; job: Job; match: Match | null; runId: string | null; runState: RunState; stage: WorkflowStage; updatedAt: string; events: ActivityEvent[]; patches: Patch[]; turns: Turn[]; coverLetter: string; readiness: ExportReadiness | null; patchReview: Record<string, boolean> };
type SavedWorkspace = { version: 1; draftId: string; candidate: Candidate | null; job: Job | null; match: Match | null; runId: string | null; runState: RunState; stage: WorkflowStage; events: ActivityEvent[]; patches: Patch[]; turns: Turn[]; coverLetter: string; readiness: ExportReadiness | null; patchReview: Record<string, boolean> };

const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE;
const API = configuredApiBase === undefined ? "/backend" : configuredApiBase.replace(/\/+$/, "");
const WORKSPACE_KEY = "hireswarm.product.workspace.v1";
const APPLICATIONS_KEY = "hireswarm.product.applications.v1";

const stages: Array<{ id: WorkflowStage; label: string; icon: IconName }> = [
  { id: "cv", label: "CV", icon: "document" },
  { id: "job", label: "Job", icon: "briefcase" },
  { id: "fit", label: "Fit", icon: "evidence" },
  { id: "agents", label: "Agents", icon: "team" },
  { id: "review", label: "Review", icon: "resume" },
  { id: "export", label: "Export", icon: "download" },
];

const viewMeta: Record<ProductView, { title: string; subtitle: string }> = {
  overview: { title: "Welcome back.", subtitle: "Your career workspace, powered by evidence." },
  applications: { title: "My applications", subtitle: "Real work saved in this browser and connected to the live evidence engine." },
  new: { title: "New application", subtitle: "Move through one evidence-backed application at a time." },
  evidence: { title: "My evidence", subtitle: "Review the source statements behind your current application." },
  resumes: { title: "My resumes", subtitle: "Your source CV and approved application exports." },
  agents: { title: "Agent control room", subtitle: "Follow the real, source-linked collaboration for your active application." },
  documents: { title: "Documents", subtitle: "Review document readiness and download only after server approval." },
  settings: { title: "Workspace settings", subtitle: "Control what this browser keeps and check your workspace connection." },
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
}

function messageFrom(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) return detail.map((entry) => typeof entry === "object" && entry && "msg" in entry ? String((entry as { msg: unknown }).msg) : "").filter(Boolean).join(" ") || fallback;
  }
  return fallback;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch { throw new Error("HireSwarm could not reach the live workspace. Your local draft is still safe in this browser."); }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); }
    catch { throw new Error("HireSwarm returned an unreadable response. Please try again."); }
  }
  if (!response.ok) throw new Error(messageFrom(payload, `That action could not be completed (${response.status}).`));
  return payload as T;
}

function patchKey(patch: Patch, index: number) { return `${patch.section}-${index}-${patch.evidence_ids.join("-")}`; }
function sourceLabel(job: Job) { return job.origin === "user_pasted" ? "Manual job" : job.cache_state === "cached" ? "Public listing · cached" : "Public listing"; }
function prettyStatus(status: RunState) { return status === "awaiting_approval" ? "Ready for review" : status === "needs_evidence" ? "Needs evidence" : status === "approved" ? "Approved" : status === "running" ? "In progress" : status === "failed" ? "Needs attention" : "Draft"; }
function safeDate(value: string) { try { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); } catch { return "Recently"; } }
function makeDraftId() { return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export default function ProductWorkspace({ initialView }: { initialView: ProductView }) {
  const router = useRouter();
  const [view, setView] = useState<ProductView>(initialView);
  const [service, setService] = useState<ServiceState>("checking");
  const [hydrated, setHydrated] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [stage, setStage] = useState<WorkflowStage>("cv");
  const [runId, setRunId] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [coverLetter, setCoverLetter] = useState("");
  const [readiness, setReadiness] = useState<ExportReadiness | null>(null);
  const [patchReview, setPatchReview] = useState<Record<string, boolean>>({});
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [draftId, setDraftId] = useState("current-draft");
  const [toast, setToast] = useState<{ kind: ToastKind; text: string; action: ToastAction } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [addingJob, setAddingJob] = useState(false);
  const [searching, setSearching] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [approving, setApproving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [pasteCv, setPasteCv] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [jobForm, setJobForm] = useState({ title: "", company: "", location: "", url: "", description: "" });
  const [jobSearch, setJobSearch] = useState("Python backend");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [jobResults, setJobResults] = useState<Job[]>([]);
  const [searchMeta, setSearchMeta] = useState<SourceResponse["provenance"] | null>(null);
  const [agentTab, setAgentTab] = useState<"agents" | "activity" | "resume">("activity");
  const streamRef = useRef<EventSource | null>(null);
  const uploadLockRef = useRef(false);
  const jobLockRef = useRef(false);
  const matchLockRef = useRef(false);
  const searchLockRef = useRef(false);
  const runLockRef = useRef(false);
  const approvalLockRef = useRef(false);
  const exportLockRef = useRef(false);

  const activeAgent = useMemo(() => [...events].reverse().find((event) => event.agent)?.agent || "Ready when you are", [events]);
  const reviewedAll = patches.length > 0 && patches.every((patch, index) => patchReview[patchKey(patch, index)]);
  const canApprove = runState === "awaiting_approval" && Boolean(readiness?.passed) && (patches.length === 0 || reviewedAll);
  const currentMeta = viewMeta[view];
  const stageIndex = stages.findIndex((item) => item.id === stage);
  const hasVerifiedEvidence = Boolean(candidate?.evidence.some((item) => item.status === "verified"));

  function notify(kind: ToastKind, text: string, action: ToastAction = null) { setToast({ kind, text, action }); }

  async function checkService(silent = false) {
    setService("checking");
    try {
      const response = await fetch(`${API}/healthz`, { cache: "no-store" });
      const data = await response.json() as { ok?: boolean };
      if (!response.ok || !data.ok) throw new Error("not ready");
      setService("online");
      if (!silent) notify("success", "Live workspace is connected.");
      return true;
    } catch {
      setService("offline");
      if (!silent) notify("error", "The live workspace is unavailable. Your browser draft has not been lost.", "health");
      return false;
    }
  }

  async function ensureLive() { return service === "online" ? true : checkService(true); }

  function closeStream() { streamRef.current?.close(); streamRef.current = null; }

  function clearRunState() {
    closeStream();
    setRunId(null); setRunState("idle"); setEvents([]); setPatches([]); setTurns([]); setCoverLetter(""); setReadiness(null); setPatchReview({});
  }

  function applyEvent(event: ActivityEvent) {
    setEvents((previous) => previous.some((item) => item.at === event.at && item.type === event.type && item.title === event.title) ? previous : [...previous, event]);
    const payload = event.payload || {};
    if (event.type === "market_report") setMatch(payload as unknown as Match);
    if (event.type === "interview_question") setTurns((previous) => updateTurn(previous, Number(payload.round || 1), { requirement: String(payload.requirement || "Job requirement"), question: String(payload.question || event.message || "") }));
    if (event.type === "candidate_answer") setTurns((previous) => updateTurn(previous, Number(payload.round || 1), { answer: String(payload.answer || event.message || ""), status: String(payload.status || ""), evidence_ids: Array.isArray(payload.evidence_ids) ? payload.evidence_ids.map(String) : [] }));
    if (event.type === "interview_verdict" || event.type === "gap_detected") setTurns((previous) => updateTurn(previous, Number(payload.round || 1), { verdict: String(payload.verdict || event.message || ""), status: String(payload.status || "") }));
    if (event.type === "resume_patch") {
      const incoming = Array.isArray(payload.patches) ? payload.patches as Patch[] : [];
      setPatches(incoming);
      setCoverLetter(String(payload.cover_letter || ""));
      setPatchReview((previous) => Object.fromEntries(incoming.map((patch, index) => [patchKey(patch, index), previous[patchKey(patch, index)] || false])));
    }
    if (event.type === "export_readiness") setReadiness(payload as unknown as ExportReadiness);
    if (event.type === "approval_required") { setRunState("awaiting_approval"); setStage("review"); }
    if (event.type === "approved") { setRunState("approved"); setStage("export"); }
    if (event.type === "evidence_needed") { setRunState("needs_evidence"); setStage("fit"); notify("error", event.message || "More direct evidence is needed before a document can be prepared."); }
    if (event.type === "run_failed") { setRunState("failed"); setStage("agents"); notify("error", event.message || "The agent workflow did not finish.", "stream"); }
  }

  function connectRun(id: string) {
    closeStream();
    let terminal = false;
    const source = new EventSource(`${API}/api/runs/${encodeURIComponent(id)}/events`);
    streamRef.current = source;
    source.onmessage = (message) => {
      try { applyEvent(JSON.parse(message.data) as ActivityEvent); }
      catch { notify("error", "A live agent update could not be read. Reconnect to resume the real event history.", "stream"); }
    };
    source.addEventListener("done", (event) => {
      terminal = true;
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { status?: RunState };
        if (payload.status) {
          setRunState(payload.status);
          if (payload.status === "approved") setStage("export");
          if (payload.status === "awaiting_approval") setStage("review");
          if (payload.status === "needs_evidence") setStage("fit");
        }
      } catch { /* terminal status is already captured by an event when available */ }
      source.close();
      if (streamRef.current === source) streamRef.current = null;
    });
    source.onerror = () => {
      source.close();
      if (streamRef.current === source) streamRef.current = null;
      if (!terminal) notify("error", "Live activity paused before the workflow finished. Reconnect to recover the server event history.", "stream");
    };
  }

  async function restoreRun(id: string) {
    try {
      const checkpoint = await requestJson<RunCheckpoint>(`${API}/api/runs/${encodeURIComponent(id)}`);
      setRunId(checkpoint.id); setRunState(checkpoint.status);
      if (checkpoint.job) setJob(checkpoint.job);
      if (checkpoint.status === "awaiting_approval") { setStage("review"); }
      if (checkpoint.status === "approved") { setStage("export"); }
      if (checkpoint.status === "needs_evidence") { setStage("fit"); }
      if (checkpoint.status === "running" || checkpoint.status === "awaiting_approval" || checkpoint.status === "approved" || checkpoint.status === "needs_evidence") connectRun(checkpoint.id);
      return true;
    } catch (error) {
      setRunId(null); setRunState("failed"); setStage("fit");
      notify("error", error instanceof Error ? error.message : "That saved run is no longer available on the workspace service. Review fit and start a new live run.");
      return false;
    }
  }

  useEffect(() => {
    const saved = readJson<SavedWorkspace | null>(WORKSPACE_KEY, null);
    const savedApplications = readJson<ApplicationRecord[]>(APPLICATIONS_KEY, []);
    setApplications(Array.isArray(savedApplications) ? savedApplications : []);
    if (saved?.version === 1) {
      setDraftId(saved.draftId || makeDraftId()); setCandidate(saved.candidate || null); setJob(saved.job || null); setMatch(saved.match || null);
      setRunId(saved.runId || null); setRunState(saved.runState || "idle"); setStage(saved.stage || "cv"); setEvents(Array.isArray(saved.events) ? saved.events : []);
      setPatches(Array.isArray(saved.patches) ? saved.patches : []); setTurns(Array.isArray(saved.turns) ? saved.turns : []); setCoverLetter(saved.coverLetter || ""); setReadiness(saved.readiness || null); setPatchReview(saved.patchReview || {});
      if (saved.runId) void restoreRun(saved.runId);
    } else setDraftId(makeDraftId());
    setHydrated(true);
    void checkService(true);
    return () => closeStream();
  }, []);

  useEffect(() => { setView(initialView); setMobileNav(false); }, [initialView]);

  useEffect(() => {
    if (!hydrated) return;
    const saved: SavedWorkspace = { version: 1, draftId, candidate, job, match, runId, runState, stage, events: events.slice(-80), patches, turns, coverLetter, readiness, patchReview };
    try { window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(saved)); } catch { /* browser storage is optional */ }
    if (candidate && job) {
      const record: ApplicationRecord = { id: runId || draftId, candidate, job, match, runId, runState, stage, updatedAt: new Date().toISOString(), events: events.slice(-80), patches, turns, coverLetter, readiness, patchReview };
      setApplications((previous) => {
        const at = previous.findIndex((item) => item.id === record.id);
        const next = at < 0 ? [record, ...previous] : previous.map((item, index) => index === at ? { ...record, updatedAt: item.runState === record.runState && item.events.length === record.events.length ? item.updatedAt : record.updatedAt } : item);
        return next.slice(0, 20);
      });
    }
  }, [hydrated, draftId, candidate, job, match, runId, runState, stage, events, patches, turns, coverLetter, readiness, patchReview]);

  useEffect(() => { if (hydrated) { try { window.localStorage.setItem(APPLICATIONS_KEY, JSON.stringify(applications)); } catch { /* browser storage is optional */ } } }, [applications, hydrated]);

  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), toast.kind === "error" ? 9000 : 5000); return () => window.clearTimeout(timer); }, [toast]);

  async function importCv(file: File) {
    if (!file || uploadLockRef.current) return;
    uploadLockRef.current = true;
    if (!await ensureLive()) { uploadLockRef.current = false; return; }
    setUploading(true); setToast(null);
    try {
      const body = new FormData(); body.append("file", file);
      const result = await requestJson<{ candidate: Candidate; import: { evidence_count: number; filename: string } }>(`${API}/api/candidate/upload`, { method: "POST", body });
      clearRunState(); setCandidate(result.candidate); setJob(null); setMatch(null); setStage("job"); setView("new"); setJobResults([]);
      notify("success", `${result.import.filename} parsed. ${result.import.evidence_count} reviewable evidence item${result.import.evidence_count === 1 ? "" : "s"} found.`);
    } catch (error) { notify("error", error instanceof Error ? error.message : "We could not read that CV."); }
    finally { uploadLockRef.current = false; setUploading(false); }
  }

  async function usePastedCv() {
    const text = pasteCv.trim();
    if (text.length < 80) { notify("error", "Paste a little more of your CV before continuing."); return; }
    await importCv(new File([text], "pasted-cv.txt", { type: "text/plain" }));
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault(); setIsDragging(false);
    const file = event.dataTransfer.files?.[0]; if (file) void importCv(file);
  }

  async function saveManualJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!candidate || jobLockRef.current) return;
    jobLockRef.current = true;
    if (!await ensureLive()) { jobLockRef.current = false; return; }
    setAddingJob(true); setToast(null);
    try {
      const created = await requestJson<Job>(`${API}/api/jobs/manual`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(jobForm) });
      clearRunState(); setJob(created); setMatch(null); setStage("fit"); setView("new");
      notify("success", "Job added. Now check what your real experience supports.");
    } catch (error) { notify("error", error instanceof Error ? error.message : "We could not add that job."); }
    finally { jobLockRef.current = false; setAddingJob(false); }
  }

  async function findJobs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = jobSearch.trim();
    if (query.length < 2) { notify("error", "Enter at least two characters to search published jobs."); return; }
    if (searchLockRef.current) return;
    searchLockRef.current = true;
    if (!await ensureLive()) { searchLockRef.current = false; return; }
    setSearching(true); setToast(null);
    try {
      const response = await requestJson<SourceResponse>(`${API}/api/jobs/live?query=${encodeURIComponent(query)}&source=${sourceFilter}`);
      setJobResults(response.jobs.slice(0, 8)); setSearchMeta(response.provenance || null);
      if (!response.jobs.length) notify("info", response.source_errors?.[0] || "No public jobs matched this search. Try another term or add a job manually.");
    } catch (error) { notify("error", error instanceof Error ? error.message : "We could not search published jobs."); }
    finally { searchLockRef.current = false; setSearching(false); }
  }

  async function choosePublicJob(summary: Job) {
    if (jobLockRef.current) return;
    jobLockRef.current = true;
    if (!await ensureLive()) { jobLockRef.current = false; return; }
    setAddingJob(true); setToast(null);
    try {
      const detail = await requestJson<Job>(`${API}/api/jobs/${encodeURIComponent(summary.id)}`);
      clearRunState(); setJob(detail); setMatch(null); setStage("fit"); setView("new");
      notify("success", "Public job selected. Check the evidence fit before starting your agents.");
    } catch (error) { notify("error", error instanceof Error ? error.message : "We could not open that job."); }
    finally { jobLockRef.current = false; setAddingJob(false); }
  }

  async function checkFit() {
    if (!candidate || !job || matchLockRef.current) return;
    matchLockRef.current = true;
    if (!await ensureLive()) { matchLockRef.current = false; return; }
    setMatching(true); setToast(null);
    try {
      const result = await requestJson<Match>(`${API}/api/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, candidate }) });
      setMatch(result); setStage("fit"); setView("new");
      notify("success", "Fit mapped from your evidence. Review the gaps before you ask your agents to prepare documents.");
    } catch (error) { notify("error", error instanceof Error ? error.message : "We could not check this job fit."); }
    finally { matchLockRef.current = false; setMatching(false); }
  }

  async function startRun() {
    if (runLockRef.current || !candidate || !job || !match) return;
    runLockRef.current = true;
    if (!await ensureLive()) { runLockRef.current = false; return; }
    setStartingRun(true); setToast(null); clearRunState(); setRunState("running"); setStage("agents"); setView("new");
    try {
      const created = await requestJson<{ run_id: string }>(`${API}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, candidate, mode: "evidence_lab" }) });
      setRunId(created.run_id); connectRun(created.run_id);
      notify("info", "Your AI team is now working from the real evidence ledger.");
    } catch (error) { setRunState("failed"); notify("error", error instanceof Error ? error.message : "We could not start the agent workflow.", "stream"); }
    finally { runLockRef.current = false; setStartingRun(false); }
  }

  async function approve() {
    if (!runId || !canApprove || approvalLockRef.current) return;
    approvalLockRef.current = true;
    if (!await ensureLive()) { approvalLockRef.current = false; return; }
    setApproving(true); setToast(null);
    try {
      await requestJson(`${API}/api/runs/${encodeURIComponent(runId)}/approve`, { method: "POST" });
      setRunState("approved"); setStage("export"); setView("new");
      notify("success", "Server approval is complete. Your verified document files are unlocked.");
    } catch (error) { notify("error", error instanceof Error ? error.message : "We could not save approval."); }
    finally { approvalLockRef.current = false; setApproving(false); }
  }

  async function download(format: "pdf" | "docx") {
    if (!runId || runState !== "approved" || exportLockRef.current) return;
    exportLockRef.current = true;
    if (!await ensureLive()) { exportLockRef.current = false; return; }
    setExporting(format); setToast(null);
    try {
      const response = await fetch(`${API}/api/runs/${encodeURIComponent(runId)}/export/${format}`);
      if (!response.ok) {
        const text = await response.text(); let payload: unknown = null; try { payload = JSON.parse(text); } catch { /* fall through */ }
        throw new Error(messageFrom(payload, "The export could not be created."));
      }
      const file = await response.blob();
      if (!file.size) throw new Error("The generated file was empty. Please retry.");
      const objectUrl = URL.createObjectURL(file); const anchor = document.createElement("a");
      anchor.href = objectUrl; anchor.download = format === "pdf" ? "HireSwarm_Approved_Application.pdf" : "HireSwarm_Approved_Application.docx";
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
      notify("success", `${format.toUpperCase()} download started.`);
    } catch (error) { notify("error", error instanceof Error ? error.message : "The export could not be created."); }
    finally { exportLockRef.current = false; setExporting(null); }
  }

  function beginNewApplication(navigate = false) {
    const nextDraftId = makeDraftId();
    const empty: SavedWorkspace = { version: 1, draftId: nextDraftId, candidate: null, job: null, match: null, runId: null, runState: "idle", stage: "cv", events: [], patches: [], turns: [], coverLetter: "", readiness: null, patchReview: {} };
    closeStream(); setToast(null);
    try { window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(empty)); } catch { /* browser storage is optional */ }
    setDraftId(nextDraftId); setCandidate(null); setJob(null); setMatch(null); setStage("cv"); setRunId(null); setRunState("idle"); setEvents([]); setPatches([]); setTurns([]); setCoverLetter(""); setReadiness(null); setPatchReview({}); setJobResults([]); setPasteCv(""); setJobForm({ title: "", company: "", location: "", url: "", description: "" }); setView("new");
    if (navigate) router.push("/new");
  }

  function editSourceCv() { clearRunState(); setJob(null); setMatch(null); setStage("cv"); setView("new"); notify("info", "Update your source CV, then rerun the real evidence workflow. Previous approval remains invalidated."); }
  function changeJob() { clearRunState(); setJob(null); setMatch(null); setStage("job"); setView("new"); notify("info", "Choose one replacement job. Previous run and approval state have been cleared."); }
  function openApplication(record: ApplicationRecord) { closeStream(); setDraftId(record.id); setCandidate(record.candidate); setJob(record.job); setMatch(record.match); setRunId(record.runId); setRunState(record.runState); setStage(record.stage); setEvents(record.events || []); setPatches(record.patches || []); setTurns(record.turns || []); setCoverLetter(record.coverLetter || ""); setReadiness(record.readiness || null); setPatchReview(record.patchReview || {}); setView("new"); if (record.runId) void restoreRun(record.runId); }
  function clearBrowserWorkspace() { if (window.confirm("Clear the saved HireSwarm workspace and local application list from this browser?")) { closeStream(); window.localStorage.removeItem(WORKSPACE_KEY); window.localStorage.removeItem(APPLICATIONS_KEY); setApplications([]); beginNewApplication(); notify("success", "Browser workspace cleared."); } }

  function canVisit(target: WorkflowStage) {
    const targetIndex = stages.findIndex((item) => item.id === target);
    if (targetIndex <= stageIndex) return true;
    if (target === "job") return Boolean(candidate);
    if (target === "fit") return Boolean(candidate && job);
    if (target === "agents") return Boolean(match);
    if (target === "review") return runState === "awaiting_approval" || runState === "approved";
    if (target === "export") return runState === "approved";
    return false;
  }

  function goToStage(target: WorkflowStage) { if (canVisit(target)) { setStage(target); setView("new"); } }

  const navItems: Array<{ href: string; view: ProductView; label: string; icon: IconName }> = [
    { href: "/workspace", view: "overview", label: "Overview", icon: "home" },
    { href: "/applications", view: "applications", label: "My applications", icon: "briefcase" },
    { href: "/new", view: "new", label: "New application", icon: "plus" },
    { href: "/evidence", view: "evidence", label: "My evidence", icon: "evidence" },
    { href: "/resumes", view: "resumes", label: "My resumes", icon: "resume" },
  ];

  function renderNavigation() {
    return <>
      <div className="hs-sidebar-brand"><Brand href="/" /><button type="button" className="hs-icon-button hs-mobile-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><Icon name="close" /></button></div>
      <nav className="hs-sidebar-nav" aria-label="Workspace navigation">
        <p>WORKSPACE</p>
        {navItems.slice(0, 3).map((item) => item.view === "new" ? <button type="button" key={item.view} className={view === item.view ? "active" : ""} onClick={() => beginNewApplication(true)}><Icon name={item.icon} size={17} />{item.label}</button> : <Link href={item.href} key={item.view} className={view === item.view ? "active" : ""} aria-current={view === item.view ? "page" : undefined}><Icon name={item.icon} size={17} />{item.label}</Link>)}
        <p>LIBRARY</p>
        {navItems.slice(3).map((item) => <Link href={item.href} key={item.view} className={view === item.view ? "active" : ""} aria-current={view === item.view ? "page" : undefined}><Icon name={item.icon} size={17} />{item.label}</Link>)}
      </nav>
      <div className="hs-sidebar-bottom"><Link href="/settings" className={view === "settings" ? "active" : ""}><Icon name="settings" size={17} />Settings</Link><div className="hs-local-label"><Icon name="lock" size={14} /> Saved in this browser</div></div>
    </>;
  }

  function renderOverview() {
    const verified = candidate?.evidence.filter((item) => item.status === "verified").length || 0;
    const partial = candidate?.evidence.filter((item) => item.status === "partial").length || 0;
    const unsupported = candidate?.evidence.filter((item) => item.status === "unverified").length || 0;
    return <>
      <section className="hs-page-hero hs-overview-hero"><div><p className="hs-eyebrow">CAREER WORKSPACE</p><h1>Welcome back.</h1><p>Your career workspace, powered by evidence.</p></div><button type="button" className="hs-button hs-button-primary" onClick={() => beginNewApplication()}><Icon name="plus" size={17} /> Create new application</button></section>
      <section className="hs-overview-grid">
        <article className="hs-overview-apps"><div className="hs-panel-title"><div><span>ACTIVE WORK</span><h2>Applications</h2></div><Link href="/applications" className="hs-text-link">View all <Icon name="arrow-right" size={15} /></Link></div>{applications.length ? <div className="hs-application-rows">{applications.slice(0, 4).map((record) => <button type="button" className="hs-application-row" key={record.id} onClick={() => openApplication(record)}><span className="hs-row-icon"><Icon name="briefcase" size={17} /></span><span><b>{record.job.title}</b><small>{record.job.company} · Updated {safeDate(record.updatedAt)}</small></span><em className={`hs-status hs-status-${record.runState}`}>{prettyStatus(record.runState)}</em><Icon name="arrow-right" size={16} /></button>)}</div> : <div className="hs-empty-inline"><Icon name="briefcase" size={22} /><div><b>No applications yet</b><p>Start with one CV and one real opportunity. Your application list will stay in this browser.</p></div><button type="button" className="hs-text-link" onClick={() => beginNewApplication()}>Create one <Icon name="arrow-right" size={15} /></button></div>}</article>
        <article className="hs-evidence-summary"><div className="hs-panel-title"><div><span>CURRENT EVIDENCE</span><h2>{candidate ? candidate.name || "Your CV" : "No CV loaded"}</h2></div><Link href="/evidence" className="hs-icon-button" aria-label="Open evidence library"><Icon name="arrow-up-right" size={17} /></Link></div>{candidate ? <><div className="hs-evidence-counts"><span><b>{verified}</b>Verified</span><span><b>{partial}</b>Needs review</span><span><b>{unsupported}</b>Unsupported</span></div><p className="hs-small-copy">Source statements from your current browser workspace. Replace the CV to refresh them.</p></> : <div className="hs-empty-compact"><Icon name="evidence" size={21} /><p>Upload a CV to build an evidence ledger.</p></div>}</article>
      </section>
      <section className="hs-next-action"><div className="hs-next-icon"><Icon name={candidate ? "briefcase" : "document"} size={21} /></div><div><span>NEXT BEST STEP</span><h2>{candidate ? job ? "Check the role fit" : "Choose one opportunity" : "Start with your real experience"}</h2><p>{candidate ? job ? "Map this role against the evidence in your CV before starting the agents." : "Add one manual job or search published listings when you are ready." : "Upload a PDF, DOCX, TXT, or paste your CV. We only work with what you provided."}</p></div><button type="button" className="hs-button hs-button-secondary" onClick={() => { setView("new"); setStage(candidate ? job ? "fit" : "job" : "cv"); }}>{candidate ? job ? "Check fit" : "Choose job" : "Add CV"}<Icon name="arrow-right" size={16} /></button></section>
    </>;
  }

  function renderApplications() {
    return <><section className="hs-page-hero"><div><p className="hs-eyebrow">WORKSPACE</p><h1>My applications</h1><p>Real application work saved locally in this browser. Server approval and exports remain live-only.</p></div><button type="button" className="hs-button hs-button-primary" onClick={() => beginNewApplication()}><Icon name="plus" size={17} /> New application</button></section>{applications.length ? <section className="hs-data-table" aria-label="Saved applications"><div className="hs-table-head"><span>Opportunity</span><span>Status</span><span>Updated</span><span /></div>{applications.map((record) => <button type="button" className="hs-table-row" key={record.id} onClick={() => openApplication(record)}><span><b>{record.job.title}</b><small>{record.job.company} · {record.job.location || "Location not specified"}</small></span><em className={`hs-status hs-status-${record.runState}`}>{prettyStatus(record.runState)}</em><span className="hs-date">{safeDate(record.updatedAt)}</span><Icon name="arrow-right" size={17} /></button>)}</section> : <section className="hs-empty-state"><span className="hs-empty-icon"><Icon name="briefcase" size={27} /></span><h2>Your application list is empty.</h2><p>Create one focused application. We will save its browser-session workspace here without inventing history.</p><button type="button" className="hs-button hs-button-primary" onClick={() => beginNewApplication()}>Create new application <Icon name="arrow-right" /></button></section>}</>;
  }

  function renderStepper() {
    return <ol className="hs-stepper" aria-label={`Application workflow. Current step: ${stage}`}>
      {stages.map((item, index) => <li key={item.id} className={`${item.id === stage ? "current" : ""} ${canVisit(item.id) && item.id !== stage ? "available" : ""} ${index < stageIndex ? "complete" : ""}`}><button type="button" disabled={!canVisit(item.id)} onClick={() => goToStage(item.id)} aria-current={item.id === stage ? "step" : undefined}><span>{index < stageIndex ? <Icon name="check" size={13} /> : index + 1}</span><b>{item.label}</b></button></li>)}
    </ol>;
  }

  function renderCvStage() {
    return <section className="hs-work-card hs-cv-stage"><div className="hs-stage-heading"><span className="hs-stage-icon"><Icon name="document" size={20} /></span><div><p className="hs-eyebrow">STEP 1 · YOUR SOURCE</p><h2>Start with your real experience.</h2><p>Upload your CV and we will identify reviewable source statements. We never add skills you did not provide.</p></div></div>
      <label className={`hs-upload-zone ${isDragging ? "dragging" : ""} ${uploading ? "loading" : ""}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={uploading || service === "offline"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCv(file); event.currentTarget.value = ""; }} /><span className="hs-upload-icon"><Icon name={uploading ? "refresh" : "upload"} size={23} /></span><b>{uploading ? "Parsing your CV…" : "Drop your CV here, or browse"}</b><small>{uploading ? "Extracting source statements and explicit skills." : "PDF, DOCX, or TXT · maximum 6 MB"}</small></label>
      <details className="hs-disclosure"><summary>Or paste CV text <Icon name="chevron-down" size={16} /></summary><div><label htmlFor="paste-cv">CV text</label><textarea id="paste-cv" value={pasteCv} onChange={(event) => setPasteCv(event.target.value)} placeholder="Paste the text from your CV here…" rows={8} disabled={uploading} /><button type="button" className="hs-button hs-button-secondary" disabled={uploading || service === "offline"} onClick={() => void usePastedCv()}>Use pasted CV <Icon name="arrow-right" size={16} /></button></div></details>
      <p className="hs-privacy-note"><Icon name="lock" size={14} /> Your working state is saved in this browser. A live server is used only for the evidence workflow and exports.</p></section>;
  }

  function renderJobStage() {
    return <section className="hs-work-card"><div className="hs-stage-heading"><span className="hs-stage-icon"><Icon name="briefcase" size={20} /></span><div><p className="hs-eyebrow">STEP 2 · OPPORTUNITY</p><h2>Choose one real opportunity.</h2><p>Paste a role you found, or search published listings when you are ready. Manual entry stays first.</p></div></div>
      {candidate && <div className="hs-source-summary"><span><Icon name="check" size={15} /></span><div><b>{candidate.name || "CV"} is ready</b><small>{candidate.evidence.length} reviewable evidence item{candidate.evidence.length === 1 ? "" : "s"} available for this application.</small></div><button type="button" onClick={editSourceCv}>Replace CV</button></div>}
      <div className="hs-job-layout"><form className="hs-manual-job" onSubmit={(event) => void saveManualJob(event)}><div className="hs-form-heading"><h3>Add a job manually</h3><p>Best when you already have a job description.</p></div><div className="hs-field-grid"><label>Job title<input required value={jobForm.title} onChange={(event) => setJobForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Backend Engineer" /></label><label>Company<input required value={jobForm.company} onChange={(event) => setJobForm((current) => ({ ...current, company: event.target.value }))} placeholder="Company name" /></label></div><label>Location <span>Optional</span><input value={jobForm.location} onChange={(event) => setJobForm((current) => ({ ...current, location: event.target.value }))} placeholder="e.g. Remote · Pakistan" /></label><label>Job description<textarea required minLength={20} value={jobForm.description} onChange={(event) => setJobForm((current) => ({ ...current, description: event.target.value }))} placeholder="Paste the full job description here…" rows={7} /></label><details className="hs-inline-details"><summary>Official job link <span>Optional</span><Icon name="chevron-down" size={15} /></summary><label>HTTPS job URL<input type="url" value={jobForm.url} onChange={(event) => setJobForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://careers.example.com/role" /></label></details><button className="hs-button hs-button-primary" disabled={addingJob || service === "offline"}>{addingJob ? "Adding job…" : "Use this job"}<Icon name="arrow-right" size={16} /></button></form>
        <section className="hs-public-search" aria-labelledby="public-search-title"><div className="hs-form-heading"><span className="hs-search-mark"><Icon name="search" size={17} /></span><div><h3 id="public-search-title">Search public jobs</h3><p>Live listings are requested only when you search.</p></div></div><form onSubmit={(event) => void findJobs(event)}><label className="hs-search-input"><Icon name="search" size={16} /><input aria-label="Search published jobs" value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Role, skill, or company" /></label><div className="hs-filter-row"><label>Source<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}><option value="all">All public sources</option><option value="remotive">Remotive</option><option value="arbeitnow">Arbeitnow</option></select></label><button className="hs-button hs-button-secondary" disabled={searching || service === "offline"}>{searching ? "Searching…" : "Search"}</button></div></form>{searchMeta && <p className="hs-provenance">{searchMeta.label || "Published public jobs"} · {searchMeta.cache_state === "cached" ? "cached result" : "fresh result"}</p>}{jobResults.length > 0 && <div className="hs-results">{jobResults.map((result) => <button type="button" key={result.id} onClick={() => void choosePublicJob(result)} disabled={addingJob}><span><b>{result.title}</b><small>{result.company} · {result.location || "Location not specified"}</small></span><em>{result.source || "Public listing"}</em><Icon name="arrow-right" size={16} /></button>)}</div>}</section>
      </div></section>;
  }

  function renderJobSummary() { return job ? <div className="hs-selected-job"><span className="hs-job-source">{sourceLabel(job)}</span><div><b>{job.title}</b><small>{job.company} · {job.location || "Location not specified"}</small></div><button type="button" className="hs-text-link" onClick={changeJob}>Change job</button></div> : null; }
  function renderJobPreview() { return job?.description ? <details className="hs-job-preview"><summary>Job description preview <Icon name="chevron-down" size={15} /></summary><p>{job.description}</p></details> : null; }

  function evidenceLinks(items: { evidence_ids: string[] }[]) { const ids = Array.from(new Set(items.flatMap((item) => item.evidence_ids))); return ids.length ? <div className="hs-evidence-chips">{ids.map((id) => <button key={id} type="button" onClick={() => setView("evidence")}>{id}</button>)}</div> : <span className="hs-no-evidence">No direct evidence ID</span>; }

  function renderFitStage() {
    return <section className="hs-work-card">{renderJobSummary()}{renderJobPreview()}<div className="hs-stage-heading"><span className="hs-stage-icon"><Icon name="evidence" size={20} /></span><div><p className="hs-eyebrow">STEP 3 · FIT MAP</p><h2>See your fit before you prepare.</h2><p>Market Scout separates direct support, related experience, and honest gaps.</p></div></div>{!match ? <div className="hs-fit-empty"><span><Icon name="evidence" size={25} /></span><h3>Map this job against your evidence.</h3><p>The fit check is read-only. It does not create a run, edit your CV, or unlock any export.</p><button type="button" className="hs-button hs-button-primary" disabled={matching || service === "offline"} onClick={() => void checkFit()}>{matching ? "Checking fit…" : "Check job fit"}<Icon name="arrow-right" size={16} /></button></div> : <><div className="hs-coverage"><div><span>EVIDENCE COVERAGE</span><b>{match.coverage}%</b></div><div className="hs-coverage-track"><i style={{ width: `${Math.min(100, Math.max(0, match.coverage))}%` }} /></div><p>Coverage reflects requirements with direct CV support. Rewording cannot increase the evidence score.</p></div><div className="hs-fit-columns"><section className="hs-fit-group matched"><header><span><Icon name="check" size={15} /></span><div><h3>Matched</h3><p>Direct support in your CV</p></div></header>{match.verified_strengths.length ? <ul>{match.verified_strengths.map((item) => <li key={item.skill}><b>{item.skill}</b>{evidenceLinks([item])}</li>)}</ul> : <p className="hs-empty-copy">No direct support found.</p>}</section><section className="hs-fit-group partial"><header><span><Icon name="spark" size={15} /></span><div><h3>Partially matched</h3><p>Related, but not equivalent</p></div></header>{match.adjacent_strengths.length ? <ul>{match.adjacent_strengths.map((item) => <li key={item.skill}><b>{item.skill}</b><small>{item.reason}</small>{evidenceLinks([item])}</li>)}</ul> : <p className="hs-empty-copy">No related experience identified.</p>}</section><section className="hs-fit-group missing"><header><span><Icon name="warning" size={15} /></span><div><h3>Missing</h3><p>Not claimed by your CV</p></div></header>{match.gaps.length ? <ul>{match.gaps.map((item) => <li key={item.skill}><b>{item.skill}</b><small>{item.severity.replaceAll("_", " ")}</small></li>)}</ul> : <p className="hs-empty-copy">No missing requirements surfaced.</p>}</section></div><div className="hs-stage-actions"><button type="button" className="hs-button hs-button-secondary" onClick={changeJob}>Choose another job</button><button type="button" className="hs-button hs-button-primary" onClick={() => goToStage("agents")}>Open agent control room <Icon name="arrow-right" size={16} /></button></div></>}</section>;
  }

  function agentStatus(name: string) { const last = [...events].reverse().find((item) => item.agent === name); if (runState === "running" && activeAgent === name) return "Working"; if (last) return last.type === "gap_detected" ? "Flagged a gap" : "Updated"; return runState === "running" ? "Queued" : "Waiting"; }
  function agentCard(name: string, initials: string, tone: string, copy: string) { const status = agentStatus(name); return <article className={`hs-agent-card ${tone}`} key={name}><div><span>{initials}</span><em className={status === "Working" ? "working" : ""}>{status}</em></div><h3>{name}</h3><p>{copy}</p></article>; }
  function eventEvidence(event: ActivityEvent) { const ids = Array.isArray(event.payload.evidence_ids) ? event.payload.evidence_ids.map(String) : []; return ids.length ? <span className="hs-event-evidence">{ids.map((id) => <b key={id}>{id}</b>)}</span> : null; }

  function renderAgentRoom(compact = false) {
    const room = <div className={`hs-agent-room ${compact ? "compact" : ""}`}><section className={`hs-agent-column ${agentTab === "agents" ? "mobile-current" : ""}`}><div className="hs-room-label"><span>AI TEAM</span><small>Live roles</small></div>{agentCard("Candidate Twin", "CT", "tone-one", "Connects answers to real work evidence.")}{agentCard("HR Interrogator", "HR", "tone-two", "Challenges claims and keeps gaps honest.")}{agentCard("Resume Surgeon", "RS", "tone-three", "Prepares only source-linked improvements.")}</section><section className={`hs-timeline-column ${agentTab === "activity" ? "mobile-current" : ""}`}><div className="hs-room-heading"><div><span>COLLABORATION ACTIVITY</span><h3>{runState === "running" ? activeAgent : runState === "awaiting_approval" ? "Ready for your review" : "Evidence-led workflow"}</h3></div>{runState === "running" && <span className="hs-live-indicator"><i /> Live</span>}</div>{events.length ? <ol className="hs-event-list">{events.map((event, index) => <li key={`${event.at || index}-${event.type}`}><span className={`hs-event-dot ${event.type === "gap_detected" || event.type === "evidence_needed" ? "warning" : ""}`}><Icon name={event.type === "gap_detected" || event.type === "evidence_needed" ? "warning" : event.type === "resume_patch" ? "spark" : "check"} size={13} /></span><div><header><b>{event.agent || "Evidence engine"}</b><small>{event.title}</small></header><p>{event.message || "Updated the application workflow."}</p>{eventEvidence(event)}</div></li>)}</ol> : <div className="hs-timeline-empty"><Icon name="team" size={25} /><b>Your agents are ready.</b><p>Start only after you have reviewed the fit. We will show actual server events here — not simulated reasoning.</p></div>}{runState === "running" && <div className="hs-working-line"><i /><span>Waiting for the next real agent event…</span></div>}{runState === "failed" && <button type="button" className="hs-button hs-button-secondary hs-button-small" onClick={() => runId && void restoreRun(runId)}>Reconnect activity <Icon name="refresh" size={15} /></button>}</section><section className={`hs-resume-column ${agentTab === "resume" ? "mobile-current" : ""}`}><div className="hs-room-heading"><div><span>RESUME &amp; EVIDENCE</span><h3>{candidate?.headline || "Your source CV"}</h3></div></div>{patches.length ? <div className="hs-room-patches">{patches.slice(0, 3).map((patch, index) => <article key={patchKey(patch, index)}><small>{patch.section}</small><p>{patch.proposed}</p><span>{patch.evidence_ids.join(" · ")}</span></article>)}</div> : <div className="hs-resume-mini"><Icon name="resume" size={22} /><p>Proposed, evidence-linked edits will appear here when the workflow reaches the review stage.</p></div>}<div className="hs-evidence-mini"><span>Evidence ledger</span>{candidate?.evidence.slice(0, 3).map((item) => <button type="button" key={item.evidence_id} onClick={() => setView("evidence")}><b>{item.evidence_id}</b><p>{item.source_text}</p></button>)}</div></section></div>;
    return <>{!compact && <div className="hs-agent-tabs" role="tablist" aria-label="Agent room mobile sections">{(["agents", "activity", "resume"] as const).map((tab) => <button key={tab} role="tab" aria-selected={agentTab === tab} onClick={() => setAgentTab(tab)}>{tab === "agents" ? "Agents" : tab === "activity" ? "Activity" : "Resume"}</button>)}</div>}{room}</>;
  }

  function renderAgentsStage() {
    return <section className="hs-work-card hs-agents-stage">{renderJobSummary()}<div className="hs-stage-heading"><span className="hs-stage-icon"><Icon name="team" size={20} /></span><div><p className="hs-eyebrow">STEP 4 · AI COLLABORATION</p><h2>Invite your evidence team in.</h2><p>Each update comes from the live run. No agent will present unsupported experience as fact.</p></div>{runState !== "running" && runState !== "awaiting_approval" && runState !== "approved" && <button type="button" className="hs-button hs-button-primary hs-stage-cta" onClick={() => void startRun()} disabled={startingRun || service === "offline"}>{startingRun ? "Starting agents…" : runState === "failed" ? "Restart workflow" : "Start evidence workflow"}<Icon name="arrow-right" size={16} /></button>}</div>{renderAgentRoom()}</section>;
  }

  function renderReviewStage() {
    const allMarked = patches.length > 0 && reviewedAll;
    return <section className="hs-work-card hs-review-stage">{renderJobSummary()}<div className="hs-stage-heading"><span className="hs-stage-icon"><Icon name="resume" size={20} /></span><div><p className="hs-eyebrow">STEP 5 · REVIEW</p><h2>Your resume, tailored to this opportunity.</h2><p>Compare source writing with the server-validated proposals. Source-CV changes require a new real run.</p></div></div><div className="hs-review-grid"><article className="hs-source-document"><header><div><span>ORIGINAL RESUME</span><h3>Your source text</h3></div><button type="button" className="hs-text-link" onClick={editSourceCv}>Edit source CV</button></header><pre>{candidate?.resume_text || "No source CV loaded."}</pre></article><article className="hs-proposed-document"><header><div><span>OPTIMIZED RESUME</span><h3>Evidence-linked proposals</h3></div><span className="hs-document-state"><Icon name="evidence" size={14} /> Server checked</span></header>{patches.length ? <div className="hs-patch-list">{patches.map((patch, index) => { const key = patchKey(patch, index); return <article className={`hs-patch-card ${patchReview[key] ? "reviewed" : ""}`} key={key}><div className="hs-patch-top"><span>{patch.section}</span><label><input type="checkbox" checked={Boolean(patchReview[key])} onChange={(event) => setPatchReview((current) => ({ ...current, [key]: event.target.checked }))} /> <b>Reviewed</b></label></div><div className="hs-patch-copy"><p><small>ORIGINAL</small>{patch.original || "Source context"}</p><p><small>PROPOSED</small>{patch.proposed}</p></div><div className="hs-patch-reason"><Icon name="evidence" size={14} /><span>{patch.reason || "Linked to supplied evidence."}</span><b>{patch.evidence_ids.join(" · ")}</b></div><button type="button" className="hs-patch-reject" onClick={editSourceCv}>Reject &amp; revise source</button></article>; })}</div> : <div className="hs-empty-compact"><Icon name="warning" size={21} /><p>No server-validated resume edits were prepared. Return to fit or update your source CV.</p></div>}</article></div>{coverLetter && <details className="hs-review-disclosure"><summary>Cover letter points <Icon name="chevron-down" size={16} /></summary><pre>{coverLetter}</pre></details>}<section className="hs-review-footer"><div><h3>Ready for human approval?</h3><p>{allMarked ? "Every proposed change has been reviewed in this browser. The server will still enforce document QA before approval." : patches.length ? "Mark each source-linked proposal as reviewed to enable the final approval request." : "No safe patches are available for approval."}</p></div><button type="button" className="hs-button hs-button-primary" disabled={!canApprove || approving || service === "offline"} onClick={() => void approve()}>{approving ? "Saving approval…" : "Approve final files"}<Icon name="arrow-right" size={16} /></button></section></section>;
  }

  function renderExportStage() {
    const checks = readiness?.checks || [];
    return <section className="hs-work-card hs-export-stage">{renderJobSummary()}<div className="hs-stage-heading"><span className="hs-stage-icon"><Icon name="download" size={20} /></span><div><p className="hs-eyebrow">STEP 6 · EXPORT</p><h2>Your verified files are ready.</h2><p>Human approval is complete. HireSwarm does not submit applications or contact employers.</p></div></div><div className="hs-export-layout"><section className="hs-export-preview"><header><span>APPLICATION PACKET</span><em>{runState === "approved" ? "Approved" : "Locked"}</em></header><div className="hs-export-document"><div className="hs-document-name"><span>{candidate?.name || "Your name"}</span><small>{candidate?.headline || "Evidence-backed application"}</small></div>{patches.slice(0, 3).map((patch, index) => <p key={patchKey(patch, index)}><b>{patch.section}</b>{patch.proposed}</p>)}</div></section><section className="hs-qa-checklist"><div><span>RELEASE CHECKLIST</span><h3>Document readiness</h3></div>{checks.length ? <ul>{checks.map((check) => <li key={check.label} className={check.passed ? "passed" : "failed"}><span><Icon name={check.passed ? "check" : "warning"} size={14} /></span><div><b>{check.label}</b><p>{check.detail}</p></div></li>)}</ul> : <p className="hs-empty-copy">QA details are available after the server completes preparation.</p>}<div className="hs-download-actions"><button type="button" className="hs-button hs-button-primary" disabled={runState !== "approved" || exporting !== null || service === "offline"} onClick={() => void download("docx")}>{exporting === "docx" ? "Preparing DOCX…" : "Download DOCX"}<Icon name="download" size={16} /></button><button type="button" className="hs-button hs-button-secondary" disabled={runState !== "approved" || exporting !== null || service === "offline"} onClick={() => void download("pdf")}>{exporting === "pdf" ? "Preparing PDF…" : "Download PDF"}<Icon name="download" size={16} /></button></div></section></div></section>;
  }

  function renderNewApplication() {
    return <><section className="hs-page-hero hs-workflow-hero"><div><p className="hs-eyebrow">APPLICATION WORKFLOW</p><h1>One role. Clear evidence. Human control.</h1><p>Move through each stage only when the work is ready. Your next action is always visible.</p></div>{candidate && <div className="hs-current-candidate"><span>{candidate.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2) || "CV"}</span><div><b>{candidate.name || "Current CV"}</b><small>{candidate.evidence.length} evidence item{candidate.evidence.length === 1 ? "" : "s"}</small></div></div>}</section>{renderStepper()}{stage === "cv" && renderCvStage()}{stage === "job" && renderJobStage()}{stage === "fit" && renderFitStage()}{stage === "agents" && renderAgentsStage()}{stage === "review" && renderReviewStage()}{stage === "export" && renderExportStage()}</>;
  }

  function renderEvidence() {
    return <><section className="hs-page-hero"><div><p className="hs-eyebrow">LIBRARY</p><h1>My evidence</h1><p>Every item below comes directly from the CV currently loaded in this browser.</p></div>{candidate && <button type="button" className="hs-button hs-button-secondary" onClick={editSourceCv}>Replace source CV <Icon name="refresh" size={16} /></button>}</section>{candidate ? <section className="hs-evidence-library"><div className="hs-evidence-library-head"><div><h2>{candidate.name || "Current CV"}</h2><p>{candidate.headline || "Evidence ledger"} · {candidate.location || "Location not specified"}</p></div><span>{candidate.evidence.length} items</span></div><div className="hs-evidence-list">{candidate.evidence.map((item) => <article key={item.evidence_id}><span className={`hs-evidence-state ${item.status}`}><Icon name={item.status === "verified" ? "check" : item.status === "partial" ? "warning" : "close"} size={14} /></span><div><header><b>{item.evidence_id}</b><small>{item.source_section}</small>{item.metric && <em>{item.metric}</em>}</header><p>{item.source_text}</p><footer>{item.skills.map((skill) => <span key={skill}>{skill}</span>)}</footer></div></article>)}</div></section> : <section className="hs-empty-state"><span className="hs-empty-icon"><Icon name="evidence" size={27} /></span><h2>No evidence ledger yet.</h2><p>Upload your real CV to populate this library. We do not fill it with sample evidence.</p><button type="button" className="hs-button hs-button-primary" onClick={() => { setView("new"); setStage("cv"); }}>Add CV <Icon name="arrow-right" /></button></section>}</>;
  }

  function renderResumes() {
    return <><section className="hs-page-hero"><div><p className="hs-eyebrow">LIBRARY</p><h1>My resumes</h1><p>Source CV context and server-approved application files.</p></div>{candidate && <button type="button" className="hs-button hs-button-secondary" onClick={() => { setView("new"); setStage(runState === "approved" ? "export" : "review"); }}>Open current review <Icon name="arrow-right" size={16} /></button>}</section>{candidate ? <div className="hs-resume-library"><article><div className="hs-resume-library-icon"><Icon name="document" size={21} /></div><span>SOURCE CV</span><h2>{candidate.name || "Current source CV"}</h2><p>{candidate.headline || "Uploaded resume"}</p><button type="button" className="hs-text-link" onClick={editSourceCv}>Replace source <Icon name="arrow-right" size={15} /></button></article><article className={runState === "approved" ? "available" : "locked"}><div className="hs-resume-library-icon"><Icon name={runState === "approved" ? "check" : "lock"} size={21} /></div><span>APPLICATION PACKET</span><h2>{job?.title || "No packet yet"}</h2><p>{runState === "approved" ? "Server-approved files are available for download." : "Complete review, QA, and human approval to unlock files."}</p>{runState === "approved" ? <button type="button" className="hs-text-link" onClick={() => { setView("new"); setStage("export"); }}>Download files <Icon name="arrow-right" size={15} /></button> : <button type="button" className="hs-text-link" onClick={() => { setView("new"); setStage(job ? "fit" : "job"); }}>Continue workflow <Icon name="arrow-right" size={15} /></button>}</article></div> : <section className="hs-empty-state"><span className="hs-empty-icon"><Icon name="resume" size={27} /></span><h2>No source CV in this browser.</h2><p>Add your CV first. HireSwarm will never substitute a demo profile for your data.</p><button type="button" className="hs-button hs-button-primary" onClick={() => { setView("new"); setStage("cv"); }}>Add CV <Icon name="arrow-right" /></button></section>}</>;
  }

  function renderDocuments() { return <>{runState === "approved" || runState === "awaiting_approval" ? renderExportStage() : <><section className="hs-page-hero"><div><p className="hs-eyebrow">RELEASE</p><h1>Documents</h1><p>Files remain locked until evidence review, real document QA, and human approval are complete.</p></div></section><section className="hs-empty-state"><span className="hs-empty-icon"><Icon name="lock" size={27} /></span><h2>Your final files are not unlocked yet.</h2><p>{job ? "Return to your active application to complete the remaining real review steps." : "Create one application first, then we will show QA and export status here."}</p><button type="button" className="hs-button hs-button-primary" onClick={() => { setView("new"); setStage(job ? stage : "cv"); }}>{job ? "Continue application" : "Create application"} <Icon name="arrow-right" /></button></section></>}</>;
  }

  function renderSettings() { return <><section className="hs-page-hero"><div><p className="hs-eyebrow">SETTINGS</p><h1>Workspace settings</h1><p>Control the browser-local draft layer around the live HireSwarm evidence service.</p></div><StatusDot state={service} /></section><section className="hs-settings-grid"><article><span className="hs-setting-icon"><Icon name="lock" size={20} /></span><h2>Browser workspace</h2><p>Your current CV, application snapshots, and review state are saved only in this browser to support refresh and return visits. The backend has no user-account storage endpoint in this build.</p><button type="button" className="hs-button hs-button-danger" onClick={clearBrowserWorkspace}>Clear browser workspace</button></article><article><span className="hs-setting-icon"><Icon name="refresh" size={20} /></span><h2>Live service</h2><p>{service === "online" ? "Connected to the evidence, public-jobs, agent, approval, QA, and export service." : "Connection needs checking before live actions can run."}</p><button type="button" className="hs-button hs-button-secondary" onClick={() => void checkService()}>{service === "checking" ? "Checking…" : "Check connection"}<Icon name="refresh" size={16} /></button></article><article><span className="hs-setting-icon"><Icon name="warning" size={20} /></span><h2>Approval boundary</h2><p>HireSwarm never submits an application. Server approval can unlock documents only after evidence validation and document QA.</p><Link href="/new" className="hs-text-link">Open application workflow <Icon name="arrow-right" size={15} /></Link></article></section></>;
  }

  function renderAgentView() { return <><section className="hs-page-hero"><div><p className="hs-eyebrow">LIVE WORKSPACE</p><h1>Agent control room</h1><p>{job ? `${job.title} at ${job.company}. Follow actual activity from the evidence engine.` : "Choose a job and map its fit before starting an evidence workflow."}</p></div>{match && runState !== "running" && runState !== "awaiting_approval" && runState !== "approved" && <button type="button" className="hs-button hs-button-primary" onClick={() => { setView("new"); setStage("agents"); }}>Open workflow <Icon name="arrow-right" size={16} /></button>}</section>{job && candidate ? <section className="hs-control-card">{renderAgentRoom()}</section> : <section className="hs-empty-state"><span className="hs-empty-icon"><Icon name="team" size={27} /></span><h2>Your AI team needs an application.</h2><p>Add a CV, choose one real job, and review the honest fit before a live run can begin.</p><button type="button" className="hs-button hs-button-primary" onClick={() => beginNewApplication()}>Create new application <Icon name="arrow-right" /></button></section>}</>;
  }

  let content: ReactNode = renderOverview();
  if (view === "applications") content = renderApplications();
  if (view === "new") content = renderNewApplication();
  if (view === "evidence") content = renderEvidence();
  if (view === "resumes") content = renderResumes();
  if (view === "agents") content = renderAgentView();
  if (view === "documents") content = renderDocuments();
  if (view === "settings") content = renderSettings();

  return <div className="hs-app">
    <aside className={`hs-sidebar ${mobileNav ? "open" : ""}`}>{renderNavigation()}</aside>
    {mobileNav && <button type="button" className="hs-sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <div className="hs-app-main"><header className="hs-app-topbar"><button type="button" className="hs-icon-button hs-mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Icon name="menu" /></button><div className="hs-breadcrumb"><span>{view === "new" ? "Application workflow" : currentMeta.title}</span>{job && <><i /> <b>{job.title}</b></>}</div><div className="hs-topbar-actions"><button type="button" className="hs-service-button" onClick={() => void checkService()}><StatusDot state={service} /></button><button type="button" className="hs-button hs-button-primary hs-button-small hs-top-new" onClick={() => beginNewApplication(true)}><Icon name="plus" size={15} /> New application</button></div></header><main className="hs-content" id="main-content">{!hydrated && <div className="hs-loading-page" aria-live="polite"><div className="hs-skeleton hs-skeleton-title" /><div className="hs-skeleton hs-skeleton-copy" /><div className="hs-skeleton hs-skeleton-card" /></div>}{hydrated && content}</main></div>
    {toast && <div className={`hs-toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}><span>{toast.kind === "error" ? <Icon name="warning" size={18} /> : toast.kind === "success" ? <Icon name="check" size={18} /> : <Icon name="spark" size={18} />}</span><p>{toast.text}</p>{toast.action === "health" && <button type="button" onClick={() => void checkService()}>Retry</button>}{toast.action === "stream" && runId && <button type="button" onClick={() => void restoreRun(runId)}>Reconnect</button>}<button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}><Icon name="close" size={16} /></button></div>}
  </div>;
}

function updateTurn(previous: Turn[], round: number, changes: Partial<Turn>) {
  const existing = previous.find((turn) => turn.round === round);
  if (!existing) return [...previous, { round, requirement: String(changes.requirement || "Job requirement"), ...changes }].sort((a, b) => a.round - b.round);
  return previous.map((turn) => turn.round === round ? { ...turn, ...changes } : turn);
}
