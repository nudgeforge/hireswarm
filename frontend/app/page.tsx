"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Origin = "demo_fixture" | "public_cache" | "user_pasted";
type WorkspaceView = "match" | "rehearse" | "tailor" | "review";
type RunMode = "evidence_lab" | "crewai";
type RunState = "idle" | "running" | "needs_evidence" | "awaiting_approval" | "approved" | "failed";
type NavigationSection = "workspace" | "applications" | "practice" | "documents";

type Evidence = { evidence_id: string; source_section: string; source_text: string; skills: string[]; metric?: string; status: "verified" | "partial" | "unverified" };
type Candidate = { name: string; headline: string; location: string; preferences: string[]; resume_text: string; evidence: Evidence[] };
type Job = { id: string; origin: Origin; source: string; title: string; company: string; location: string; type: string; salary: string; posted: string; retrieved_at?: string | null; cache_state?: string; url: string; description: string; must_have: string[]; preferred: string[] };
type SwarmEvent = { type: string; agent?: string | null; title: string; message?: string | null; payload: Record<string, unknown>; at?: string | null };
type Patch = { section: string; original: string; proposed: string; evidence_ids: string[]; covered_requirements: string[]; status: string; reason: string };
type Turn = { round: number; requirement: string; question?: string; answer?: string; status?: string; evidence_ids?: string[]; verdict?: string };
type MarketReport = { score: number; coverage: number; verified_strengths: { skill: string; evidence_ids: string[]; preferred?: boolean }[]; adjacent_strengths: { skill: string; evidence_ids: string[]; reason: string; preferred?: boolean }[]; gaps: { skill: string; severity: string }[] };
type ExportCheck = { label: string; passed: boolean; detail: string };
type ExportReadiness = { passed: boolean; checks: ExportCheck[]; extracted_characters: number; verified_bullets: number };
type SourceResponse = { mode: string; jobs: Job[]; provenance?: { label?: string; retrieved_at?: string | null; cache_state?: string; polling_policy?: string; board?: string }; source_errors?: string[] };
type ImportInfo = { filename: string; format: string; characters_read: number; evidence_count: number; retention: string };

// Undefined keeps local Next.js rewrite behaviour. An explicitly empty value is
// used by the Railway all-in-one image so API requests stay on the same origin.
const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE;
const API = configuredApiBase === undefined ? "/backend" : configuredApiBase.replace(/\/+$/, "");
type ServiceStatus = "checking" | "online" | "offline";
type ServiceHealth = { ok?: boolean; service?: string; mode?: string };

function detailFrom(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const detail = (payload as Record<string, unknown>).detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const message = detail.map((item) => typeof item === "string" ? item : item && typeof item === "object" && "msg" in item ? String((item as Record<string, unknown>).msg) : "").filter(Boolean).join(" ");
    return message || null;
  }
  return null;
}

function unexpectedResponseMessage(response: Response, body: string): string {
  const html = /<\/?(?:!doctype|html|head|body)\b/i.test(body);
  if (html && response.status === 404) return "The deployed HireSwarm API route is missing (404). Live actions are paused until the backend is deployed on this workspace URL.";
  if (html) return `HireSwarm received an HTML error page (${response.status || "network"}) instead of data. Nothing was changed — please retry in a moment.`;
  return `HireSwarm received an unreadable service response (${response.status || "network"}). Nothing was changed — please retry.`;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error("HireSwarm could not reach its workspace service. Your draft is still on screen; retry when the connection is back.");
  }
  const body = await response.text();
  let payload: unknown = null;
  if (body.trim()) {
    try { payload = JSON.parse(body); }
    catch { throw new Error(unexpectedResponseMessage(response, body)); }
  }
  if (!response.ok) throw new Error(detailFrom(payload) || `HireSwarm could not complete this request (${response.status}). Please try again.`);
  if (payload === null) throw new Error("HireSwarm returned an empty response. Nothing was changed — please retry.");
  return payload as T;
}

async function requestFile(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error("HireSwarm could not reach its workspace service. Please retry when the connection is back.");
  }
  if (response.ok) return response;
  const body = await response.text();
  let payload: unknown = null;
  if (body.trim()) {
    try { payload = JSON.parse(body); }
    catch { throw new Error(unexpectedResponseMessage(response, body)); }
  }
  throw new Error(detailFrom(payload) || `HireSwarm could not prepare the download (${response.status}). Please retry.`);
}

const fallbackCandidate: Candidate = {
  name: "Ayesha Khan", headline: "Full-stack developer · Python, FastAPI, React", location: "Rawalpindi, Pakistan", preferences: ["Remote", "Backend", "AI products"], resume_text: "Ayesha Khan — Python, FastAPI, React developer with verified project evidence.",
  evidence: [
    { evidence_id: "ev_01", source_section: "Experience", source_text: "Built a React dashboard for an operations team.", skills: ["React", "Frontend"], status: "verified" },
    { evidence_id: "ev_02", source_section: "Experience", source_text: "Developed REST APIs for a student-services platform.", skills: ["Python", "REST APIs"], status: "verified" },
    { evidence_id: "ev_03", source_section: "Project", source_text: "Built a FastAPI service with JWT authentication and PostgreSQL.", skills: ["FastAPI", "Python", "PostgreSQL"], status: "verified" },
    { evidence_id: "ev_04", source_section: "Project", source_text: "Dockerized the development environment and documented local setup.", skills: ["Docker"], status: "verified" },
    { evidence_id: "ev_05", source_section: "Project", source_text: "Reduced manual reporting time by 40% through an analytics dashboard.", skills: ["React", "Analytics"], metric: "40% reporting-time reduction", status: "verified" },
  ],
};

const fallbackJobs: Job[] = [
  { id: "atlas-ai-backend", origin: "demo_fixture", source: "Demo scenario", title: "AI Backend Engineer", company: "Atlas Labs", location: "Remote · Pakistan-friendly", type: "Full time", salary: "Competitive · not disclosed", posted: "Demo scenario", url: "https://example.com/atlas-ai-backend", description: "Build reliable Python services for AI-enabled workflows. Work with product and frontend engineers to create API-first experiences.", must_have: ["Python", "FastAPI", "REST APIs", "PostgreSQL", "Docker"], preferred: ["Kubernetes", "LLM applications", "CI/CD"] },
  { id: "northstar-fullstack", origin: "demo_fixture", source: "Demo scenario", title: "Full-stack Product Engineer", company: "Northstar Systems", location: "Remote · Global", type: "Full time", salary: "Competitive · not disclosed", posted: "Demo scenario", url: "https://example.com/northstar-fullstack", description: "Ship responsive React product surfaces and API-driven services for operations teams.", must_have: ["React", "TypeScript", "Python", "REST APIs", "Git"], preferred: ["Testing", "Docker", "Product analytics"] },
  { id: "orbit-data-platform", origin: "demo_fixture", source: "Demo scenario", title: "Junior Data Platform Engineer", company: "Orbit Data", location: "Hybrid · Islamabad", type: "Full time", salary: "Competitive · not disclosed", posted: "Demo scenario", url: "https://example.com/orbit-data-platform", description: "Build data services, reporting APIs, and developer tooling for product teams.", must_have: ["Python", "PostgreSQL", "REST APIs", "Git"], preferred: ["Airflow", "Kubernetes", "Terraform"] },
];

const views: { id: WorkspaceView; label: string; number: string; hint: string }[] = [
  { id: "match", label: "Match", number: "01", hint: "Read the role" },
  { id: "rehearse", label: "Rehearse", number: "02", hint: "Stress-test proof" },
  { id: "tailor", label: "Tailor", number: "03", hint: "Refine your story" },
  { id: "review", label: "Review", number: "04", hint: "Make the call" },
];

const routeForSection: Record<NavigationSection, string> = {
  workspace: "/workspace",
  applications: "/applications",
  practice: "/practice",
  documents: "/documents",
};

function routeState(pathname: string | null): { view: WorkspaceView; section: NavigationSection } {
  if (pathname === "/applications") return { view: "match", section: "applications" };
  if (pathname === "/practice") return { view: "rehearse", section: "practice" };
  if (pathname === "/documents") return { view: "review", section: "documents" };
  return { view: "match", section: "workspace" };
}

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");
const initials = (name: string) => name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "YK";
const sourceLabel = (origin: Origin) => origin === "public_cache" ? "Live public listing" : origin === "user_pasted" ? "Pasted by you" : "Practice fixture";
const retrievalLabel = (value?: string | null) => value ? value.replace("T", " ").replace(/\.\d+\+00:00$/, " UTC").replace("+00:00", " UTC") : "time not recorded";
const sourceDetail = (job?: Job) => {
  if (!job || job.origin === "demo_fixture") return "Practice fixture — use a live board or paste your own role for a real target.";
  if (job.origin === "user_pasted") return `Applicant-provided role · added ${retrievalLabel(job.retrieved_at)}`;
  return `Source: ${job.source} · ${job.cache_state === "cached" ? "cached" : "retrieved"} ${retrievalLabel(job.retrieved_at)}`;
};

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>(fallbackJobs);
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(fallbackJobs[0].id);
  const [candidate, setCandidate] = useState<Candidate>(fallbackCandidate);
  const [view, setView] = useState<WorkspaceView>(() => routeState(pathname).view);
  const [activeNavigation, setActiveNavigation] = useState<NavigationSection>(() => routeState(pathname).section);
  const [runMode, setRunMode] = useState<RunMode>("evidence_lab");
  const [showEngineMenu, setShowEngineMenu] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [runState, setRunState] = useState<RunState>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [market, setMarket] = useState<MarketReport | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [coverageAfter, setCoverageAfter] = useState<number | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [coverLetterEvidenceIds, setCoverLetterEvidenceIds] = useState<string[]>([]);
  const [exportReadiness, setExportReadiness] = useState<ExportReadiness | null>(null);
  const [events, setEvents] = useState<SwarmEvent[]>([]);
  const [activeAgent, setActiveAgent] = useState("Ready when you are");
  const [showIntake, setShowIntake] = useState(false);
  const [showJobForm, setShowJobForm] = useState(false);
  const [showLiveFinder, setShowLiveFinder] = useState(false);
  const [showCoverLetter, setShowCoverLetter] = useState(false);
  const [manualTitle, setManualTitle] = useState("A role I want to explore");
  const [manualCompany, setManualCompany] = useState("Candidate-provided company");
  const [manualLocation, setManualLocation] = useState("Not specified");
  const [manualUrl, setManualUrl] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("checking");
  const streamRef = useRef<EventSource | null>(null);
  const shortlistRef = useRef<HTMLElement | null>(null);
  const workspacePanelRef = useRef<HTMLElement | null>(null);

  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedJobId) ?? jobs[0], [jobs, selectedJobId]);
  const selectedIsPractice = selectedJob?.origin === "demo_fixture";
  const visibleJobs = showAllJobs ? jobs : jobs.slice(0, 3);
  const coverage = coverageAfter ?? market?.coverage ?? 0;
  const directMatches = market?.verified_strengths.length ?? 0;
  const currentTurn = turns[turns.length - 1];
  const evidencePreviewSkills = Array.from(new Set(candidate.evidence.flatMap((item) => item.skills))).slice(0, 3);
  const proofItem = candidate.evidence.find((item) => item.metric) || candidate.evidence[0];
  const candidateFirstName = candidate.name.trim().split(/\s+/)[0] || "there";
  const serviceOnline = serviceStatus === "online";
  const serviceCopy = serviceStatus === "online" ? "Service connected" : serviceStatus === "checking" ? "Checking connection" : "Service unavailable";

  async function checkService(showSuccess = false) {
    setServiceStatus("checking");
    try {
      const health = await requestJson<ServiceHealth>(`${API}/healthz`);
      if (!health.ok) throw new Error("The workspace service did not confirm that it is ready.");
      setServiceStatus("online");
      if (showSuccess) setNotice("Workspace service is connected. You can import a CV, add a role, or start a rehearsal.");
      return true;
    } catch (error) {
      setServiceStatus("offline");
      if (showSuccess) setNotice(error instanceof Error ? error.message : "The workspace service is unavailable. Please retry shortly.");
      return false;
    }
  }

  useEffect(() => {
    async function bootstrap() {
      const [jobsResult, candidateResult, healthResult] = await Promise.allSettled([
        requestJson<{ jobs: Job[] }>(`${API}/api/jobs?mode=demo`),
        requestJson<Candidate>(`${API}/api/candidate/demo`),
        requestJson<ServiceHealth>(`${API}/healthz`),
      ]);
      const jobsLoaded = jobsResult.status === "fulfilled";
      const candidateLoaded = candidateResult.status === "fulfilled";
      if (jobsLoaded && jobsResult.value.jobs.length) {
        setJobs(jobsResult.value.jobs);
        setSelectedJobId((previous) => previous || jobsResult.value.jobs[0].id);
      }
      if (candidateLoaded && candidateResult.value.evidence.length) setCandidate(candidateResult.value);
      if (healthResult.status === "fulfilled" && healthResult.value.ok && (jobsLoaded || candidateLoaded)) {
        setServiceStatus("online");
      } else {
        setServiceStatus("offline");
        // The persistent, labeled degraded-state banner carries this message.
        // Avoid duplicating it in the transient notice area where it can be
        // visually clipped by the command header on smaller viewports.
        setNotice(null);
      }
    }
    void bootstrap();
    return () => streamRef.current?.close();
  }, []);

  useEffect(() => {
    const route = routeState(pathname);
    setActiveNavigation(route.section);
    setView(route.view);
  }, [pathname]);

  function resetRun(nextView: WorkspaceView = "match") {
    streamRef.current?.close(); setRunId(null); setRunState("idle"); setMarket(null); setTurns([]); setPatches([]); setCoverageAfter(null); setCoverLetter(""); setCoverLetterEvidenceIds([]); setExportReadiness(null); setEvents([]); setActiveAgent("Ready when you are"); setShowCoverLetter(false); setView(nextView);
  }

  function scrollToShortlist() {
    window.requestAnimationFrame(() => shortlistRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function scrollToWorkspacePanel() {
    window.requestAnimationFrame(() => workspacePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function navigate(section: NavigationSection) {
    setActiveNavigation(section);
    if (pathname !== routeForSection[section]) router.push(routeForSection[section]);
    if (section === "workspace") { setView("match"); window.scrollTo({ top: 0, behavior: "smooth" }); }
    if (section === "applications") { setView("match"); scrollToShortlist(); }
    if (section === "practice") { setView("rehearse"); scrollToWorkspacePanel(); }
    if (section === "documents") { setView(patches.length ? "tailor" : "review"); scrollToWorkspacePanel(); }
  }

  function chooseEngine(mode: RunMode) {
    setRunMode(mode);
    setShowEngineMenu(false);
    setNotice(mode === "crewai"
      ? "CrewAI narration is selected. If no free provider key is configured, HireSwarm will clearly fall back to the Evidence Lab."
      : "Evidence Lab is selected. Its deterministic evidence checks control every claim and export.");
  }

  function explainServiceUnavailable() {
    setNotice("The live workspace API is unavailable. Demo fixtures are visible only for orientation; imports, live role discovery, rehearsals, approval, and exports are paused until the service reconnects.");
  }

  function startFromHero() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (selectedIsPractice) {
      setShowLiveFinder(true);
      setNotice("You are currently viewing a practice target. Find a live public role or paste a real job brief to prepare a real application packet.");
      return;
    }
    void startRehearsal();
  }

  function openBlankJobForm() {
    if (!serviceOnline) return explainServiceUnavailable();
    setManualTitle(""); setManualCompany(""); setManualLocation(""); setManualUrl(""); setManualDescription("");
    setShowJobForm(true);
  }

  function adaptSelectedJob() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (!selectedJob) return openBlankJobForm();
    setManualTitle(selectedJob.title); setManualCompany(selectedJob.company); setManualLocation(selectedJob.location);
    // Example links used by practice fixtures must not be relabeled as an official listing.
    setManualUrl(selectedJob.origin === "demo_fixture" ? "" : selectedJob.url);
    setManualDescription(selectedJob.description); setShowJobForm(true);
  }

  function openOfficialListing(url?: string) {
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
      window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    } catch { setNotice("This listing does not contain a safe official web link."); }
  }

  function updateTurn(round: number, update: Partial<Turn>) {
    setTurns((previous) => {
      const found = previous.find((turn) => turn.round === round);
      if (found) return previous.map((turn) => turn.round === round ? { ...turn, ...update } : turn);
      return [...previous, { round, requirement: String(update.requirement || "Role requirement"), ...update }].sort((a, b) => a.round - b.round);
    });
  }

  function receiveEvent(event: SwarmEvent) {
    setEvents((previous) => [event, ...previous].slice(0, 10));
    if (event.agent) setActiveAgent(event.agent);
    if (event.type === "market_report") { setMarket(event.payload as unknown as MarketReport); setView("match"); }
    if (event.type === "candidate_twin_ready") setView("rehearse");
    if (event.type === "interview_question") { const round = Number(event.payload.round || 1); updateTurn(round, { requirement: String(event.payload.requirement || "Role requirement"), question: String(event.payload.question || event.message || "") }); setView("rehearse"); }
    if (event.type === "candidate_answer") { const round = Number(event.payload.round || 1); updateTurn(round, { answer: String(event.payload.answer || event.message || ""), status: String(event.payload.status || ""), evidence_ids: Array.isArray(event.payload.evidence_ids) ? event.payload.evidence_ids.map(String) : [] }); }
    if (event.type === "interview_verdict" || event.type === "gap_detected") { const round = Number(event.payload.round || 1); updateTurn(round, { requirement: String(event.payload.requirement || "Role requirement"), status: String(event.payload.status || ""), verdict: String(event.payload.verdict || event.message || ""), evidence_ids: Array.isArray(event.payload.evidence_ids) ? event.payload.evidence_ids.map(String) : [] }); }
    if (event.type === "resume_patch") { setPatches(Array.isArray(event.payload.patches) ? event.payload.patches as Patch[] : []); setCoverageAfter(Number(event.payload.coverage_after || 0)); setCoverLetter(String(event.payload.cover_letter || "")); setCoverLetterEvidenceIds(Array.isArray(event.payload.cover_letter_evidence_ids) ? event.payload.cover_letter_evidence_ids.map(String) : []); setView("tailor"); }
    if (event.type === "export_readiness") setExportReadiness(event.payload as unknown as ExportReadiness);
    if (event.type === "evidence_needed") { setRunState("needs_evidence"); setActiveAgent("More direct evidence is needed"); setNotice(event.message || "Add source-linked evidence or choose a better-matched role before exporting."); setView("match"); }
    if (event.type === "approval_required") { setRunState("awaiting_approval"); setActiveNavigation("documents"); setActiveAgent("Your review is needed"); setView("review"); }
    if (event.type === "approved") { setRunState("approved"); setActiveNavigation("documents"); setActiveAgent("Application packet approved"); setView("review"); }
    if (event.type === "run_failed") { setRunState("failed"); setNotice(event.message || "The rehearsal could not finish. Please try again."); }
  }

  function reportActionError(error: unknown, fallback: string) {
    const message = error instanceof Error && error.message ? error.message : fallback;
    if (/could not reach|HTML error page|unreadable service response|empty response|API route is missing|workspace API is unavailable/i.test(message)) setServiceStatus("offline");
    setNotice(message);
  }

  async function startRehearsal() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (!selectedJob) return;
    resetRun("rehearse");
    setActiveNavigation("practice");
    scrollToWorkspacePanel();
    setRunState("running");
    setActiveAgent("Preparing your application brief");
    try {
      const data = await requestJson<{ run_id?: string; detail?: string }>(`${API}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: selectedJob.id, candidate, mode: runMode }),
      });
      if (!data.run_id) throw new Error(data.detail || "The workspace could not start this rehearsal.");
      setServiceStatus("online");
      setRunId(data.run_id);
      const source = new EventSource(`${API}/api/runs/${data.run_id}/events`);
      streamRef.current = source;
      let reachedTerminalEvent = false;
      source.onmessage = (message) => {
        try { receiveEvent(JSON.parse(message.data) as SwarmEvent); }
        catch { setNotice("One rehearsal update could not be read. The rest of the run is still continuing."); }
      };
      source.addEventListener("done", () => {
        reachedTerminalEvent = true;
        window.setTimeout(() => source.close(), 120);
      });
      source.onerror = () => {
        source.close();
        if (!reachedTerminalEvent) {
          setRunState("failed");
          setServiceStatus("offline");
          setNotice("The rehearsal stream disconnected before it finished. Nothing was exported — retry when the workspace connection is back.");
        }
      };
    } catch (error) {
      setRunState("failed");
      reportActionError(error, "The rehearsal could not start.");
    }
  }

  async function approvePacket() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (!runId) return;
    try {
      await requestJson<Record<string, unknown>>(`${API}/api/runs/${runId}/approve`, { method: "POST" });
      setServiceStatus("online");
      setRunState("approved");
      setActiveAgent("Application packet approved");
      setEvents((previous) => [{ type: "approved", agent: "You", title: "You approved the application packet", message: "Export is now unlocked. Submission remains in your control.", payload: {} }, ...previous]);
    } catch (error) { reportActionError(error, "Approval could not be saved."); }
  }

  async function exportPacket(format: "docx" | "pdf") {
    if (!serviceOnline) return explainServiceUnavailable();
    if (!runId) return;
    try {
      const response = await requestFile(`${API}/api/runs/${runId}/export/${format}`);
      const content = await response.blob();
      if (!content.size) throw new Error("The export was empty. Please run the review again.");
      setServiceStatus("online");
      const anchor = document.createElement("a");
      const objectUrl = URL.createObjectURL(content);
      anchor.href = objectUrl;
      anchor.download = format === "docx" ? "HireSwarm_Approved_Application.docx" : "HireSwarm_Approved_Application.pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) { reportActionError(error, "The approved packet could not be exported."); }
  }

  function mergeJobs(incoming: Job[], chooseFirst = true) {
    if (!incoming.length) return;
    setJobs((previous) => {
      const next = [...incoming, ...previous.filter((job) => !incoming.some((fresh) => fresh.id === job.id))];
      return next;
    });
    if (chooseFirst) setSelectedJobId(incoming[0].id);
    setActiveNavigation("applications");
    setShowAllJobs(false);
    resetRun("match");
  }

  async function addManualJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!serviceOnline) return explainServiceUnavailable();
    if (manualTitle.trim().length < 2 || manualCompany.trim().length < 2 || manualDescription.trim().length < 20) {
      setNotice("Add a role title, company, and at least a short role description before creating a target.");
      return;
    }
    try {
      const job = await requestJson<Job>(`${API}/api/jobs/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: manualTitle, company: manualCompany, description: manualDescription, location: manualLocation, url: manualUrl }),
      });
      setServiceStatus("online");
      mergeJobs([job]);
      setShowJobForm(false);
      setManualTitle(""); setManualCompany(""); setManualLocation(""); setManualUrl(""); setManualDescription("");
      setNotice("Your role is now in the shortlist and is clearly marked as applicant-provided.");
    } catch (error) { reportActionError(error, "That job brief could not be added."); }
  }

  async function discoverPublicRoles(query: string, source: "all" | "remotive" | "arbeitnow") {
    if (!serviceOnline) return explainServiceUnavailable();
    try {
      const data = await requestJson<SourceResponse>(`${API}/api/jobs/live?query=${encodeURIComponent(query)}&source=${source}`);
      setServiceStatus("online");
      if (!data.jobs.length) throw new Error(data.source_errors?.[0] || "No current public roles matched. No fixture was substituted.");
      mergeJobs(data.jobs);
      setShowLiveFinder(false);
      const cacheNote = data.provenance?.cache_state === "cached" ? "cached public feed" : "fresh public feed";
      setNotice(`Added ${data.jobs.length} roles from a ${cacheNote}. Each listing keeps its direct source link.`);
    } catch (error) { reportActionError(error, "Live roles could not be loaded. You can paste a role instead."); }
  }

  async function connectPublicBoard(source: "greenhouse" | "lever", board: string) {
    if (!serviceOnline) return explainServiceUnavailable();
    try {
      const data = await requestJson<SourceResponse>(`${API}/api/jobs/public-board`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, board }),
      });
      setServiceStatus("online");
      if (!data.jobs.length) throw new Error("That public board did not return any available roles. You can paste one listing instead.");
      mergeJobs(data.jobs);
      setShowLiveFinder(false);
      setNotice(`Added ${data.jobs.length} published role${data.jobs.length === 1 ? "" : "s"} from the official ${source === "greenhouse" ? "Greenhouse" : "Lever"} board. HireSwarm only reads listings; you apply on the official site.`);
    } catch (error) { reportActionError(error, "The public board could not be read."); }
  }

  async function importResume(file: File) {
    if (!serviceOnline) return explainServiceUnavailable();
    setIsImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await requestJson<{ candidate?: Candidate; import?: ImportInfo; detail?: string }>(`${API}/api/candidate/upload`, { method: "POST", body: form });
      if (!data.candidate) throw new Error(data.detail || "That document could not be read.");
      setServiceStatus("online");
      setCandidate(data.candidate);
      resetRun("match");
      setNotice(`Imported ${data.import?.filename || "your CV"}: ${data.import?.evidence_count || data.candidate.evidence.length} reviewable evidence notes. ${data.import?.retention || ""}`);
    } catch (error) { reportActionError(error, "That document could not be read."); }
    finally { setIsImporting(false); }
  }

  async function analyzeResume() {
    if (!serviceOnline) return explainServiceUnavailable();
    setIsAnalyzing(true);
    try {
      const data = await requestJson<Candidate | { detail?: string }>(`${API}/api/candidate/normalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate),
      });
      if (!("evidence" in data)) throw new Error(data.detail || "We could not build an evidence ledger from this resume.");
      setServiceStatus("online");
      setCandidate(data);
      resetRun("match");
      setNotice("Your evidence ledger was refreshed from the resume text. Review it before running a rehearsal.");
    } catch (error) { reportActionError(error, "Resume analysis did not complete."); }
    finally { setIsAnalyzing(false); }
  }

  function updateCandidate(field: keyof Candidate, value: string) {
    setCandidate((previous) => field === "resume_text"
      ? { ...previous, resume_text: value, evidence: [] }
      : { ...previous, [field]: value });
    if (field === "resume_text") setNotice("Resume text changed. Refresh the evidence ledger before running a rehearsal.");
  }

  return <main className="workspace-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="mark">h.</div><span>hire<span>swarm</span></span></div>
      <nav className="primary-nav" aria-label="Workspace navigation">
        <Link href="/workspace" className={cx("nav-item", activeNavigation === "workspace" && "active")} onClick={(event) => { event.preventDefault(); navigate("workspace"); }}><NavGlyph type="grid" />Workspace</Link>
        <Link href="/applications" className={cx("nav-item", activeNavigation === "applications" && "active")} onClick={(event) => { event.preventDefault(); navigate("applications"); }}><NavGlyph type="briefcase" />Applications <small>{jobs.length}</small></Link>
        <Link href="/practice" className={cx("nav-item", activeNavigation === "practice" && "active")} onClick={(event) => { event.preventDefault(); navigate("practice"); }}><NavGlyph type="chat" />Practice</Link>
        <Link href="/documents" className={cx("nav-item", activeNavigation === "documents" && "active")} onClick={(event) => { event.preventDefault(); navigate("documents"); }}><NavGlyph type="document" />Documents</Link>
      </nav>
      <div className="sidebar-spacer" />
      <section className="candidate-card"><div className="candidate-avatar">{initials(candidate.name)}</div><div className="candidate-card-copy"><small>YOUR PROFILE</small><b>{candidate.name}</b><span>{candidate.location}</span></div><button onClick={() => setShowIntake(true)} aria-label="Edit candidate profile">⋯</button></section>
      <div className="sidebar-note"><span /> <p><b>Evidence-first</b> means every change stays tied to something you can stand behind.</p></div>
    </aside>

    <div className="app-content">
      <header className="app-header command-header">
        <div className="header-context command-context" aria-label="Current workspace location">
          <div className="breadcrumb-stack">
            <span className="context-label">APPLICATION STUDIO</span>
            <div><button className="crumb-button" onClick={() => navigate("applications")}>Applications</button><i>/</i><button className="crumb-target" onClick={adaptSelectedJob}>{selectedJob?.company || "Workspace"}</button></div>
          </div>
          <button className={cx("service-indicator", serviceStatus)} onClick={() => void checkService(true)} title="Check workspace connection" aria-label={`Workspace connection: ${serviceCopy}. Click to retry.`}>
            <span className="service-pulse" /><span><b>{serviceStatus === "online" ? "Live workspace" : serviceStatus === "checking" ? "Connecting" : "Retry connection"}</b><small>{serviceStatus === "online" ? "API ready" : serviceStatus === "checking" ? "Checking API" : "Tap to reconnect"}</small></span><i aria-hidden="true">↻</i>
          </button>
        </div>
        <div className="header-actions command-actions" aria-label="Workspace controls">
          <div className="engine-switcher">
            <button className="command-action engine-trigger" onClick={() => setShowEngineMenu((open) => !open)} aria-expanded={showEngineMenu} aria-haspopup="menu" aria-label="Choose workflow engine">
              <span className="command-icon engine-symbol">✦</span><span className="mobile-command-label">Engine</span><span className="command-copy"><b>{runMode === "crewai" ? "CrewAI relay" : "Evidence Lab"}</b><small>Workflow engine</small></span><span className="chevron">⌄</span>
            </button>
            {showEngineMenu && <div className="engine-menu" role="menu" aria-label="Choose workflow engine">
              <p className="menu-overline">WORKFLOW ENGINE</p>
              <button role="menuitem" className={cx(runMode === "evidence_lab" && "selected")} onClick={() => chooseEngine("evidence_lab")}><span className="engine-menu-symbol">✓</span><span><b>Evidence Lab</b><small>Deterministic proof checks · default</small></span>{runMode === "evidence_lab" && <i>Selected</i>}</button>
              <button role="menuitem" className={cx(runMode === "crewai" && "selected")} onClick={() => chooseEngine("crewai")}><span className="engine-menu-symbol">✦</span><span><b>CrewAI relay</b><small>Optional free-provider narration</small></span>{runMode === "crewai" && <i>Selected</i>}</button>
            </div>}
          </div>
          <button className="command-action guide-action" onClick={() => setShowGuide(true)} aria-label="Open how HireSwarm works guide"><span className="command-icon">?</span><span className="mobile-command-label">Guide</span><span className="command-copy"><b>Guide</b><small>See the path</small></span></button>
          <button className="command-action find-action" onClick={() => serviceOnline ? setShowLiveFinder(true) : explainServiceUnavailable()} aria-label="Find public roles" aria-disabled={!serviceOnline}><span className="command-icon">⌕</span><span className="mobile-command-label">Roles</span><span className="command-copy"><b>Find roles</b><small>{serviceOnline ? "Public sources" : "API paused"}</small></span></button>
          <button className="command-action paste-action" onClick={openBlankJobForm} aria-label="Paste a job listing"><span className="command-icon">+</span><span className="mobile-command-label">Paste</span><span className="command-copy"><b>Paste role</b><small>Add your listing</small></span></button>
          <button className="profile-button command-profile" onClick={() => setShowIntake(true)} aria-label="Open your profile"><span>{initials(candidate.name)}</span><i>Profile</i><small className="mobile-command-label">You</small></button>
        </div>
      </header>
      <div className="page-wrap">
        {serviceStatus === "offline" && <section className="service-outage" role="alert" aria-labelledby="service-outage-title">
          <div className="service-outage-icon" aria-hidden="true">!</div>
          <div><p className="section-kicker">LIVE WORKSPACE PAUSED</p><h2 id="service-outage-title">We can’t reach your private workspace right now.</h2><p>Your visible profile and practice target are orientation-only fixtures. No import, role search, rehearsal, approval, or export will be represented as completed until the API reconnects.</p></div>
          <button type="button" onClick={() => void checkService(true)} aria-label="Retry workspace connection">Retry connection</button>
        </section>}
        {notice && <div className="notice" role="status" aria-live="polite"><span>i</span><p>{notice}</p><button onClick={() => setNotice(null)} aria-label="Dismiss notice">Dismiss</button></div>}
        <section className="command-hero" aria-labelledby="workspace-title">
          <div className="command-hero-copy">
            <div className="hero-overline"><span className={cx("data-state", selectedIsPractice && "practice")}>{selectedIsPractice ? "PRACTICE MODE" : sourceLabel(selectedJob?.origin || "user_pasted").toUpperCase()}</span><span>APPLICANT-CONTROLLED · NO AUTO-APPLY</span></div>
            <h1 id="workspace-title">Make your real work <em>impossible to miss.</em></h1>
            <p className="command-hero-lede">Hi {candidateFirstName}. HireSwarm turns your evidence into a focused, reviewable case for one role — without inventing a thing.</p>
            <div className="hero-cta-row">
              <button className="hero-primary" disabled={runState === "running" || !serviceOnline} onClick={startFromHero} aria-describedby={!serviceOnline ? "service-outage-title" : undefined}><span className="hero-primary-icon">{runState === "running" ? "···" : selectedIsPractice ? "↗" : "▶"}</span><span><b>{runState === "running" ? "Rehearsal in progress" : selectedIsPractice ? "Choose a real role" : "Run focused rehearsal"}</b><small>{selectedIsPractice ? "Public source or your own listing" : "Map proof before you edit"}</small></span></button>
              <button className="hero-secondary" onClick={() => setShowGuide(true)}><span>01–04</span><span><b>See the four-step path</b><small>CV → role → proof → review</small></span><i>→</i></button>
            </div>
            <div className="hero-stat-row" aria-label={`${candidate.evidence.length} evidence notes, ${selectedIsPractice ? "practice target" : "real target"}, and applicant approval required`}>
              <div><b>{candidate.evidence.length}</b><span>evidence notes</span></div><div><b>{selectedIsPractice ? "Safe" : "Live"}</b><span>{selectedIsPractice ? "practice target" : "real target loaded"}</span></div><div><b>100%</b><span>your final approval</span></div>
            </div>
          </div>
          <HeroScene candidateName={candidateFirstName} evidenceCount={candidate.evidence.length} job={selectedJob} score={market?.score ?? null} serviceStatus={serviceStatus} />
        </section>
        <section className="launchpad-card" aria-labelledby="launchpad-title">
          <div className="launchpad-intro"><p className="section-kicker">START HERE</p><h2 id="launchpad-title">Bring one honest input.<br />We’ll make it usable.</h2><p>{selectedIsPractice ? "This workspace is showing safe sample data. Use any path below to move into your own application." : "Your selected target is ready. Check the source, then start the evidence rehearsal when it feels right."}</p></div>
          <div className="launchpad-paths">
            <button className="launch-path cv-path" onClick={() => serviceOnline ? setShowIntake(true) : explainServiceUnavailable()} aria-disabled={!serviceOnline}><span className="path-top"><i>01</i><em>CV</em></span><b>{serviceOnline ? "Import your CV" : "CV import paused"}</b><small>{serviceOnline ? `${candidate.evidence.length} evidence notes ready` : "Available when API reconnects"}</small><span className="path-arrow">→</span></button>
            <button className="launch-path source-path" onClick={() => serviceOnline ? setShowLiveFinder(true) : explainServiceUnavailable()} aria-disabled={!serviceOnline}><span className="path-top"><i>02</i><em>↗</em></span><b>Find public roles</b><small>{serviceOnline ? "Remotive, Arbeitnow, or ATS" : "Available when API reconnects"}</small><span className="path-arrow">→</span></button>
            <button className="launch-path paste-path" onClick={openBlankJobForm} aria-disabled={!serviceOnline}><span className="path-top"><i>03</i><em>+</em></span><b>Paste a listing</b><small>{serviceOnline ? "Keep the official link with it" : "Available when API reconnects"}</small><span className="path-arrow">→</span></button>
            <button className="launch-path practice-path" onClick={() => void startRehearsal()} disabled={!serviceOnline}><span className="path-top"><i>04</i><em>◎</em></span><b>Explore safely</b><small>{serviceOnline ? "Try the practice flow first" : "Rehearsal is paused"}</small><span className="path-arrow">→</span></button>
          </div>
        </section>
        <section className="progress-nav" aria-label="Application workflow">{views.map((item, index) => { const done = (item.id === "match" && Boolean(market)) || (item.id === "rehearse" && turns.length > 0) || (item.id === "tailor" && patches.length > 0) || (item.id === "review" && ["awaiting_approval", "approved"].includes(runState)); return <button key={item.id} className={cx("progress-step", view === item.id && "active", done && "done")} onClick={() => { setView(item.id); setActiveNavigation(item.id === "match" ? "workspace" : item.id === "rehearse" ? "practice" : "documents"); scrollToWorkspacePanel(); }}><span>{done ? "✓" : item.number}</span><div><b>{item.label}</b><small>{item.hint}</small></div>{index < views.length - 1 && <i />}</button>; })}</section>
        <div className="workspace-grid"><section className="main-column">
          <article className="target-card"><div className="target-card-top"><div className="target-label"><span>{sourceLabel(selectedJob?.origin || "demo_fixture")}</span><b>Target brief</b></div><div className="target-card-actions">{selectedJob?.url && selectedJob.origin !== "demo_fixture" && <button className="text-action" onClick={() => openOfficialListing(selectedJob.url)}>Open source ↗</button>}<button className="text-action" onClick={adaptSelectedJob}>Adapt this target</button></div></div><div className="target-body"><div className="company-seal">{selectedJob?.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div className="target-copy"><h2>{selectedJob?.title}</h2><p>{selectedJob?.company} <i>·</i> {selectedJob?.location} <i>·</i> {selectedJob?.type}</p><small className="source-line">{sourceDetail(selectedJob)} · updated {selectedJob?.posted || "not disclosed"}</small><div className="role-tags">{selectedJob?.must_have.slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}</div></div><div className="fit-summary"><div className="score-orbit" style={{ "--score": `${market?.score || 0}%` } as React.CSSProperties}><span>{market?.score || "—"}<small>{market ? "%" : "FIT"}</small></span></div><div><small>ROLE ALIGNMENT</small><b>{market ? "Evidence mapped" : "Ready to assess"}</b><p>{market ? `${directMatches} direct strengths found` : "Built from your verified work"}</p></div></div></div></article>
          <section ref={workspacePanelRef} className="workspace-panel"><div className="panel-topline"><div><p className="kicker">{views.find((item) => item.id === view)?.number} / {views.find((item) => item.id === view)?.label?.toUpperCase()}</p><h2>{panelHeading(view, runState)}</h2></div><div className="live-context"><span className={cx("tiny-status", runState === "running" && "is-live")} />{activeAgent}</div></div>
            {view === "match" && <MatchPanel selectedJob={selectedJob} market={market} onStart={() => void startRehearsal()} runState={runState} canRun={serviceOnline} />}
            {view === "rehearse" && <RehearsalPanel turns={turns} currentTurn={currentTurn} runState={runState} onStart={() => void startRehearsal()} canRun={serviceOnline} />}
            {view === "tailor" && <TailorPanel patches={patches} coverLetter={coverLetter} coverLetterEvidenceIds={coverLetterEvidenceIds} showCoverLetter={showCoverLetter} onToggleCoverLetter={() => setShowCoverLetter((current) => !current)} onStart={() => void startRehearsal()} canRun={serviceOnline} />}
            {view === "review" && <ReviewPanel runState={runState} patches={patches} gaps={market?.gaps || []} readiness={exportReadiness} selectedJob={selectedJob} onApprove={() => void approvePacket()} onExport={exportPacket} onOpenOfficial={openOfficialListing} serviceOnline={serviceOnline} />}
          </section>
          <section ref={shortlistRef} className="shortlist-card"><div className="section-heading"><div><p className="kicker">YOUR SHORTLIST</p><h2>Worth a closer look</h2></div><div className="shortlist-actions"><button className="text-action" onClick={() => serviceOnline ? setShowLiveFinder(true) : explainServiceUnavailable()} aria-disabled={!serviceOnline}>Find live roles</button><button className="text-action" onClick={openBlankJobForm} aria-disabled={!serviceOnline}>Paste another role</button></div></div><div className="job-grid">{visibleJobs.map((job) => <button key={job.id} className={cx("job-tile", job.id === selectedJob?.id && "selected")} onClick={() => { setSelectedJobId(job.id); setActiveNavigation("applications"); resetRun("match"); }}><span className="job-tile-index">{String(jobs.indexOf(job) + 1).padStart(2, "0")}</span><div><b>{job.title}</b><p>{job.company} · {job.location}</p><small>{job.must_have.slice(0, 3).join(" · ")}</small></div><i>↗</i></button>)}</div>{jobs.length > 3 && <div className="shortlist-footer"><button className="text-action" onClick={() => setShowAllJobs((current) => !current)}>{showAllJobs ? "Show fewer roles" : `Show ${jobs.length - 3} more role${jobs.length - 3 === 1 ? "" : "s"}`} <span>{showAllJobs ? "↑" : "↓"}</span></button><small>{visibleJobs.length} of {jobs.length} targets shown</small></div>}</section>
        </section>
        <aside className="insight-column"><section className="evidence-card"><div className="section-heading"><div><p className="kicker">EVIDENCE VAULT</p><h2>What you can prove</h2></div><span className="count-pill">{candidate.evidence.length}</span></div><div className="evidence-meter"><div className="meter-number"><b>{market ? coverage : "—"}</b><span>{market ? "%" : "ready"}</span></div><div className="meter-copy"><b>Coverage, not confidence.</b><p>{market ? "Direct proof is separated from adjacent experience." : "Run the brief to see role-specific evidence coverage."}</p></div></div><EvidenceGroup label="Direct strengths" tone="mint" items={market ? market.verified_strengths.map((item) => item.skill) : evidencePreviewSkills} /><EvidenceGroup label="Adjacent experience" tone="amber" items={market ? market.adjacent_strengths.map((item) => item.skill) : []} /><EvidenceGroup label="Keep visible" tone="coral" items={market ? market.gaps.map((item) => item.skill) : []} /></section>
          <section className="proof-card"><p className="kicker">TODAY&apos;S PROOF</p><blockquote>“{proofItem?.source_text || "Import or write a literal work statement to begin."}”</blockquote><div><span>Evidence {proofItem?.evidence_id || "—"}</span><b>{proofItem ? "Verified source" : "Needs source"}</b></div></section>
          <section className="activity-card"><div className="section-heading"><div><p className="kicker">WORK LOG</p><h2>What just happened</h2></div><span className="log-count">{events.length}</span></div>{events.length ? <div className="activity-list">{events.slice(0, 4).map((event, index) => <article key={`${event.type}-${index}-${event.at}`} className={cx("activity-row", event.type)}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{event.title}</b><p>{event.message || event.agent || "System update"}</p></div></article>)}</div> : <div className="activity-empty">Your work log will stay short, readable, and useful — not a wall of agent chatter.</div>}</section>
        </aside></div>
      </div>
    </div>
    {showIntake && <CandidateModal candidate={candidate} onClose={() => setShowIntake(false)} onChange={updateCandidate} onRestore={() => { setCandidate(fallbackCandidate); resetRun("match"); }} onAnalyze={() => void analyzeResume()} onUpload={(file) => void importResume(file)} isAnalyzing={isAnalyzing} isImporting={isImporting} serviceOnline={serviceOnline} />}
    {showJobForm && <JobModal title={manualTitle} company={manualCompany} location={manualLocation} url={manualUrl} description={manualDescription} onTitle={setManualTitle} onCompany={setManualCompany} onLocation={setManualLocation} onUrl={setManualUrl} onDescription={setManualDescription} onClose={() => setShowJobForm(false)} onSubmit={(event) => void addManualJob(event)} />}
    {showLiveFinder && <LiveRolesModal onClose={() => setShowLiveFinder(false)} onDiscover={discoverPublicRoles} onConnect={connectPublicBoard} />}
    {showGuide && <HowItWorksModal onClose={() => setShowGuide(false)} onOpenProfile={() => { setShowGuide(false); setShowIntake(true); }} onOpenLive={() => { if (!serviceOnline) return explainServiceUnavailable(); setShowGuide(false); setShowLiveFinder(true); }} onOpenManual={() => { setShowGuide(false); openBlankJobForm(); }} />}
  </main>;
}

function HeroScene({ candidateName, evidenceCount, job, score, serviceStatus }: { candidateName: string; evidenceCount: number; job?: Job; score: number | null; serviceStatus: ServiceStatus }) {
  const scoreLabel = score === null ? "READY" : `${score}%`;
  return <div className="hero-scene" aria-label={`A visual map from ${evidenceCount} evidence notes to ${job?.title || "your target role"}`}>
    <div className="scene-aurora" /><div className="scene-grid" /><div className="scene-shadow" />
    <div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="scene-spark spark-one" /><span className="scene-spark spark-two" /><span className="scene-spark spark-three" />
    <article className="scene-card scene-evidence"><span className="scene-card-label"><i>✓</i> VERIFIED INPUT</span><b>{evidenceCount} proof notes</b><p>Only sourced work enters the flow.</p><div className="mini-bars"><i /><i /><i /></div></article>
    <article className="scene-core"><span className="core-halo" /><span className="core-orb">{scoreLabel}<small>{score === null ? "FIT" : "MAPPED"}</small></span><div><small>YOUR CASE</small><b>Evidence, not hype.</b></div></article>
    <article className="scene-card scene-role"><span className="scene-card-label"><i>↗</i> SELECTED ROLE</span><b>{job?.title || "Choose a target"}</b><p>{job?.company || "Bring in a real listing"}</p><span className="scene-chip">{job?.origin === "demo_fixture" ? "Practice target" : "Applicant-controlled"}</span></article>
    <article className="scene-person"><span>{initials(candidateName)}</span><div><small>APPLICANT</small><b>{candidateName}</b><p>{serviceStatus === "online" ? "Workspace connected" : serviceStatus === "checking" ? "Connecting workspace" : "Preview only · API unavailable"}</p></div></article>
  </div>;
}

function SignalOrb({ score, runState }: { score: number | null; runState: RunState }) {
  const label = score === null ? (runState === "running" ? "MAP" : "READY") : `${score}%`;
  return <div className={cx("signal-orb", runState === "running" && "is-mapping")} aria-hidden="true">
    <span className="signal-ring ring-a" /><span className="signal-ring ring-b" /><span className="signal-spark spark-a" /><span className="signal-spark spark-b" />
    <div className="signal-core"><b>{label}</b><small>{score === null ? "PROOF" : "FIT"}</small></div>
  </div>;
}

function panelHeading(view: WorkspaceView, state: RunState) { if (view === "match") return "A practical read on this role"; if (view === "rehearse") return state === "running" ? "The interview is being rehearsed" : "Practice the questions that matter"; if (view === "tailor") return "Edit for relevance, not invention"; return state === "approved" ? "Your packet is ready to take with you" : "You make the final call"; }

function MatchPanel({ selectedJob, market, onStart, runState, canRun }: { selectedJob?: Job; market: MarketReport | null; onStart: () => void; runState: RunState; canRun: boolean }) {
  const requirementRows = selectedJob?.must_have || [];
  return <div className="match-layout"><div className="match-story"><p>{selectedJob?.description}</p><div className="story-callout"><span>✦</span><div><b>Start from the work you&apos;ve actually done.</b><p>HireSwarm maps each requirement to a source in your profile, flags the difference between direct and adjacent experience, then keeps true gaps visible.</p></div></div><button className="inline-primary" onClick={onStart} disabled={runState === "running" || !canRun}>{runState === "running" ? "Mapping evidence…" : canRun ? "Assess this fit" : "Assessment paused"} <span>→</span></button></div><div className="requirements-list"><div className="requirement-header"><span>ROLE REQUIREMENTS</span><small>{market ? "mapped to evidence" : "to be assessed"}</small></div>{requirementRows.map((skill, index) => { const direct = market?.verified_strengths.some((item) => item.skill === skill); const adjacent = market?.adjacent_strengths.some((item) => item.skill === skill); return <div className="requirement-row" key={skill}><span className={cx("requirement-icon", direct && "direct", adjacent && "adjacent")}>{direct ? "✓" : adjacent ? "~" : String(index + 1).padStart(2, "0")}</span><div><b>{skill}</b><p>{direct ? "Direct evidence available" : adjacent ? "Related evidence — confirm the boundary" : "No evidence assessed yet"}</p></div></div>; })}</div></div>;
}

function RehearsalPanel({ turns, currentTurn, runState, onStart, canRun }: { turns: Turn[]; currentTurn?: Turn; runState: RunState; onStart: () => void; canRun: boolean }) {
  if (!turns.length && runState !== "running") return <div className="rehearsal-empty"><div className="conversation-preview"><div className="speaker-card hr"><span>HR</span><p>“Tell me about the proof behind your most relevant work.”</p></div><div className="speaker-card candidate"><span>YOU</span><p>“I&apos;ll answer from the evidence already in my profile.”</p></div></div><div><h3>A calm rehearsal, not a performance.</h3><p>We test only the requirements that matter to this role. If the evidence is missing, we name the gap instead of inventing an answer.</p><button className="inline-primary" onClick={onStart} disabled={!canRun}>{canRun ? "Begin interview rehearsal" : "Rehearsal paused"} <span>→</span></button></div></div>;
  return <div className="rehearsal-wrap"><div className="interview-status"><div><span className={cx("record-dot", runState === "running" && "recording")} /> {runState === "running" ? "Rehearsal in progress" : "Interview notes"}</div><b>{turns.length}/4 prompts reviewed</b></div><div className="conversation-list">{turns.map((turn) => <article className="conversation-turn" key={turn.round}><div className="turn-marker">{String(turn.round).padStart(2, "0")}</div><div className="turn-content"><div className="question-bubble"><span>HIRING PANEL · {turn.requirement}</span><p>{turn.question || "Preparing the next role-specific question…"}</p></div>{turn.answer && <div className="answer-bubble"><span>YOUR TWIN · <b className={cx("status-word", turn.status?.toLowerCase())}>{turn.status}</b></span><p>{turn.answer}</p>{turn.evidence_ids?.length ? <div className="source-pills">{turn.evidence_ids.map((id) => <i key={id}>{id}</i>)}</div> : null}</div>}{turn.verdict && <div className={cx("verdict", turn.status?.toLowerCase())}>{turn.verdict}</div>}</div></article>)}</div>{runState === "running" && <div className="now-thinking"><span /><p>{currentTurn?.question ? "Checking the answer against the evidence ledger…" : "Preparing the next interview prompt…"}</p></div>}</div>;
}

function TailorPanel({ patches, coverLetter, coverLetterEvidenceIds, showCoverLetter, onToggleCoverLetter, onStart, canRun }: { patches: Patch[]; coverLetter: string; coverLetterEvidenceIds: string[]; showCoverLetter: boolean; onToggleCoverLetter: () => void; onStart: () => void; canRun: boolean }) {
  if (!patches.length) return <div className="tailor-empty"><div className="paper-stack"><span /><span /><article><small>YOUR RESUME</small><b>Relevant work, clearly stated.</b><p>The strongest application is specific about what you did — and careful about what you did not do.</p></article></div><div><h3>Your resume will stay yours.</h3><p>Once the rehearsal is complete, HireSwarm suggests small, source-linked changes. You see every original sentence before deciding what to keep.</p><button className="inline-primary" onClick={onStart} disabled={!canRun}>{canRun ? "Run the evidence check" : "Evidence check paused"} <span>→</span></button></div></div>;
  if (showCoverLetter) return <div className="letter-view"><div className="letter-toolbar"><div><span>APPLICATION NOTE</span><b>Draft cover letter</b></div><button className="text-action" onClick={onToggleCoverLetter}>Back to revisions</button></div>{coverLetterEvidenceIds.length > 0 && <div className="letter-evidence"><span>Bound to evidence</span>{coverLetterEvidenceIds.map((id) => <i key={id}>{id}</i>)}</div>}<pre>{coverLetter}</pre></div>;
  return <div className="revision-wrap"><div className="revision-toolbar"><div><span>{patches.length} suggested changes</span><p>Each revision carries its evidence trail.</p></div><button className="outline-action small" onClick={onToggleCoverLetter} disabled={!coverLetter}>Read cover letter</button></div><div className="revision-list">{patches.map((patch, index) => <article className="revision" key={`${patch.original}-${index}`}><div className="revision-number">{String(index + 1).padStart(2, "0")}</div><div className="revision-body"><div className="revision-section">{patch.section}</div>{patch.proposed.trim() === patch.original.trim() ? <><p className="before source-only">SOURCE SENTENCE</p><p className="after">Keep this exact wording; prioritize it in this section for the target role.</p></> : <><p className="before"><s>{patch.original}</s></p><p className="after">{patch.proposed}</p></>}<div className="revision-meta"><span>Backed by {patch.evidence_ids.map((id) => <i key={id}>{id}</i>)}</span><em>{patch.reason}</em></div></div></article>)}</div></div>;
}

function ReviewPanel({ runState, patches, gaps, readiness, selectedJob, onApprove, onExport, onOpenOfficial, serviceOnline }: { runState: RunState; patches: Patch[]; gaps: { skill: string; severity: string }[]; readiness: ExportReadiness | null; selectedJob?: Job; onApprove: () => void; onExport: (format: "docx" | "pdf") => void; onOpenOfficial: (url?: string) => void; serviceOnline: boolean }) {
  const ready = runState === "awaiting_approval" || runState === "approved";
  const extractionPassed = readiness?.checks.find((item) => item.label === "PDF text round-trip")?.passed ?? false;
  return <div className="review-layout"><div className="review-lead"><div className={cx("review-seal", runState === "approved" && "approved")}>{runState === "approved" ? "✓" : "01"}</div><div><h3>{runState === "approved" ? "You're ready to apply on your terms." : ready ? "A final read is all that's left." : "The application packet will appear here."}</h3><p>{runState === "approved" ? "Your verified revisions and cover letter are ready to take with you. HireSwarm will never submit an application for you." : ready ? "Check the rewritten sentences, acknowledge the gaps that remain, then approve the packet when it sounds like you." : "Complete the rehearsal and tailoring steps to create a document you can review."}</p></div></div><div className="review-checks"><ReviewCheck complete={patches.length > 0} label={`${patches.length || "No"} evidence-linked resume revisions`} /><ReviewCheck complete label={gaps.length ? `${gaps.length} growth area${gaps.length > 1 ? "s" : ""} kept visible` : "No unmet role requirements detected"} /><ReviewCheck complete={Boolean(readiness?.passed && extractionPassed)} label={readiness?.passed ? "One-column export passed a real PDF text check" : "Export readiness will be checked before approval"} /><ReviewCheck complete={runState === "approved"} label={runState === "approved" ? "Your approval has been recorded" : "Your approval is still required"} /></div>{readiness && <div className="readiness-note"><span>{readiness.passed ? "✓" : "!"}</span><p><b>Document QA</b> · {readiness.verified_bullets} verified bullet{readiness.verified_bullets === 1 ? "" : "s"}; {readiness.extracted_characters} characters read back from the generated PDF.</p></div>}<div className="review-actions">{runState === "awaiting_approval" && <button className="approve-action" onClick={onApprove} disabled={!serviceOnline}>{serviceOnline ? "I've reviewed this packet" : "Approval paused"} <span>→</span></button>}{runState === "approved" && <><button className="approve-action export" onClick={() => onExport("docx")} disabled={!serviceOnline}>Download .docx <span>↓</span></button><button className="outline-action" onClick={() => onExport("pdf")} disabled={!serviceOnline}>Printable PDF <span>↓</span></button>{selectedJob?.url && selectedJob.origin !== "demo_fixture" && <button className="outline-action" onClick={() => onOpenOfficial(selectedJob.url)}>Open official listing ↗</button>}</>} {!ready && <span className="locked-action">Complete a rehearsal to unlock review</span>}</div></div>;
}

function ReviewCheck({ complete, label }: { complete: boolean; label: string }) { return <div className={cx("review-check", complete && "complete")}><span>{complete ? "✓" : "○"}</span><p>{label}</p></div>; }
function EvidenceGroup({ label, tone, items }: { label: string; tone: "mint" | "amber" | "coral"; items: string[] }) { return <section className={cx("evidence-group", tone)}><div><span /> <b>{label}</b><small>{items.length}</small></div><p>{items.slice(0, 3).join(" · ") || "No evidence yet"}</p></section>; }

function CandidateModal({ candidate, onClose, onChange, onRestore, onAnalyze, onUpload, isAnalyzing, isImporting, serviceOnline }: { candidate: Candidate; onClose: () => void; onChange: (field: keyof Candidate, value: string) => void; onRestore: () => void; onAnalyze: () => void; onUpload: (file: File) => void; isAnalyzing: boolean; isImporting: boolean; serviceOnline: boolean }) {
  return <ModalShell onClose={onClose} eyebrow="YOUR PROFILE" title="Keep your evidence current."><p className="modal-copy">Import a real PDF, DOCX, or TXT CV, or paste text below. The document is parsed in memory for this session; HireSwarm does not retain the original file.</p>{!serviceOnline && <p className="modal-service-note" role="status">The API is offline. You may review or edit this local draft, but importing and refreshing evidence are paused.</p>}<label className="upload-drop"><span>IMPORT CV</span><input type="file" disabled={!serviceOnline} accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} /><b>{isImporting ? "Reading your document…" : serviceOnline ? "Choose a PDF, DOCX, or TXT file" : "Import paused while offline"}</b><small>Text-based PDFs only · 6 MB maximum · source file is not stored</small></label><label>Name<input value={candidate.name} onChange={(event) => onChange("name", event.target.value)} /></label><label>Professional headline<input value={candidate.headline} onChange={(event) => onChange("headline", event.target.value)} /></label><label>Resume text<textarea rows={8} value={candidate.resume_text} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange("resume_text", event.target.value)} /></label><div className="modal-evidence"><b>{candidate.evidence.length} evidence notes protected</b><span>We only promote a statement after it has a source.</span></div><div className="modal-actions"><button className="text-action" onClick={onRestore}>Restore practice profile</button><div><button className="outline-action" onClick={onAnalyze} disabled={!serviceOnline || isAnalyzing || isImporting}>{isAnalyzing ? "Reading resume…" : "Refresh evidence"}</button><button className="primary-action small" onClick={onClose}>Save changes</button></div></div></ModalShell>;
}

function JobModal({ title, company, location, url, description, onTitle, onCompany, onLocation, onUrl, onDescription, onClose, onSubmit }: { title: string; company: string; location: string; url: string; description: string; onTitle: (value: string) => void; onCompany: (value: string) => void; onLocation: (value: string) => void; onUrl: (value: string) => void; onDescription: (value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell onClose={onClose} eyebrow="ADD A TARGET" title="Bring your own job brief."><p className="modal-copy">Paste a job description from a listing you trust. It stays visibly labeled as applicant-provided, and you retain the original URL for the final apply step.</p><form onSubmit={onSubmit}><div className="field-grid"><label>Role title<input required minLength={2} value={title} onChange={(event) => onTitle(event.target.value)} /></label><label>Company<input required minLength={2} value={company} onChange={(event) => onCompany(event.target.value)} /></label><label>Location<input value={location} onChange={(event) => onLocation(event.target.value)} /></label><label>Official listing URL <input type="url" value={url} onChange={(event) => onUrl(event.target.value)} placeholder="https://…" /></label></div><label>Job description<textarea required minLength={20} rows={9} value={description} onChange={(event) => onDescription(event.target.value)} placeholder="Paste the role, responsibilities, and requirements here…" /></label><div className="modal-actions"><button type="button" className="text-action" onClick={onClose}>Cancel</button><button className="primary-action small" type="submit">Add to shortlist <span>→</span></button></div></form></ModalShell>;
}

function LiveRolesModal({ onClose, onDiscover, onConnect }: { onClose: () => void; onDiscover: (query: string, source: "all" | "remotive" | "arbeitnow") => Promise<void>; onConnect: (source: "greenhouse" | "lever", board: string) => Promise<void> }) {
  const [query, setQuery] = useState("Python developer");
  const [feed, setFeed] = useState<"all" | "remotive" | "arbeitnow">("all");
  const [boardSource, setBoardSource] = useState<"greenhouse" | "lever">("greenhouse");
  const [board, setBoard] = useState("");
  const [busy, setBusy] = useState(false);
  async function find(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); try { await onDiscover(query, feed); } finally { setBusy(false); } }
  async function connect(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!board.trim()) return; setBusy(true); try { await onConnect(boardSource, board.trim()); } finally { setBusy(false); } }
  return <ModalShell onClose={onClose} eyebrow="LIVE ROLE SOURCES" title="Start from a published opening."><p className="modal-copy">HireSwarm reads public listings only. It never asks for employer credentials and never sends an application on your behalf.</p><section className="source-option"><div><span className="source-badge live">LIVE FEEDS</span><h3>Discover public remote roles</h3><p>Remotive and Arbeitnow are fetched only when you ask. Remotive results are cached for six hours to respect the public API&apos;s rate guidance.</p></div><form onSubmit={find}><div className="field-grid compact"><label>Search terms<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Python backend" /></label><label>Source<select value={feed} onChange={(event) => setFeed(event.target.value as "all" | "remotive" | "arbeitnow")}><option value="all">All public feeds</option><option value="remotive">Remotive</option><option value="arbeitnow">Arbeitnow</option></select></label></div><button className="outline-action" disabled={busy}>{busy ? "Checking…" : "Find live roles"} <span>↗</span></button></form></section><section className="source-option"><div><span className="source-badge official">OFFICIAL ATS BOARD</span><h3>Connect one company&apos;s public board</h3><p>Paste a public Greenhouse or Lever board URL/token. HireSwarm uses their read-only published postings API, then keeps the official apply link intact.</p></div><form onSubmit={connect}><div className="field-grid compact"><label>Board type<select value={boardSource} onChange={(event) => setBoardSource(event.target.value as "greenhouse" | "lever")}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option></select></label><label>Public board URL or token<input required value={board} onChange={(event) => setBoard(event.target.value)} placeholder={boardSource === "greenhouse" ? "boards.greenhouse.io/company" : "jobs.lever.co/company"} /></label></div><button className="primary-action small" disabled={busy}>{busy ? "Connecting…" : "Read published roles"} <span>→</span></button></form></section><p className="source-footnote">If a public source is unavailable, no lookalike fixture is shown. You can always paste the role directly.</p></ModalShell>;
}

function HowItWorksModal({ onClose, onOpenProfile, onOpenLive, onOpenManual }: { onClose: () => void; onOpenProfile: () => void; onOpenLive: () => void; onOpenManual: () => void }) {
  return <ModalShell onClose={onClose} eyebrow="REAL-WORLD TESTING" title="Use HireSwarm with your own application.">
    <p className="modal-copy">The opening screen includes a clearly labeled practice workspace so you can explore safely. For a real test, use your own CV and a role you trust. HireSwarm prepares evidence-bound material only; it never submits an application.</p>
    <ol className="testing-guide">
      <li><span>01</span><div><b>Import your CV</b><p>Choose a text-based PDF, DOCX, or TXT file. Review the extracted evidence notes before proceeding.</p><button className="text-action" onClick={onOpenProfile}>Open my profile →</button></div></li>
      <li><span>02</span><div><b>Bring in a real role</b><p>Use a public Remotive/Arbeitnow search, an official Greenhouse/Lever board, or paste a listing from a source you trust.</p><div className="guide-inline-actions"><button className="outline-action small" onClick={onOpenLive}>Find live roles</button><button className="outline-action small" onClick={onOpenManual}>Paste a listing</button></div></div></li>
      <li><span>03</span><div><b>Run the rehearsal</b><p>Check the direct strengths, adjacent experience, and visible gaps. A gap stays a gap; it is never rewritten as experience.</p></div></li>
      <li><span>04</span><div><b>Approve only what sounds true</b><p>Review literal revisions and document QA. Export unlocks only after your explicit approval; you apply yourself on the official site.</p></div></li>
    </ol>
    <div className="guide-boundary"><span>✓</span><p><b>Safe test rule:</b> Start with a copied job description and a non-sensitive CV version. Do not paste credentials, national ID details, or private employer information.</p></div>
    <div className="modal-actions"><span className="guide-status">No automatic applications. No hidden claims.</span><button className="primary-action small" onClick={onClose}>Got it — open workspace</button></div>
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

function NavGlyph({ type }: { type: "grid" | "briefcase" | "chat" | "document" }) {
  if (type === "grid") return <svg viewBox="0 0 18 18"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="11" y="2" width="5" height="5" rx="1"/><rect x="2" y="11" width="5" height="5" rx="1"/><rect x="11" y="11" width="5" height="5" rx="1"/></svg>;
  if (type === "briefcase") return <svg viewBox="0 0 18 18"><rect x="2" y="5" width="14" height="10" rx="2"/><path d="M6 5V3.8c0-.7.5-1.3 1.2-1.3h3.6c.7 0 1.2.6 1.2 1.3V5M2 9h14M7.5 9v2h3V9"/></svg>;
  if (type === "chat") return <svg viewBox="0 0 18 18"><path d="M3 3.5h12v8H8l-3.7 3V11.5H3z"/><path d="M6 6.8h6M6 9h3.5"/></svg>;
  return <svg viewBox="0 0 18 18"><path d="M5 2.5h6l2.5 2.5v10.5H5z"/><path d="M11 2.5V5h2.5M7 8h4M7 10.5h4M7 13h2.5"/></svg>;
}
