"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

type Origin = "demo_fixture" | "public_cache" | "user_pasted";
type WorkspaceView = "match" | "rehearse" | "tailor" | "review";
type RunMode = "evidence_lab" | "crewai";
type RunState = "idle" | "running" | "needs_evidence" | "awaiting_approval" | "approved" | "failed";
type NavigationSection = "workspace" | "applications" | "practice" | "documents";

type Evidence = { evidence_id: string; source_section: string; source_text: string; skills: string[]; metric?: string; status: "verified" | "partial" | "unverified" };
type Candidate = { name: string; headline: string; location: string; preferences: string[]; resume_text: string; evidence: Evidence[] };
// Live discovery intentionally returns this compact shape first. Full role text
// is requested only after the applicant reviews a listing.
type Job = { id: string; origin: Origin; source: string; title: string; company: string; location: string; type: string; salary?: string; posted: string; retrieved_at?: string | null; cache_state?: string; url: string; skills?: string[]; description?: string; must_have?: string[]; preferred?: string[]; detail_loaded?: boolean };
type SwarmEvent = { type: string; agent?: string | null; title: string; message?: string | null; payload: Record<string, unknown>; at?: string | null };
type Patch = { section: string; original: string; proposed: string; evidence_ids: string[]; covered_requirements: string[]; status: string; reason: string };
type Turn = { round: number; requirement: string; question?: string; answer?: string; status?: string; evidence_ids?: string[]; verdict?: string };
type MarketReport = { score: number; coverage: number; verified_strengths: { skill: string; evidence_ids: string[]; preferred?: boolean }[]; adjacent_strengths: { skill: string; evidence_ids: string[]; reason: string; preferred?: boolean }[]; gaps: { skill: string; severity: string }[] };
type ExportCheck = { label: string; passed: boolean; detail: string };
type ExportReadiness = { passed: boolean; checks: ExportCheck[]; extracted_characters: number; verified_bullets: number };
type SourceResponse = { mode: string; jobs: Job[]; provenance?: { label?: string; retrieved_at?: string | null; cache_state?: string; polling_policy?: string; board?: string }; source_errors?: string[] };
type ImportInfo = { filename: string; format: string; characters_read: number; evidence_count: number; retention: string };
type RunCheckpoint = { id: string; status: string; selected_job_id: string; mode: "evidence_lab" | "crewai"; event_count: number; job?: Job | null };

// Undefined keeps local Next.js rewrite behaviour. An explicitly empty value is
// used by the Railway all-in-one image so API requests stay on the same origin.
const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE;
const API = configuredApiBase === undefined ? "/backend" : configuredApiBase.replace(/\/+$/, "");
const RUN_STORAGE_KEY = "hireswarm.activeRunId";
type ServiceStatus = "checking" | "online" | "offline";
type ServiceHealth = { ok?: boolean; service?: string; mode?: string; optional_crewai?: boolean };

// React development effects and impatient repeat clicks should not multiply
// safe GET work. This browser-session cache complements server caching without
// ever caching mutations, exports, approval, or applicant uploads.
const GET_RESPONSE_CACHE = new Map<string, { expiresAt: number; value: unknown }>();
const GET_IN_FLIGHT = new Map<string, Promise<unknown>>();

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

function cachedGet<T>(url: string, ttlMs: number): Promise<T> {
  const timestamp = Date.now();
  const cached = GET_RESPONSE_CACHE.get(url);
  if (cached && cached.expiresAt > timestamp) return Promise.resolve(cached.value as T);
  const active = GET_IN_FLIGHT.get(url);
  if (active) return active as Promise<T>;
  const request = requestJson<T>(url).then((value) => {
    GET_RESPONSE_CACHE.set(url, { value, expiresAt: ttlMs === Infinity ? Infinity : Date.now() + ttlMs });
    return value;
  });
  GET_IN_FLIGHT.set(url, request);
  void request.then(() => GET_IN_FLIGHT.delete(url), () => GET_IN_FLIGHT.delete(url));
  return request;
}

// React.lazy keeps these feature modules out of the initial client request.
// They are mounted only after an intentional modal/view transition (or after
// the lightweight demo bootstrap has finished for the below-fold match panel).
const CandidateModal = lazy(() => import("./components/DeferredModals").then((module) => ({ default: module.CandidateModal })));
const JobModal = lazy(() => import("./components/DeferredModals").then((module) => ({ default: module.JobModal })));
const LiveRolesModal = lazy(() => import("./components/DeferredModals").then((module) => ({ default: module.LiveRolesModal })));
const HowItWorksModal = lazy(() => import("./components/DeferredModals").then((module) => ({ default: module.HowItWorksModal })));
const DeferredMatchPanel = lazy(() => import("./components/DeferredWorkspacePanels").then((module) => ({ default: module.MatchPanel })));
const DeferredRehearsalPanel = lazy(() => import("./components/DeferredWorkspacePanels").then((module) => ({ default: module.RehearsalPanel })));
const DeferredTailorPanel = lazy(() => import("./components/DeferredWorkspacePanels").then((module) => ({ default: module.TailorPanel })));
const DeferredReviewPanel = lazy(() => import("./components/DeferredWorkspacePanels").then((module) => ({ default: module.ReviewPanel })));
const DeferredActivityStream = lazy(() => import("./components/DeferredActivityStream").then((module) => ({ default: module.DeferredActivityStream })));

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
  { id: "match", label: "Match", number: "01", hint: "See how your experience fits" },
  { id: "rehearse", label: "Practice", number: "02", hint: "Prepare answers from real work" },
  { id: "tailor", label: "Tailor", number: "03", hint: "Improve your CV and story" },
  { id: "review", label: "Review", number: "04", hint: "Approve before export" },
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
const sourceLabel = (origin: Origin) => origin === "public_cache" ? "Live public listing" : origin === "user_pasted" ? "Pasted by you" : "Demo role";
const retrievalLabel = (value?: string | null) => value ? value.replace("T", " ").replace(/\.\d+\+00:00$/, " UTC").replace("+00:00", " UTC") : "time not recorded";
const sourceDetail = (job?: Job) => {
  if (!job || job.origin === "demo_fixture") return "Demo role — choose a live listing or paste your own job brief for a real target.";
  if (job.origin === "user_pasted") return `Applicant-provided role · added ${retrievalLabel(job.retrieved_at)}`;
  return `Source: ${job.source} · ${job.cache_state === "cached" ? "cached" : "retrieved"} ${retrievalLabel(job.retrieved_at)}`;
};
const roleSkills = (job?: Job) => job?.must_have?.length ? job.must_have : job?.skills || [];
const hasRoleDetail = (job?: Job) => Boolean(job?.detail_loaded || job?.description || job?.must_have?.length);

function apiRunMode(engine: RunMode): "evidence_lab" | "crewai" {
  // The API deliberately supports only these two modes. Keep this explicit so
  // no presentation label can leak into a backend request.
  return engine === "crewai" ? "crewai" : "evidence_lab";
}

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>(fallbackJobs);
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(fallbackJobs[0].id);
  const [candidate, setCandidate] = useState<Candidate>(fallbackCandidate);
  // The initial profile is intentionally useful, but it must never be mistaken
  // for applicant data. This flips as soon as someone imports or edits a CV.
  const [usingDemoProfile, setUsingDemoProfile] = useState(true);
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
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isExporting, setIsExporting] = useState<"docx" | "pdf" | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const jobDetailCacheRef = useRef(new Map<string, Job>());
  const jobDetailRequestRef = useRef(new Map<string, Promise<Job>>());
  const runLockRef = useRef(false);
  const approvalLockRef = useRef(false);
  const exportLockRef = useRef(false);
  const shortlistRef = useRef<HTMLElement | null>(null);
  const workspacePanelRef = useRef<HTMLElement | null>(null);

  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedJobId) ?? jobs[0], [jobs, selectedJobId]);
  const selectedIsPractice = selectedJob?.origin === "demo_fixture";
  const inDemoWorkspace = usingDemoProfile || Boolean(selectedIsPractice);
  const visibleJobs = showAllJobs ? jobs : jobs.slice(0, 3);
  const coverage = coverageAfter ?? market?.coverage ?? 0;
  const directMatches = market?.verified_strengths.length ?? 0;
  const currentTurn = turns[turns.length - 1];
  const evidencePreviewSkills = Array.from(new Set(candidate.evidence.flatMap((item) => item.skills))).slice(0, 3);
  const proofItem = candidate.evidence.find((item) => item.metric) || candidate.evidence[0];
  const candidateFirstName = candidate.name.trim().split(/\s+/)[0] || "there";
  const serviceOnline = serviceStatus === "online";
  const crewaiAvailable = Boolean(serviceHealth?.optional_crewai);
  const runIsActive = runState === "running";
  const serviceCopy = serviceStatus === "online" ? "Service connected" : serviceStatus === "checking" ? "Checking connection" : "Service unavailable";

  async function checkService(showSuccess = false) {
    setServiceStatus("checking");
    try {
      const health = await requestJson<ServiceHealth>(`${API}/healthz`);
      if (!health.ok) throw new Error("The workspace service did not confirm that it is ready.");
      setServiceHealth(health);
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
        cachedGet<{ jobs: Job[] }>(`${API}/api/jobs?mode=demo`, Infinity),
        cachedGet<Candidate>(`${API}/api/candidate/demo`, Infinity),
        cachedGet<ServiceHealth>(`${API}/healthz`, 15_000),
      ]);
      const jobsLoaded = jobsResult.status === "fulfilled";
      const candidateLoaded = candidateResult.status === "fulfilled";
      if (jobsLoaded && jobsResult.value.jobs.length) {
        setJobs(jobsResult.value.jobs);
        setSelectedJobId((previous) => previous || jobsResult.value.jobs[0].id);
      }
      if (candidateLoaded && candidateResult.value.evidence.length) setCandidate(candidateResult.value);
      if (healthResult.status === "fulfilled" && healthResult.value.ok && (jobsLoaded || candidateLoaded)) {
        setServiceHealth(healthResult.value);
        setServiceStatus("online");
      } else {
        setServiceStatus("offline");
        // The persistent, labeled degraded-state banner carries this message.
        // Avoid duplicating it in the transient notice area where it can be
        // visually clipped by the command header on smaller viewports.
        setNotice(null);
      }
      setIsBootstrapping(false);
    }
    void bootstrap();
    return () => streamRef.current?.close();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restoreSavedRun() {
      const savedRunId = window.sessionStorage.getItem(RUN_STORAGE_KEY);
      if (!savedRunId) return;
      // Lock mutable actions immediately while we verify the server checkpoint.
      runLockRef.current = true;
      setRunState("running");
      setActiveAgent("Restoring your saved rehearsal");
      try {
        const checkpoint = await requestJson<RunCheckpoint>(`${API}/api/runs/${encodeURIComponent(savedRunId)}`);
        if (cancelled) return;
        const restoredState: RunState = checkpoint.status === "queued" || checkpoint.status === "running"
          ? "running"
          : checkpoint.status === "needs_evidence" || checkpoint.status === "awaiting_approval" || checkpoint.status === "approved" || checkpoint.status === "failed"
            ? checkpoint.status
            : "failed";
        setRunId(checkpoint.id);
        setRunState(restoredState);
        runLockRef.current = restoredState === "running";
        setActiveAgent(restoredState === "running" ? "Resuming your evidence rehearsal" : "Restoring your saved review");
        if (checkpoint.job) {
          const restoredJob = checkpoint.job;
          setJobs((previous) => [restoredJob, ...previous.filter((job) => job.id !== restoredJob.id)]);
        }
        if (checkpoint.selected_job_id) setSelectedJobId(checkpoint.selected_job_id);
        attachRunStream(checkpoint.id, true);
      } catch {
        if (cancelled) return;
        window.sessionStorage.removeItem(RUN_STORAGE_KEY);
        runLockRef.current = false;
        setRunState("failed");
        setNotice("The saved rehearsal is no longer available after a service restart. Nothing was approved or exported.");
      }
    }
    void restoreSavedRun();
    return () => { cancelled = true; streamRef.current?.close(); };
  }, []);

  useEffect(() => {
    const route = routeState(pathname);
    setActiveNavigation(route.section);
    setView(route.view);
  }, [pathname]);

  function resetRun(nextView: WorkspaceView = "match") {
    streamRef.current?.close(); runLockRef.current = false; window.sessionStorage.removeItem(RUN_STORAGE_KEY); setRunId(null); setRunState("idle"); setMarket(null); setTurns([]); setPatches([]); setCoverageAfter(null); setCoverLetter(""); setCoverLetterEvidenceIds([]); setExportReadiness(null); setEvents([]); setActiveAgent("Ready when you are"); setShowCoverLetter(false); setView(nextView);
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
    if (mode === "crewai" && !crewaiAvailable) {
      setShowEngineMenu(false);
      setRunMode("evidence_lab");
      setNotice("CrewAI is not configured on this workspace. Evidence Lab will run instead, with the same evidence and approval safeguards.");
      return;
    }
    setRunMode(mode);
    setShowEngineMenu(false);
    setNotice(mode === "crewai"
      ? "CrewAI is available for this run. Evidence Lab still governs claim checks and export approval."
      : "Evidence Lab is selected. Its deterministic evidence checks control every claim and export.");
  }

  function explainServiceUnavailable() {
    setNotice("The live workspace API is unavailable. Demo fixtures are visible only for orientation; imports, live role discovery, rehearsals, approval, and exports are paused until the service reconnects.");
  }

  function explainRunActive() {
    setNotice("A rehearsal is still active. Wait for its evidence review before changing the target, profile evidence, or export state.");
  }

  function startFromHero() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (usingDemoProfile) {
      setShowIntake(true);
      setNotice("Start with your CV so every fit check and answer is based on your own experience.");
      return;
    }
    if (selectedIsPractice) {
      setShowLiveFinder(true);
      setNotice("Choose a live public role or paste your own job brief before checking a real fit.");
      return;
    }
    void startRehearsal();
  }

  function startSampleFitCheck() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (!selectedIsPractice) return startFromHero();
    setNotice(usingDemoProfile
      ? "This is a safe demo using sample data. Nothing is submitted."
      : "This is a safe demo using a sample role. Nothing is submitted.");
    void startRehearsal();
  }

  function openBlankJobForm() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (runIsActive) return explainRunActive();
    setManualTitle(""); setManualCompany(""); setManualLocation(""); setManualUrl(""); setManualDescription("");
    setShowJobForm(true);
  }

  async function loadJobDetail(jobId: string): Promise<Job | null> {
    const current = jobs.find((job) => job.id === jobId);
    if (hasRoleDetail(current)) return current || null;
    const cached = jobDetailCacheRef.current.get(jobId);
    if (cached) return cached;

    let pending = jobDetailRequestRef.current.get(jobId);
    if (!pending) {
      pending = requestJson<Job>(`${API}/api/jobs/${encodeURIComponent(jobId)}`);
      jobDetailRequestRef.current.set(jobId, pending);
      void pending.then(() => jobDetailRequestRef.current.delete(jobId), () => jobDetailRequestRef.current.delete(jobId));
    }
    setLoadingJobId(jobId);
    try {
      const detail = await pending;
      jobDetailCacheRef.current.set(jobId, detail);
      setJobs((previous) => previous.map((job) => job.id === jobId ? { ...job, ...detail, detail_loaded: true } : job));
      setServiceStatus("online");
      return detail;
    } catch (error) {
      reportActionError(error, "That role detail could not be loaded. Search again or paste the listing.");
      return null;
    } finally {
      setLoadingJobId((active) => active === jobId ? null : active);
    }
  }

  function selectRole(jobId: string) {
    if (runIsActive) return explainRunActive();
    setSelectedJobId(jobId);
    setActiveNavigation("applications");
    resetRun("match");
    // Live card payloads deliberately omit long descriptions. This is the
    // explicit review action that starts one deduplicated detail request.
    void loadJobDetail(jobId);
  }

  async function adaptSelectedJob() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (runIsActive) return explainRunActive();
    if (!selectedJob) return openBlankJobForm();
    const job = hasRoleDetail(selectedJob) ? selectedJob : await loadJobDetail(selectedJob.id);
    if (!job) return;
    setManualTitle(job.title); setManualCompany(job.company); setManualLocation(job.location);
    // Example links used by practice fixtures must not be relabeled as an official listing.
    setManualUrl(job.origin === "demo_fixture" ? "" : job.url);
    setManualDescription(job.description || ""); setShowJobForm(true);
  }

  function openOfficialListing(url?: string) {
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error("unsupported protocol");
      const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
      if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || /^(?:127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/.test(host)) throw new Error("local host");
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
    if (event.type === "evidence_needed") { runLockRef.current = false; setRunState("needs_evidence"); setActiveAgent("More direct evidence is needed"); setNotice(event.message || "Add source-linked evidence or choose a better-matched role before exporting."); setView("match"); }
    if (event.type === "approval_required") { runLockRef.current = false; setRunState("awaiting_approval"); if (pathname === "/" || pathname === "/workspace") setActiveNavigation("documents"); setActiveAgent("Your review is needed"); setView("review"); }
    if (event.type === "approved") { runLockRef.current = false; setRunState("approved"); if (pathname === "/" || pathname === "/workspace") setActiveNavigation("documents"); setActiveAgent("Application packet approved"); setView("review"); }
    if (event.type === "run_failed") { runLockRef.current = false; setRunState("failed"); setNotice(event.message || "The rehearsal could not finish. Please try again."); }
  }

  function reportActionError(error: unknown, fallback: string) {
    const message = error instanceof Error && error.message ? error.message : fallback;
    if (/could not reach|HTML error page|unreadable service response|empty response|API route is missing|workspace API is unavailable/i.test(message)) setServiceStatus("offline");
    setNotice(message);
  }

  function attachRunStream(id: string, restoring = false) {
    streamRef.current?.close();
    const source = new EventSource(`${API}/api/runs/${id}/events`);
    streamRef.current = source;
    let reachedTerminalEvent = false;
    source.onmessage = (message) => {
      try { receiveEvent(JSON.parse(message.data) as SwarmEvent); }
      catch { setNotice("One rehearsal update could not be read. The rest of the run is still continuing."); }
    };
    source.addEventListener("done", () => {
      reachedTerminalEvent = true;
      runLockRef.current = false;
      window.setTimeout(() => source.close(), 120);
    });
    source.onerror = () => {
      source.close();
      if (!reachedTerminalEvent) {
        runLockRef.current = false;
        setRunState("failed");
        if (restoring) {
          window.sessionStorage.removeItem(RUN_STORAGE_KEY);
          setNotice("The saved rehearsal could not be resumed. Its local run record is no longer available, and no export was made.");
        } else {
          setServiceStatus("offline");
          setNotice("The rehearsal stream disconnected before it finished. Nothing was exported — retry when the workspace connection is back.");
        }
      }
    };
  }

  async function startRehearsal() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (!selectedJob || runIsActive || runLockRef.current) return;
    // A live search card is intentionally only a compact summary. Ensure the
    // applicant has explicitly loaded its source text before evidence work.
    const targetJob = hasRoleDetail(selectedJob) ? selectedJob : await loadJobDetail(selectedJob.id);
    if (!targetJob) return;
    if (runMode === "crewai" && !crewaiAvailable) {
      setRunMode("evidence_lab");
      setNotice("CrewAI is unavailable on this workspace, so this rehearsal will use Evidence Lab.");
    }
    resetRun("rehearse");
    runLockRef.current = true;
    setActiveNavigation("practice");
    scrollToWorkspacePanel();
    setRunState("running");
    setActiveAgent("Preparing your application brief");
    try {
      const data = await requestJson<{ run_id?: string; detail?: string }>(`${API}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: targetJob.id, candidate, mode: apiRunMode(runMode === "crewai" && !crewaiAvailable ? "evidence_lab" : runMode) }),
      });
      if (!data.run_id) throw new Error(data.detail || "The workspace could not start this rehearsal.");
      setServiceStatus("online");
      setRunId(data.run_id);
      window.sessionStorage.setItem(RUN_STORAGE_KEY, data.run_id);
      attachRunStream(data.run_id);
    } catch (error) {
      runLockRef.current = false;
      setRunState("failed");
      reportActionError(error, "The rehearsal could not start.");
    }
  }

  async function approvePacket() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (!runId || runIsActive || runState !== "awaiting_approval" || approvalLockRef.current) return;
    approvalLockRef.current = true;
    setIsApproving(true);
    try {
      await requestJson<Record<string, unknown>>(`${API}/api/runs/${runId}/approve`, { method: "POST" });
      setServiceStatus("online");
      setRunState("approved");
      setActiveAgent("Application packet approved");
      setEvents((previous) => previous.some((event) => event.type === "approved") ? previous : [{ type: "approved", agent: "You", title: "You approved the application packet", message: "Export is now unlocked. Submission remains in your control.", payload: {} }, ...previous]);
    } catch (error) { reportActionError(error, "Approval could not be saved."); }
    finally { approvalLockRef.current = false; setIsApproving(false); }
  }

  async function exportPacket(format: "docx" | "pdf") {
    if (!serviceOnline) return explainServiceUnavailable();
    if (!runId || runIsActive || runState !== "approved" || exportLockRef.current) return;
    exportLockRef.current = true;
    setIsExporting(format);
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
    finally { exportLockRef.current = false; setIsExporting(null); }
  }

  function mergeJobs(incoming: Job[], chooseFirst = true) {
    if (runLockRef.current) { explainRunActive(); return; }
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
    if (runIsActive) return explainRunActive();
    if (manualTitle.trim().length < 2 || manualCompany.trim().length < 2 || manualDescription.trim().length < 20) {
      setNotice("Add a role title, company, and at least a short role description before creating a target.");
      return;
    }
    if (manualUrl.trim()) {
      try {
        const parsed = new URL(manualUrl.trim());
        if (parsed.protocol !== "https:") throw new Error("not HTTPS");
      } catch {
        setNotice("Use a public HTTPS link for the official listing, or leave the optional link blank. HireSwarm never opens private or local URLs.");
        return;
      }
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
    if (runIsActive) return explainRunActive();
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) {
      setNotice("Enter at least 2 characters for a live-role search, for example “Python” or “product designer”.");
      return;
    }
    try {
      const data = await cachedGet<SourceResponse>(`${API}/api/jobs/live?query=${encodeURIComponent(cleanQuery)}&source=${source}`, 5 * 60_000);
      setServiceStatus("online");
      if (!data.jobs.length) throw new Error(data.source_errors?.[0] || "No current public roles matched. No fixture was substituted.");
      const boundedJobs = data.jobs.slice(0, 12);
      mergeJobs(boundedJobs);
      setShowLiveFinder(false);
      const cacheNote = data.provenance?.cache_state === "cached" ? "cached public feed" : "fresh public feed";
      setNotice(`Added ${boundedJobs.length} roles from a ${cacheNote}. Each listing keeps its direct source link.`);
    } catch (error) { reportActionError(error, "Live roles could not be loaded. You can paste a role instead."); }
  }

  async function connectPublicBoard(source: "greenhouse" | "lever", board: string) {
    if (!serviceOnline) return explainServiceUnavailable();
    if (runIsActive) return explainRunActive();
    try {
      const data = await requestJson<SourceResponse>(`${API}/api/jobs/public-board`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, board }),
      });
      setServiceStatus("online");
      if (!data.jobs.length) throw new Error("That public board did not return any available roles. You can paste one listing instead.");
      const boundedJobs = data.jobs.slice(0, 12);
      mergeJobs(boundedJobs);
      setShowLiveFinder(false);
      setNotice(`Added ${boundedJobs.length} published role${boundedJobs.length === 1 ? "" : "s"} from the official ${source === "greenhouse" ? "Greenhouse" : "Lever"} board. HireSwarm only reads listings; you apply on the official site.`);
    } catch (error) { reportActionError(error, "The public board could not be read."); }
  }

  async function importResume(file: File) {
    if (!serviceOnline) return explainServiceUnavailable();
    if (runIsActive) return explainRunActive();
    setIsImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await requestJson<{ candidate?: Candidate; import?: ImportInfo; detail?: string }>(`${API}/api/candidate/upload`, { method: "POST", body: form });
      if (!data.candidate) throw new Error(data.detail || "That document could not be read.");
      setServiceStatus("online");
      setCandidate(data.candidate);
      setUsingDemoProfile(false);
      resetRun("match");
      setNotice(`Imported ${data.import?.filename || "your CV"}: ${data.import?.evidence_count || data.candidate.evidence.length} evidence items to review. ${data.import?.retention || ""}`);
    } catch (error) { reportActionError(error, "That document could not be read."); }
    finally { setIsImporting(false); }
  }

  async function analyzeResume() {
    if (!serviceOnline) return explainServiceUnavailable();
    if (runIsActive) return explainRunActive();
    setIsAnalyzing(true);
    try {
      const data = await requestJson<Candidate | { detail?: string }>(`${API}/api/candidate/normalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate),
      });
      if (!("evidence" in data)) throw new Error(data.detail || "We could not build an evidence list from this CV.");
      setServiceStatus("online");
      setCandidate(data);
      // A refresh alone must not relabel the untouched sample profile as the
      // applicant's own CV. Editing resume_text or importing a file does that.
      resetRun("match");
      setNotice("Your evidence list was refreshed from the CV text. Review it before running a practice session.");
    } catch (error) { reportActionError(error, "Resume analysis did not complete."); }
    finally { setIsAnalyzing(false); }
  }

  function updateCandidate(field: keyof Candidate, value: string) {
    setCandidate((previous) => field === "resume_text"
      ? { ...previous, resume_text: value, evidence: [] }
      : { ...previous, [field]: value });
    // Name/headline edits do not turn sample evidence into applicant evidence.
    // Only a new CV text (or a file import) begins a real profile.
    if (field === "resume_text") {
      setUsingDemoProfile(false);
      setNotice("CV text changed. Refresh your evidence list before running a practice session.");
    }
  }

  return <main className="workspace-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="mark">h.</div><span>hire<span>swarm</span></span></div>
      <nav className="primary-nav" aria-label="Workspace navigation">
        <Link prefetch={false} href="/workspace" className={cx("nav-item", activeNavigation === "workspace" && "active")} onClick={(event) => { event.preventDefault(); navigate("workspace"); }}><NavGlyph type="grid" />Workspace</Link>
        <Link prefetch={false} href="/applications" className={cx("nav-item", activeNavigation === "applications" && "active")} onClick={(event) => { event.preventDefault(); navigate("applications"); }}><NavGlyph type="briefcase" />Applications <small>{jobs.length}</small></Link>
        <Link prefetch={false} href="/practice" className={cx("nav-item", activeNavigation === "practice" && "active")} onClick={(event) => { event.preventDefault(); navigate("practice"); }}><NavGlyph type="chat" />Practice</Link>
        <Link prefetch={false} href="/documents" className={cx("nav-item", activeNavigation === "documents" && "active")} onClick={(event) => { event.preventDefault(); navigate("documents"); }}><NavGlyph type="document" />Documents</Link>
      </nav>
      <div className="sidebar-spacer" />
      <section className={cx("candidate-card", usingDemoProfile && "is-demo")}><div className="candidate-avatar">{initials(candidate.name)}</div><div className="candidate-card-copy"><small>{usingDemoProfile ? "SAMPLE PROFILE" : "YOUR PROFILE"}</small><b>{candidate.name}</b><span>{usingDemoProfile ? "Demo data only" : candidate.location}</span></div><button onClick={() => setShowIntake(true)} aria-label="Edit candidate profile">⋯</button></section>
      <div className="sidebar-note"><span /> <p><b>Evidence</b> is a real CV or work example that supports a skill or claim.</p></div>
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
              <span className="command-icon engine-symbol">✦</span><span className="mobile-command-label">Method</span><span className="command-copy"><b>{runMode === "crewai" ? "CrewAI relay" : "Evidence Lab"}</b><small>How evidence is checked</small></span><span className="chevron">⌄</span>
            </button>
            {showEngineMenu && <div className="engine-menu" role="menu" aria-label="Choose workflow engine">
              <p className="menu-overline">EVIDENCE CHECK METHOD</p>
              <button role="menuitem" className={cx(runMode === "evidence_lab" && "selected")} onClick={() => chooseEngine("evidence_lab")}><span className="engine-menu-symbol">✓</span><span><b>Evidence Lab</b><small>Consistent evidence checks · default</small></span>{runMode === "evidence_lab" && <i>Selected</i>}</button>
              <button role="menuitem" className={cx(runMode === "crewai" && "selected")} onClick={() => chooseEngine("crewai")} disabled={!crewaiAvailable} aria-disabled={!crewaiAvailable}><span className="engine-menu-symbol">✦</span><span><b>CrewAI relay</b><small>{crewaiAvailable ? "Free-provider narration available" : "Unavailable here · Evidence Lab will run"}</small></span>{runMode === "crewai" && crewaiAvailable && <i>Selected</i>}</button>
              {!crewaiAvailable && <p className="engine-unavailable" role="note">CrewAI is not configured on this deployment. No provider-backed agent run will be claimed; use Evidence Lab.</p>}
            </div>}
          </div>
          <button className="command-action guide-action" onClick={() => setShowGuide(true)} aria-label="Open how HireSwarm works guide"><span className="command-icon">?</span><span className="mobile-command-label">Guide</span><span className="command-copy"><b>Guide</b><small>See the path</small></span></button>
          <button className="command-action find-action" onClick={() => serviceOnline ? setShowLiveFinder(true) : explainServiceUnavailable()} aria-label="Find public roles" disabled={!serviceOnline || runIsActive} aria-disabled={!serviceOnline || runIsActive}><span className="command-icon">⌕</span><span className="mobile-command-label">Roles</span><span className="command-copy"><b>Find roles</b><small>{serviceOnline ? "Public sources" : "API paused"}</small></span></button>
          <button className="command-action paste-action" onClick={openBlankJobForm} aria-label="Paste a job listing" disabled={!serviceOnline || runIsActive}><span className="command-icon">+</span><span className="mobile-command-label">Paste</span><span className="command-copy"><b>Paste role</b><small>Add your listing</small></span></button>
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
        {inDemoWorkspace && <section className="demo-workspace-banner" role="note" aria-labelledby="demo-workspace-title">
          <div className="demo-banner-mark" aria-hidden="true">◎</div>
          <div><p>DEMO WORKSPACE</p><h2 id="demo-workspace-title">You are viewing sample data, not an application in progress.</h2><span>{usingDemoProfile ? "Ayesha, Atlas Labs, and every item marked Demo are examples for safe exploration — not your data. Import your CV before a real fit check; nothing is submitted." : "This selected role is a sample for safe exploration. Your CV remains yours, and nothing is submitted."}</span></div>
          <button className="outline-action small" onClick={() => usingDemoProfile ? setShowIntake(true) : serviceOnline ? setShowLiveFinder(true) : explainServiceUnavailable()}>{usingDemoProfile ? "Start with my CV" : "Choose a real role"} <span>→</span></button>
        </section>}
        <section className="command-hero" aria-labelledby="workspace-title">
          <div className="command-hero-copy">
            <div className="hero-overline"><span className={cx("data-state", inDemoWorkspace && "practice")}>{inDemoWorkspace ? "DEMO WORKSPACE" : "YOUR WORKSPACE"}</span><span>APPLICANT-CONTROLLED · NO AUTO-APPLY</span></div>
            <h1 id="workspace-title">Make your real work <em>impossible to miss.</em></h1>
            <p className="command-hero-lede">{usingDemoProfile ? "Start with your CV. Then choose a role, check the fit, practice your answers, tailor your materials, and review everything before export." : selectedIsPractice ? "Your CV is ready. Choose a real role to check a real fit, then practice, tailor, and review on your terms." : `Hi ${candidateFirstName}. Your CV and selected role are ready for an evidence-based fit check — with no invented claims.`}</p>
            <div className="hero-cta-row">
              <button className="hero-primary" disabled={runState === "running" || !serviceOnline} onClick={startFromHero} aria-describedby={!serviceOnline ? "service-outage-title" : undefined}><span className="hero-primary-icon">{runState === "running" ? "···" : usingDemoProfile ? "↑" : selectedIsPractice ? "↗" : "✓"}</span><span><b>{runState === "running" ? "Practice in progress" : usingDemoProfile ? "Start with my CV" : selectedIsPractice ? "Choose a real role" : "Check my fit"}</b><small>{runState === "running" ? "Wait for the current review to finish" : usingDemoProfile ? "Import a PDF, DOCX, TXT, or paste text" : selectedIsPractice ? "Find a public role or use your listing" : "Assess this role against your evidence"}</small></span></button>
              <button className="hero-secondary" onClick={openBlankJobForm} disabled={!serviceOnline || runIsActive}><span>OR</span><span><b>I already have a job/listing</b><small>Paste it directly and keep its official link</small></span><i>→</i></button>
            </div>
            <div className="hero-stat-row" aria-label={`${candidate.evidence.length} ${usingDemoProfile ? "sample" : "CV"} evidence items, ${selectedIsPractice ? "sample target" : "selected role"}, and applicant approval required`}>
              <div><b>{candidate.evidence.length}</b><span>{usingDemoProfile ? "sample work examples" : "CV evidence"}</span></div><div><b>{selectedIsPractice ? "Sample" : "Selected"}</b><span>{selectedIsPractice ? "role for practice" : "role to assess"}</span></div><div><b>100%</b><span>your final approval</span></div>
            </div>
          </div>
          <HeroScene candidateName={candidateFirstName} evidenceCount={candidate.evidence.length} job={selectedJob} score={market?.score ?? null} serviceStatus={serviceStatus} />
        </section>
        <section className="launchpad-card onboarding-card" aria-labelledby="launchpad-title">
          <div className="launchpad-intro"><p className="section-kicker">YOUR FIRST APPLICATION</p><h2 id="launchpad-title">A clear path from CV<br />to applicant-approved export.</h2><p>Start with your own CV. Every later step stays tied to evidence you can verify and review.</p></div>
          <div className="launchpad-paths">
            <button className="launch-path cv-path" onClick={() => serviceOnline ? setShowIntake(true) : explainServiceUnavailable()} disabled={!serviceOnline || runIsActive} aria-disabled={!serviceOnline || runIsActive}><span className="path-top"><i>01</i><em>CV</em></span><b>Start with my CV</b><small>Import or paste your real experience</small><span className="path-arrow">→</span></button>
            <button className="launch-path source-path" onClick={() => serviceOnline ? setShowLiveFinder(true) : explainServiceUnavailable()} disabled={!serviceOnline || runIsActive} aria-disabled={!serviceOnline || runIsActive}><span className="path-top"><i>02</i><em>↗</em></span><b>Choose a role</b><small>Find a public opening or paste a listing</small><span className="path-arrow">→</span></button>
            <button className="launch-path paste-path" onClick={() => selectedIsPractice ? startSampleFitCheck() : startFromHero()} disabled={!serviceOnline || runIsActive} aria-disabled={!serviceOnline || runIsActive}><span className="path-top"><i>03</i><em>✓</em></span><b>{selectedIsPractice ? "Try a sample fit check" : usingDemoProfile ? "Import CV to assess fit" : "Check the fit"}</b><small>{selectedIsPractice ? "Safe demo data — nothing is submitted" : usingDemoProfile ? "A real fit check needs your own CV" : "See direct evidence and honest gaps"}</small><span className="path-arrow">→</span></button>
            <button className="launch-path practice-path" onClick={() => setShowGuide(true)} disabled={runIsActive} aria-disabled={runIsActive}><span className="path-top"><i>04</i><em>◎</em></span><b>Practice, tailor &amp; review</b><small>Approve your packet before any export</small><span className="path-arrow">→</span></button>
          </div>
        </section>
        <section className="outcomes-card" aria-labelledby="outcomes-title">
          <div><p className="section-kicker">WHAT YOU WILL GET</p><h2 id="outcomes-title">A clearer, applicant-controlled case for one role.</h2><p>HireSwarm helps you prepare; it never applies or submits for you.</p></div>
          <ul><li><span>01</span><p><b>Fit report</b><small>Direct matches, related experience, and visible gaps.</small></p></li><li><span>02</span><p><b>Evidence-backed answers</b><small>Answers grounded in your real CV and work examples.</small></p></li><li><span>03</span><p><b>Role-based practice</b><small>Questions that focus on this specific opening.</small></p></li><li><span>04</span><p><b>Approved packet</b><small>A tailored export only after your review and approval.</small></p></li></ul>
        </section>
        {isBootstrapping ? <InitialWorkspaceSkeleton /> : <>
        <section className="progress-nav" aria-label="Application workflow">{views.map((item, index) => { const done = (item.id === "match" && Boolean(market)) || (item.id === "rehearse" && turns.length > 0) || (item.id === "tailor" && patches.length > 0) || (item.id === "review" && ["awaiting_approval", "approved"].includes(runState)); return <button key={item.id} className={cx("progress-step", view === item.id && "active", done && "done")} onClick={() => { setView(item.id); setActiveNavigation(item.id === "match" ? "workspace" : item.id === "rehearse" ? "practice" : "documents"); scrollToWorkspacePanel(); }}><span>{done ? "✓" : item.number}</span><div><b>{item.label}</b><small>{item.hint}</small></div>{index < views.length - 1 && <i />}</button>; })}</section>
        <div className="workspace-grid"><section className="main-column">
          <article className="target-card"><div className="target-card-top"><div className="target-label"><span>{sourceLabel(selectedJob?.origin || "demo_fixture")}</span><b>Selected role</b></div><div className="target-card-actions">{selectedJob?.url && selectedJob.origin !== "demo_fixture" && <button className="text-action" onClick={() => openOfficialListing(selectedJob.url)}>Open source ↗</button>}<button className="text-action" onClick={adaptSelectedJob}>Edit role</button></div></div><div className="target-body"><div className="company-seal">{selectedJob?.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div className="target-copy"><h2>{selectedJob?.title}</h2><p>{selectedJob?.company} <i>·</i> {selectedJob?.location} <i>·</i> {selectedJob?.type}</p><small className="source-line">{sourceDetail(selectedJob)} · updated {selectedJob?.posted || "not disclosed"}</small><div className="role-tags">{roleSkills(selectedJob).slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}</div></div><div className="fit-summary"><div className="score-orbit" style={{ "--score": `${market?.score || 0}%` } as React.CSSProperties}><span>{market?.score || "—"}<small>{market ? "%" : "FIT"}</small></span></div><div><small>FIT CHECK</small><b>{market ? "Evidence mapped" : "Not assessed yet"}</b><p>{market ? `${directMatches} direct strengths found` : selectedIsPractice ? "Sample role for safe practice" : "Check this role against your CV"}</p></div></div></div></article>
          <section ref={workspacePanelRef} className="workspace-panel"><div className="panel-topline"><div><p className="kicker">{views.find((item) => item.id === view)?.number} / {views.find((item) => item.id === view)?.label?.toUpperCase()}</p><h2>{panelHeading(view, runState)}</h2></div><div className="live-context"><span className={cx("tiny-status", runState === "running" && "is-live")} />{activeAgent}</div></div>
            {view === "match" && <Suspense fallback={<DeferredPanelLoading label="Loading fit details…" />}><DeferredMatchPanel selectedJob={selectedJob} market={market} onStart={() => void startRehearsal()} onSampleStart={startSampleFitCheck} onImport={() => setShowIntake(true)} onReviewRole={() => selectedJob && void loadJobDetail(selectedJob.id)} isRoleLoading={loadingJobId === selectedJob?.id} runState={runState} canRun={serviceOnline} usingDemoProfile={usingDemoProfile} selectedIsPractice={Boolean(selectedIsPractice)} /></Suspense>}
            {view === "rehearse" && <Suspense fallback={<DeferredPanelLoading label="Loading practice workspace…" />}><DeferredRehearsalPanel turns={turns} currentTurn={currentTurn} runState={runState} onStart={() => void startRehearsal()} canRun={serviceOnline} /></Suspense>}
            {view === "tailor" && <Suspense fallback={<DeferredPanelLoading label="Loading revisions…" />}><DeferredTailorPanel patches={patches} coverLetter={coverLetter} coverLetterEvidenceIds={coverLetterEvidenceIds} showCoverLetter={showCoverLetter} onToggleCoverLetter={() => setShowCoverLetter((current) => !current)} onStart={() => void startRehearsal()} canRun={serviceOnline} runState={runState} /></Suspense>}
            {view === "review" && <Suspense fallback={<DeferredPanelLoading label="Loading review and export controls…" />}><DeferredReviewPanel runState={runState} patches={patches} gaps={market?.gaps || []} readiness={exportReadiness} selectedJob={selectedJob} onApprove={() => void approvePacket()} onExport={exportPacket} onOpenOfficial={openOfficialListing} serviceOnline={serviceOnline} isApproving={isApproving} isExporting={isExporting} /></Suspense>}
          </section>
          <section ref={shortlistRef} className="shortlist-card"><div className="section-heading"><div><p className="kicker">YOUR ROLE SHORTLIST</p><h2>Review a role</h2><p className="shortlist-helper">Choose a role card to make it your active target. Live roles are public listings; pasted roles stay marked as yours.</p></div><div className="shortlist-actions"><button className="primary-action small" onClick={() => serviceOnline ? setShowLiveFinder(true) : explainServiceUnavailable()} disabled={!serviceOnline || runIsActive} aria-disabled={!serviceOnline || runIsActive}>Find live roles <span>↗</span></button><button className="outline-action small" onClick={openBlankJobForm} disabled={!serviceOnline || runIsActive} aria-disabled={!serviceOnline || runIsActive}>Paste a listing</button></div></div><div className="job-grid">{visibleJobs.map((job) => <button key={job.id} className={cx("job-tile", job.id === selectedJob?.id && "selected")} disabled={runIsActive} aria-label={runIsActive ? "Role switching is locked while the rehearsal runs" : `${job.id === selectedJob?.id ? "Selected role" : "Review role"} ${job.title} at ${job.company}`} onClick={() => selectRole(job.id)}><span className="job-tile-index">{String(jobs.indexOf(job) + 1).padStart(2, "0")}</span><div><b>{job.title}</b><p>{job.company} · {job.location}</p><small>{roleSkills(job).slice(0, 3).join(" · ") || "Open to review skills"}</small></div><i>{job.id === selectedJob?.id ? "Selected" : "Review role"}</i></button>)}</div>{jobs.length > 3 && <div className="shortlist-footer"><button className="text-action" onClick={() => setShowAllJobs((current) => !current)}>{showAllJobs ? "Show fewer roles" : `Show ${jobs.length - 3} more role${jobs.length - 3 === 1 ? "" : "s"}`} <span>{showAllJobs ? "↑" : "↓"}</span></button><small>{visibleJobs.length} of {jobs.length} targets shown</small></div>}</section>
        </section>
        <aside className="insight-column"><section className="evidence-card"><div className="section-heading"><div><p className="kicker">YOUR EVIDENCE</p><h2>Work you can stand behind</h2><p className="evidence-explainer">Evidence is a real CV or work example that supports a skill or claim.</p></div><span className="count-pill">{candidate.evidence.length}</span></div><div className="evidence-meter"><div className="meter-number"><b>{market ? coverage : "—"}</b><span>{market ? "%" : "not checked"}</span></div><div className="meter-copy"><b>Coverage, not confidence.</b><p>{market ? "Direct evidence is kept separate from related experience." : "Check a role to see evidence coverage for its requirements."}</p></div></div><EvidenceGroup label="Direct evidence" tone="mint" items={market ? market.verified_strengths.map((item) => item.skill) : evidencePreviewSkills} /><EvidenceGroup label="Related experience" tone="amber" items={market ? market.adjacent_strengths.map((item) => item.skill) : []} /><EvidenceGroup label="Gaps to address" tone="coral" items={market ? market.gaps.map((item) => item.skill) : []} /></section>
          <section className="proof-card"><p className="kicker">EXAMPLE FROM YOUR EVIDENCE</p><blockquote>“{proofItem?.source_text || "Import or write a literal work statement to begin."}”</blockquote><div><span>Evidence {proofItem?.evidence_id || "—"}</span><b>{proofItem ? "Source-linked" : "Needs a source"}</b></div></section>
          <section className="activity-card"><div className="section-heading"><div><p className="kicker">WORK LOG</p><h2>What just happened</h2></div><span className="log-count">{events.length}</span></div>{events.length ? <Suspense fallback={<div className="activity-empty">Loading recent workspace updates…</div>}><DeferredActivityStream events={events} /></Suspense> : <div className="activity-empty">Your work log will stay short, readable, and useful — not a wall of agent chatter.</div>}</section>
        </aside></div>
        </>}
      </div>
    </div>
    {showIntake && <Suspense fallback={<DeferredDialogLoading label="Loading profile editor…" />}><CandidateModal candidate={candidate} isDemoProfile={usingDemoProfile} onClose={() => setShowIntake(false)} onChange={updateCandidate} onRestore={() => { setCandidate(fallbackCandidate); setUsingDemoProfile(true); resetRun("match"); }} onAnalyze={() => void analyzeResume()} onUpload={(file) => void importResume(file)} isAnalyzing={isAnalyzing} isImporting={isImporting} serviceOnline={serviceOnline} runIsActive={runIsActive} /></Suspense>}
    {showJobForm && <Suspense fallback={<DeferredDialogLoading label="Loading role editor…" />}><JobModal title={manualTitle} company={manualCompany} location={manualLocation} url={manualUrl} description={manualDescription} onTitle={setManualTitle} onCompany={setManualCompany} onLocation={setManualLocation} onUrl={setManualUrl} onDescription={setManualDescription} onClose={() => setShowJobForm(false)} onSubmit={(event) => void addManualJob(event)} /></Suspense>}
    {showLiveFinder && <Suspense fallback={<DeferredDialogLoading label="Loading role search…" />}><LiveRolesModal onClose={() => setShowLiveFinder(false)} onDiscover={discoverPublicRoles} onConnect={connectPublicBoard} /></Suspense>}
    {showGuide && <Suspense fallback={<DeferredDialogLoading label="Loading guide…" />}><HowItWorksModal onClose={() => setShowGuide(false)} onOpenProfile={() => { setShowGuide(false); setShowIntake(true); }} onOpenLive={() => { if (!serviceOnline) return explainServiceUnavailable(); setShowGuide(false); setShowLiveFinder(true); }} onOpenManual={() => { setShowGuide(false); openBlankJobForm(); }} /></Suspense>}
  </main>;
}

function InitialWorkspaceSkeleton() {
  return <section className="initial-workspace-skeleton" aria-label="Loading demo workspace" aria-busy="true">
    <div className="initial-skeleton-heading"><span className="inline-skeleton short" /><span className="inline-skeleton" /></div>
    <div className="initial-skeleton-grid"><article><span className="inline-skeleton short" /><span className="inline-skeleton" /><span className="inline-skeleton" /></article><article><span className="inline-skeleton short" /><span className="inline-skeleton" /><span className="inline-skeleton medium" /></article></div>
    <p>Preparing the sample workspace — live job sources have not been contacted.</p>
  </section>;
}

function DeferredDialogLoading({ label }: { label: string }) {
  return <div className="modal-backdrop" role="status" aria-live="polite"><section className="modal-card deferred-dialog-loading"><p className="kicker">PREPARING WORKSPACE</p><h2>{label}</h2><div className="inline-skeleton" /></section></div>;
}

function DeferredPanelLoading({ label }: { label: string }) {
  return <div className="deferred-panel-loading" role="status" aria-live="polite"><p className="kicker">PREPARING WORKSPACE</p><b>{label}</b><div className="inline-skeleton" /><div className="inline-skeleton short" /></div>;
}

function HeroScene({ candidateName, evidenceCount, job, score, serviceStatus }: { candidateName: string; evidenceCount: number; job?: Job; score: number | null; serviceStatus: ServiceStatus }) {
  const scoreLabel = score === null ? "—" : `${score}%`;
  return <div className="hero-scene" aria-label={`A visual map from ${evidenceCount} evidence items to ${job?.title || "your target role"}`}>
    <div className="scene-aurora" /><div className="scene-grid" /><div className="scene-shadow" />
    <div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="scene-spark spark-one" /><span className="scene-spark spark-two" /><span className="scene-spark spark-three" />
    <article className="scene-card scene-evidence"><span className="scene-card-label"><i>✓</i> YOUR EVIDENCE</span><b>{evidenceCount} work examples</b><p>Only source-linked work enters the flow.</p><div className="mini-bars"><i /><i /><i /></div></article>
    <article className="scene-core"><span className="core-halo" /><span className="core-orb">{scoreLabel}<small>{score === null ? "FIT CHECK" : "MAPPED"}</small></span><div><small>YOUR CASE</small><b>Evidence, not hype.</b></div></article>
    <article className="scene-card scene-role"><span className="scene-card-label"><i>↗</i> SELECTED ROLE</span><b>{job?.title || "Choose a target"}</b><p>{job?.company || "Bring in a real listing"}</p><span className="scene-chip">{job?.origin === "demo_fixture" ? "Demo role" : "Applicant-controlled"}</span></article>
    <article className="scene-person"><span>{initials(candidateName)}</span><div><small>APPLICANT</small><b>{candidateName}</b><p>{serviceStatus === "online" ? "Workspace connected" : serviceStatus === "checking" ? "Connecting workspace" : "Preview only · API unavailable"}</p></div></article>
  </div>;
}

function panelHeading(view: WorkspaceView, state: RunState) { if (view === "match") return "A practical read on this role"; if (view === "rehearse") return state === "running" ? "The interview is being rehearsed" : "Practice the questions that matter"; if (view === "tailor") return "Edit for relevance, not invention"; return state === "approved" ? "Your packet is ready to take with you" : "You make the final call"; }

function EvidenceGroup({ label, tone, items }: { label: string; tone: "mint" | "amber" | "coral"; items: string[] }) { return <section className={cx("evidence-group", tone)}><div><span /> <b>{label}</b><small>{items.length}</small></div><p>{items.slice(0, 3).join(" · ") || "No evidence yet"}</p></section>; }

function NavGlyph({ type }: { type: "grid" | "briefcase" | "chat" | "document" }) {
  if (type === "grid") return <svg viewBox="0 0 18 18"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="11" y="2" width="5" height="5" rx="1"/><rect x="2" y="11" width="5" height="5" rx="1"/><rect x="11" y="11" width="5" height="5" rx="1"/></svg>;
  if (type === "briefcase") return <svg viewBox="0 0 18 18"><rect x="2" y="5" width="14" height="10" rx="2"/><path d="M6 5V3.8c0-.7.5-1.3 1.2-1.3h3.6c.7 0 1.2.6 1.2 1.3V5M2 9h14M7.5 9v2h3V9"/></svg>;
  if (type === "chat") return <svg viewBox="0 0 18 18"><path d="M3 3.5h12v8H8l-3.7 3V11.5H3z"/><path d="M6 6.8h6M6 9h3.5"/></svg>;
  return <svg viewBox="0 0 18 18"><path d="M5 2.5h6l2.5 2.5v10.5H5z"/><path d="M11 2.5V5h2.5M7 8h4M7 10.5h4M7 13h2.5"/></svg>;
}
