"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
// "demo-only" is an intentional, user-selected sample boundary. It is not a
// synonym for a failed health check: "offline" means the live API was tried and
// confirmed unavailable, while "checking" never blocks a new user's first step.
type ServiceStatus = "checking" | "online" | "offline" | "demo-only";
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
  name: "Hussain Ahmed", headline: "Full-Stack Developer · Python · FastAPI · React · PostgreSQL", location: "Rawalpindi, Pakistan", preferences: ["Remote", "Full-stack", "Backend products"], resume_text: "Hussain Ahmed — Full-Stack Developer with verified Python, FastAPI, React, and PostgreSQL project evidence.",
  evidence: [
    { evidence_id: "ev_01", source_section: "Experience", source_text: "Built a React dashboard for an operations team.", skills: ["React", "Frontend"], status: "verified" },
    { evidence_id: "ev_02", source_section: "Experience", source_text: "Developed REST APIs for a student-services platform.", skills: ["Python", "REST APIs"], status: "verified" },
    { evidence_id: "ev_03", source_section: "Project", source_text: "Built a FastAPI service with JWT authentication and PostgreSQL.", skills: ["FastAPI", "Python", "PostgreSQL"], status: "verified" },
    { evidence_id: "ev_04", source_section: "Project", source_text: "Dockerized the development environment and documented local setup.", skills: ["Docker"], status: "verified" },
    { evidence_id: "ev_05", source_section: "Project", source_text: "Reduced manual reporting time by 40% through an analytics dashboard.", skills: ["React", "Analytics"], metric: "40% reporting-time reduction", status: "verified" },
    { evidence_id: "ev_06", source_section: "Experience", source_text: "Collaborated with three developers using Git and code reviews.", skills: ["Git", "Code review", "Team collaboration"], status: "verified" },
  ],
};

const fallbackJobs: Job[] = [
  { id: "atlas-ai-backend", origin: "demo_fixture", source: "Demo scenario", title: "AI Backend Engineer", company: "Atlas Labs", location: "Remote · Pakistan-friendly", type: "Full time", salary: "Competitive · not disclosed", posted: "Demo scenario", url: "https://example.com/atlas-ai-backend", description: "Build reliable Python services for AI-enabled workflows. Work with product and frontend engineers to create API-first experiences.", must_have: ["Python", "FastAPI", "REST APIs", "PostgreSQL", "Docker"], preferred: ["Kubernetes", "LLM applications", "CI/CD"] },
  { id: "northstar-fullstack", origin: "demo_fixture", source: "Demo scenario", title: "Full-stack Product Engineer", company: "Northstar Systems", location: "Remote · Global", type: "Full time", salary: "Competitive · not disclosed", posted: "Demo scenario", url: "https://example.com/northstar-fullstack", description: "Ship responsive React product surfaces and API-driven services for operations teams.", must_have: ["React", "TypeScript", "Python", "REST APIs", "Git"], preferred: ["Testing", "Docker", "Product analytics"] },
  { id: "orbit-data-platform", origin: "demo_fixture", source: "Demo scenario", title: "Junior Data Platform Engineer", company: "Orbit Data", location: "Hybrid · Islamabad", type: "Full time", salary: "Competitive · not disclosed", posted: "Demo scenario", url: "https://example.com/orbit-data-platform", description: "Build data services, reporting APIs, and developer tooling for product teams.", must_have: ["Python", "PostgreSQL", "REST APIs", "Git"], preferred: ["Airflow", "Kubernetes", "Terraform"] },
];

const views: { id: WorkspaceView; label: string; number: string; hint: string }[] = [
  { id: "match", label: "Understand fit", number: "03", hint: "See what your experience supports" },
  { id: "tailor", label: "Build your story", number: "04", hint: "Turn work into useful proof" },
  { id: "rehearse", label: "Practice", number: "05", hint: "Prepare evidence-based answers" },
  { id: "review", label: "Review & export", number: "06", hint: "Approve before export" },
];

type JourneyStep = { id: "profile" | "role" | WorkspaceView; label: string; number: string; hint: string };
const journeySteps: JourneyStep[] = [
  { id: "profile", label: "Add your CV", number: "01", hint: "Add the work you can support" },
  { id: "role", label: "Choose a job", number: "02", hint: "Pick one role to prepare for" },
  ...views,
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
const initials = (name: string) => name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "HA";
const sourceLabel = (origin: Origin) => origin === "public_cache" ? "Public job listing" : origin === "user_pasted" ? "Pasted by you" : "Demo role";
const retrievalLabel = (value?: string | null) => value ? value.replace("T", " ").replace(/\.\d+\+00:00$/, " UTC").replace("+00:00", " UTC") : "time not recorded";
const sourceDetail = (job?: Job) => {
  if (!job || job.origin === "demo_fixture") return "Demo role — choose a public listing or paste your own job for a real application.";
  if (job.origin === "user_pasted") return `Added by you · ${retrievalLabel(job.retrieved_at)}`;
  return `Source: ${job.source} · ${job.cache_state === "cached" ? "cached" : "retrieved"} ${retrievalLabel(job.retrieved_at)}`;
};
const roleSkills = (job?: Job) => job?.must_have?.length ? job.must_have : job?.skills || [];
const hasRoleDetail = (job?: Job) => Boolean(job?.detail_loaded || job?.description || job?.must_have?.length);
const applicationProgress = (state: RunState, usingDemoProfile: boolean, selectedIsDemo: boolean, hasFit = false) => {
  if (state === "approved") return { step: 6, status: "Approved", next: "Export your approved packet" };
  if (state === "awaiting_approval") return { step: 6, status: "Ready for review", next: "Review and approve your packet" };
  if (state === "running") return { step: 5, status: "Practicing", next: "Continue building your application story" };
  if (state === "needs_evidence" || hasFit) return { step: 3, status: "Fit checked", next: "Build your application story" };
  if (selectedIsDemo || usingDemoProfile) return { step: 1, status: "New", next: "Add your CV" };
  return { step: 2, status: "New", next: "Choose a job to prepare for" };
};

function apiRunMode(engine: RunMode): "evidence_lab" | "crewai" {
  // The API deliberately supports only these two modes. Keep this explicit so
  // no presentation label can leak into a backend request.
  return engine === "crewai" ? "crewai" : "evidence_lab";
}

export default function Home() {
  const pathname = usePathname();
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
  // A first click can confirm health at action time. This is deliberately
  // separate from the initial bootstrap so controls are useful immediately.
  const [isActionChecking, setIsActionChecking] = useState(false);
  const [practiceFocus, setPracticeFocus] = useState<string | null>(null);
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
  // Keep controls enabled while a health request is in flight. A confirmed
  // outage or an intentional sample-only choice is the only live-action pause.
  const canStartLiveAction = serviceStatus === "online" || serviceStatus === "checking";
  const crewaiAvailable = Boolean(serviceHealth?.optional_crewai);
  const runIsActive = runState === "running";
  const application = applicationProgress(runState, usingDemoProfile, Boolean(selectedIsPractice), Boolean(market));
  const serviceCopy = serviceStatus === "online" ? "Workspace ready" : serviceStatus === "checking" ? "Preparing workspace" : serviceStatus === "demo-only" ? "Sample workspace" : "Live workspace unavailable";

  async function checkService(showSuccess = false) {
    setServiceStatus("checking");
    try {
      // cachedGet shares the bootstrap request when a user acts immediately,
      // while a manual retry still asks health to confirm readiness again.
      const health = await cachedGet<ServiceHealth>(`${API}/healthz`, 0);
      if (!health.ok) throw new Error("The workspace service did not confirm that it is ready.");
      setServiceHealth(health);
      setServiceStatus("online");
      if (showSuccess) setNotice("Live workspace ready. You can import a CV, add a role, or start a rehearsal.");
      return true;
    } catch (error) {
      setServiceStatus("offline");
      if (showSuccess) setNotice(error instanceof Error ? error.message : "Live workspace temporarily unavailable. You can still explore the demo.");
      return false;
    }
  }

  async function requireLiveWorkspace(actionName: string): Promise<boolean> {
    if (serviceStatus === "online") return true;
    if (serviceStatus === "checking") {
      setIsActionChecking(true);
      setNotice(`Checking the live workspace before ${actionName}…`);
      const ready = await checkService(false);
      setIsActionChecking(false);
      if (ready) return true;
      setNotice("Live workspace temporarily unavailable. You can still explore the demo.");
      return false;
    }
    if (serviceStatus === "demo-only") {
      setNotice("You are exploring the sample workflow. Try the live workspace when you are ready to import a CV, use a real role, or export a packet.");
      return false;
    }
    explainServiceUnavailable();
    return false;
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
      // Health is the connection contract. Demo fixtures are helpful but their
      // fetch must never turn a healthy API into a false "paused" workspace.
      if (healthResult.status === "fulfilled" && healthResult.value.ok) {
        setServiceHealth(healthResult.value);
        setServiceStatus((current) => current === "demo-only" ? "demo-only" : "online");
      } else {
        setServiceStatus((current) => current === "demo-only" ? "demo-only" : "offline");
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
    streamRef.current?.close(); runLockRef.current = false; window.sessionStorage.removeItem(RUN_STORAGE_KEY); setRunId(null); setRunState("idle"); setPracticeFocus(null); setMarket(null); setTurns([]); setPatches([]); setCoverageAfter(null); setCoverLetter(""); setCoverLetterEvidenceIds([]); setExportReadiness(null); setEvents([]); setActiveAgent("Ready when you are"); setShowCoverLetter(false); setView(nextView);
  }

  function scrollToShortlist() {
    window.requestAnimationFrame(() => shortlistRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function scrollToWorkspacePanel() {
    window.requestAnimationFrame(() => workspacePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function navigate(section: NavigationSection) {
    setActiveNavigation(section);
    // Keep the applicant's in-memory CV, selected role, and progress intact
    // when moving between workspace sections. Native history gives the Back
    // button a real entry without remounting this privacy-sensitive session.
    if (pathname !== routeForSection[section]) window.history.pushState(null, "", routeForSection[section]);
    if (section === "workspace") { setView("match"); window.scrollTo({ top: 0, behavior: "smooth" }); }
    if (section === "applications") { setView("match"); scrollToShortlist(); }
    if (section === "practice") { setView("rehearse"); scrollToWorkspacePanel(); }
    if (section === "documents") { setView(patches.length ? "tailor" : "review"); scrollToWorkspacePanel(); }
  }

  function chooseEngine(mode: RunMode) {
    if (mode === "crewai" && !crewaiAvailable) {
      setShowEngineMenu(false);
      setRunMode("evidence_lab");
      setNotice("Guided AI review is not configured here. Your application workspace will still check evidence and keep approval safeguards in place.");
      return;
    }
    setRunMode(mode);
    setShowEngineMenu(false);
    setNotice(mode === "crewai"
      ? "Guided AI review is available for this run. Proof checks and your approval still control every claim and export."
      : "Your application workspace is selected. It checks each claim against your work examples before review.");
  }

  function explainServiceUnavailable() {
    setNotice("Live workspace temporarily unavailable. You can still explore the demo.");
  }

  function explainRunActive() {
    setNotice("A practice session is still active. Wait for its review before changing your CV, current application, or exports.");
  }

  async function openRoleFinder() {
    if (runIsActive) return explainRunActive();
    if (!await requireLiveWorkspace("opening public roles")) return;
    setShowLiveFinder(true);
  }

  function useDemoProfile() {
    if (runIsActive) return explainRunActive();
    setCandidate(fallbackCandidate);
    setUsingDemoProfile(true);
    resetRun("match");
    setNotice("Hussain Ahmed’s demo profile is ready. It is sample data only; nothing is submitted automatically.");
    scrollToWorkspacePanel();
  }

  function useDemoRole() {
    if (runIsActive) return explainRunActive();
    const demoRole = jobs.find((job) => job.origin === "demo_fixture") || fallbackJobs[0];
    setJobs((current) => current.some((job) => job.id === demoRole.id) ? current : [demoRole, ...current]);
    setSelectedJobId(demoRole.id);
    setActiveNavigation("applications");
    resetRun("match");
    setNotice("Demo role selected. Review the sample fit safely; nothing is submitted automatically.");
    scrollToWorkspacePanel();
  }

  function continueWithDemo() {
    if (runIsActive) return explainRunActive();
    setServiceStatus("demo-only");
    setCandidate(fallbackCandidate);
    setUsingDemoProfile(true);
    const demoRole = jobs.find((job) => job.origin === "demo_fixture") || fallbackJobs[0];
    setJobs((current) => current.some((job) => job.id === demoRole.id) ? current : [demoRole, ...current]);
    setSelectedJobId(demoRole.id);
    resetRun("match");
    setNotice("Sample-only workspace active. Hussain Ahmed’s profile and the demo role are examples only; live imports, role search, practice, approval, and export remain unavailable.");
    scrollToWorkspacePanel();
  }

  function tryDemoWorkspace() {
    if (runIsActive) return explainRunActive();
    if (serviceStatus === "offline") setServiceStatus("demo-only");
    useDemoRole();
    if (!usingDemoProfile) setNotice("Demo role selected. Your own CV stays unchanged; use the demo profile option only if you want to replace this local sample view.");
  }

  async function helpApplyToJob() {
    if (usingDemoProfile) {
      setShowIntake(true);
      setNotice("First, add your CV so every recommendation is based on your own work.");
      return;
    }
    if (selectedIsPractice) {
      await openRoleFinder();
      return;
    }
    setView("match");
    scrollToWorkspacePanel();
  }

  async function startFromHero() {
    if (usingDemoProfile) {
      setShowIntake(true);
      setNotice("Start with your CV so every fit check and answer is based on your own experience.");
      return;
    }
    if (selectedIsPractice) {
      await openRoleFinder();
      return;
    }
    await startRehearsal();
  }

  function startSampleFitCheck() {
    if (!selectedIsPractice) return startFromHero();
    setNotice(usingDemoProfile
      ? "This is a safe demo using sample data. Nothing is submitted."
      : "This is a safe demo using a sample role. Nothing is submitted.");
    void startRehearsal();
  }

  function addEvidenceForGap(skill: string) {
    if (runIsActive) return explainRunActive();
    setShowIntake(true);
    setNotice(`Add a literal CV line, project stack, or skills-list entry only if it genuinely supports ${skill}. Do not turn related experience into a direct claim.`);
  }

  function practiceGap(skill: string) {
    if (runIsActive) return explainRunActive();
    setPracticeFocus(skill);
    setView("rehearse");
    setActiveNavigation("practice");
    setNotice(`Practice an honest answer for ${skill}: explain what you can support, any related work, and the next step you are taking.`);
    scrollToWorkspacePanel();
  }

  function openBlankJobForm() {
    if (serviceStatus === "offline" || serviceStatus === "demo-only") return explainServiceUnavailable();
    if (runIsActive) return explainRunActive();
    setManualTitle(""); setManualCompany(""); setManualLocation(""); setManualUrl(""); setManualDescription("");
    setShowJobForm(true);
  }

  async function loadJobDetail(jobId: string): Promise<Job | null> {
    const current = jobs.find((job) => job.id === jobId);
    if (hasRoleDetail(current)) return current || null;
    const cached = jobDetailCacheRef.current.get(jobId);
    if (cached) return cached;
    if (!await requireLiveWorkspace("loading this role's published details")) return null;

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
    if (!selectedJob || runIsActive || runLockRef.current) return;
    if (!await requireLiveWorkspace("starting the fit check")) return;
    // A live search card is intentionally only a compact summary. Ensure the
    // applicant has explicitly loaded its source text before evidence work.
    const targetJob = hasRoleDetail(selectedJob) ? selectedJob : await loadJobDetail(selectedJob.id);
    if (!targetJob) return;
    if (runMode === "crewai" && !crewaiAvailable) {
      setRunMode("evidence_lab");
      setNotice("Guided AI review is unavailable on this workspace, so HireSwarm will use its standard proof checks.");
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
    if (!runId || runIsActive || runState !== "awaiting_approval" || approvalLockRef.current) return;
    if (!await requireLiveWorkspace("saving your approval")) return;
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
    if (!runId || runIsActive || runState !== "approved" || exportLockRef.current) return;
    if (!await requireLiveWorkspace(`preparing your ${format.toUpperCase()} export`)) return;
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
    if (runIsActive) return explainRunActive();
    if (!await requireLiveWorkspace("adding your pasted role")) return;
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
    if (runIsActive) return explainRunActive();
    if (!await requireLiveWorkspace("searching public roles")) return;
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
    if (runIsActive) return explainRunActive();
    if (!await requireLiveWorkspace("reading the public board")) return;
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
    if (runIsActive) return explainRunActive();
    setIsImporting(true);
    if (!await requireLiveWorkspace("importing your CV")) { setIsImporting(false); return; }
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
    if (runIsActive) return explainRunActive();
    setIsAnalyzing(true);
    if (!await requireLiveWorkspace("refreshing your work examples")) { setIsAnalyzing(false); return; }
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
      <nav className="primary-nav" aria-label="Main navigation">
        <Link prefetch={false} href="/workspace" className={cx("nav-item", activeNavigation === "workspace" && "active")} onClick={(event) => { event.preventDefault(); navigate("workspace"); }}><NavGlyph type="grid" />Home</Link>
        <Link prefetch={false} href="/applications" className={cx("nav-item", activeNavigation === "applications" && "active")} onClick={(event) => { event.preventDefault(); navigate("applications"); }}><NavGlyph type="briefcase" />{inDemoWorkspace ? "Demo applications" : "My applications"} <small>{jobs.length}</small></Link>
        <button type="button" className="nav-item find-jobs-nav" onClick={() => void openRoleFinder()} disabled={runIsActive}><NavGlyph type="search" />Find jobs</button>
        <Link prefetch={false} href="/practice" className={cx("nav-item", activeNavigation === "practice" && "active")} onClick={(event) => { event.preventDefault(); navigate("practice"); }}><NavGlyph type="chat" />Practice</Link>
        <Link prefetch={false} href="/documents" className={cx("nav-item", activeNavigation === "documents" && "active")} onClick={(event) => { event.preventDefault(); navigate("documents"); }}><NavGlyph type="document" />My documents</Link>
      </nav>
      <div className="sidebar-spacer" />
      <section className={cx("candidate-card", usingDemoProfile && "is-demo")}><div className="candidate-avatar">{initials(candidate.name)}</div><div className="candidate-card-copy"><small>{usingDemoProfile ? "DEMO PROFILE" : "YOUR PROFILE"}</small><b>{candidate.name}</b><span>{usingDemoProfile ? "Demo data only" : candidate.location}</span></div><button onClick={() => setShowIntake(true)} aria-label="Open profile">Profile</button></section>
      <div className="sidebar-note"><span /> <p><b>Work examples</b> are real CV lines or projects that support a skill or claim.</p></div>
    </aside>

    <div className="app-content">
      <header className="app-header command-header">
        <div className="header-context command-context" aria-label="Current workspace location">
          <div className="breadcrumb-stack">
            <span className="context-label">YOUR APPLICATION WORKSPACE</span>
            <div><button className="crumb-button" onClick={() => navigate("applications")}>{inDemoWorkspace ? "Demo applications" : "My applications"}</button><i>/</i><button className="crumb-target" onClick={adaptSelectedJob}>{selectedJob?.company || (selectedIsPractice ? "Demo role" : "Current application")}</button></div>
          </div>
          <button className={cx("service-indicator", serviceStatus)} onClick={() => void checkService(true)} title="Check live workspace connection" aria-label={`Workspace connection: ${serviceCopy}. Click to retry.`}>
            <span className="service-pulse" /><span><b>{serviceStatus === "online" ? "Live workspace" : serviceStatus === "checking" ? "Preparing workspace" : serviceStatus === "demo-only" ? "Sample workspace" : "Live workspace unavailable"}</b><small>{serviceStatus === "online" ? "Ready for CVs and roles" : serviceStatus === "checking" ? "Actions stay available" : serviceStatus === "demo-only" ? "Examples only" : "Tap to try again"}</small></span><i aria-hidden="true">↻</i>
          </button>
        </div>
        <div className="header-actions command-actions" aria-label="Workspace controls">
          <div className="engine-switcher">
            <button className="command-action engine-trigger" onClick={() => setShowEngineMenu((open) => !open)} aria-expanded={showEngineMenu} aria-haspopup="menu" aria-label="Choose how your work examples are checked">
              <span className="command-icon engine-symbol">✓</span><span className="mobile-command-label">Proof</span><span className="command-copy"><b>{runMode === "crewai" ? "Guided AI review" : "Proof checks"}</b><small>How we verify your application</small></span><span className="chevron">⌄</span>
            </button>
            {showEngineMenu && <div className="engine-menu" role="menu" aria-label="Choose how your work examples are checked">
              <p className="menu-overline">HOW WE VERIFY YOUR APPLICATION</p>
              <button role="menuitem" className={cx(runMode === "evidence_lab" && "selected")} onClick={() => chooseEngine("evidence_lab")}><span className="engine-menu-symbol">✓</span><span><b>Your application workspace</b><small>Proof checks · default</small></span>{runMode === "evidence_lab" && <i>Selected</i>}</button>
              <button role="menuitem" className={cx(runMode === "crewai" && "selected")} onClick={() => chooseEngine("crewai")} disabled={!crewaiAvailable} aria-disabled={!crewaiAvailable}><span className="engine-menu-symbol">✦</span><span><b>Guided AI review</b><small>{crewaiAvailable ? "Optional extra narration" : "Unavailable here · standard proof checks will run"}</small></span>{runMode === "crewai" && crewaiAvailable && <i>Selected</i>}</button>
              {!crewaiAvailable && <p className="engine-unavailable" role="note">Guided AI review is not configured on this deployment. Standard proof checks remain fully available.</p>}
            </div>}
          </div>
          <button className="command-action guide-action" onClick={() => setShowGuide(true)} aria-label="Open how HireSwarm works guide"><span className="command-icon">?</span><span className="mobile-command-label">Guide</span><span className="command-copy"><b>Guide</b><small>See the path</small></span></button>
          <button className="command-action find-action" onClick={() => void openRoleFinder()} aria-label="Find public roles" disabled={runIsActive} aria-disabled={runIsActive} aria-busy={isActionChecking}><span className="command-icon">⌕</span><span className="mobile-command-label">Roles</span><span className="command-copy"><b>{isActionChecking ? "Checking workspace…" : "Find jobs"}</b><small>{serviceStatus === "offline" || serviceStatus === "demo-only" ? "Demo still available" : "Public sources"}</small></span></button>
          <button className="command-action paste-action" onClick={openBlankJobForm} aria-label="Paste a job listing" disabled={runIsActive}><span className="command-icon">+</span><span className="mobile-command-label">Paste</span><span className="command-copy"><b>Paste role</b><small>Add your listing</small></span></button>
          <button className="profile-button command-profile" onClick={() => setShowIntake(true)} aria-label="Open your profile"><span>{initials(candidate.name)}</span><i>Profile</i><small className="mobile-command-label">You</small></button>
        </div>
      </header>
      <div className="page-wrap">
        {serviceStatus === "offline" && <section className="service-outage" role="alert" aria-labelledby="service-outage-title">
          <div className="service-outage-icon" aria-hidden="true">!</div>
          <div><p className="section-kicker">LIVE WORKSPACE PAUSED</p><h2 id="service-outage-title">Live workspace temporarily unavailable.</h2><p>You can still explore the demo. Imports, live-role search, practice, approval, and exports remain paused until the workspace is ready again.</p></div>
          <div className="service-outage-actions"><button type="button" onClick={() => void checkService(true)}>Try again</button><button type="button" className="outage-demo-action" onClick={continueWithDemo}>Continue with demo</button></div>
        </section>}
        {serviceStatus === "demo-only" && <section className="demo-only-banner" role="note" aria-labelledby="demo-only-title"><div><p className="section-kicker">SAMPLE-ONLY WORKSPACE</p><h2 id="demo-only-title">You are exploring clearly labeled sample data.</h2><p>Hussain Ahmed’s profile and demo roles are for orientation only. No live CV import, role search, practice, approval, export, or application submission is available in this mode.</p></div><button type="button" className="outline-action small" onClick={() => void checkService(true)}>Try live workspace</button></section>}
        {notice && <div className="notice" role="status" aria-live="polite"><span>i</span><p>{notice}</p><button onClick={() => setNotice(null)} aria-label="Dismiss notice">Dismiss</button></div>}
        {inDemoWorkspace && <section className="demo-workspace-banner" role="note" aria-labelledby="demo-workspace-title">
          <div className="demo-banner-mark" aria-hidden="true">◎</div>
          <div><p>DEMO WORKSPACE</p><h2 id="demo-workspace-title">You are viewing a sample workspace, not an application.</h2><span>{usingDemoProfile ? "This example uses Hussain Ahmed’s sample profile. To prepare your application, start with your CV. Nothing is submitted automatically." : "This current job is a sample role. Your CV stays yours; choose a real role before preparing an application."}</span></div>
          <button className="outline-action small" onClick={() => usingDemoProfile ? setShowIntake(true) : void openRoleFinder()}>{usingDemoProfile ? "Start with my CV" : "Choose a real role"} <span>→</span></button>
        </section>}
        <section className="command-hero welcome-hero" aria-labelledby="workspace-title">
          <div className="command-hero-copy">
            <div className="hero-overline"><span className={cx("data-state", inDemoWorkspace && "practice")}>WELCOME TO HIRESWARM</span><span>YOU APPROVE EVERYTHING · NO AUTO-APPLY</span></div>
            <h1 id="workspace-title">Make your real work <em>impossible to miss.</em></h1>
            <p className="hero-value">Turn your real experience into a stronger job application.</p>
            <p className="command-hero-lede">Start with your CV, choose a role, and get a clear, evidence-backed application plan. HireSwarm shows what to highlight, what to explain, and what to improve — without inventing experience.</p>
            <div className="hero-cta-row">
              <button className="hero-primary" disabled={runState === "running"} onClick={() => setShowIntake(true)} aria-describedby={serviceStatus === "offline" ? "service-outage-title" : undefined}><span className="hero-primary-icon">↑</span><span><b>Start with my CV</b><small>Upload a PDF, DOCX, TXT, or paste your experience</small></span></button>
              <button className="hero-secondary" onClick={tryDemoWorkspace} disabled={runIsActive}><span>DEMO</span><span><b>{inDemoWorkspace ? "Explore sample workflow" : "Try a demo"}</b><small>{inDemoWorkspace ? "Sample CV + role · no submission" : "Explore a sample CV and role safely"}</small></span><i>→</i></button>
            </div>
            <div className="hero-stat-row" aria-label={`${candidate.evidence.length} ${usingDemoProfile ? "sample" : "CV"} work examples, a current job, and approval required`}>
              <div><b>{candidate.evidence.length}</b><span>{usingDemoProfile ? "sample work examples" : "work examples"}</span></div><div><b>{selectedIsPractice ? "Demo" : "Current"}</b><span>{selectedIsPractice ? "role for practice" : "job to prepare for"}</span></div><div><b>100%</b><span>your final approval</span></div>
            </div>
          </div>
          <HeroScene candidateName={candidateFirstName} evidenceCount={candidate.evidence.length} job={selectedJob} score={market?.score ?? null} serviceStatus={serviceStatus} />
        </section>
        <section className="intent-card" aria-labelledby="intent-title">
          <div className="intent-intro"><p className="section-kicker">START WITH A CLEAR NEXT STEP</p><h2 id="intent-title">What do you want to do?</h2><p>Choose one path. We will show the next useful action instead of leaving you in a blank dashboard.</p></div>
          <div className="intent-actions">
            <button className="intent-action primary" onClick={() => void helpApplyToJob()} disabled={runIsActive}><span>01</span><div><b>Help me apply to a job</b><small>I have a role in mind and want to prepare for it.</small></div><i>→</i></button>
            <button className="intent-action" onClick={() => void openRoleFinder()} disabled={runIsActive} aria-busy={isActionChecking}><span>02</span><div><b>{isActionChecking ? "Checking live workspace…" : "Help me find a suitable role"}</b><small>Show me public roles that match the work I want to do.</small></div><i>→</i></button>
            <button className="intent-action" onClick={() => setShowIntake(true)} disabled={runIsActive}><span>03</span><div><b>Improve my CV first</b><small>Turn my experience into stronger, supportable evidence.</small></div><i>→</i></button>
          </div>
        </section>
        <section className="recommended-action-card" aria-labelledby="recommended-action-title">
          <div><p className="section-kicker">RECOMMENDED NEXT ACTION</p><h2 id="recommended-action-title">{usingDemoProfile ? "Start with your CV." : selectedIsPractice ? "Choose a real role." : "Review your fit summary."}</h2><p>{usingDemoProfile ? "Your CV gives HireSwarm literal work examples to map to a role. You review every extracted example." : selectedIsPractice ? "Choose a public role or paste a listing to prepare a real application. The sample role is clearly labeled and never submitted." : "See highlighted evidence, honest gaps, and one practical plan for this application."}</p></div>
          <button className="primary-action" onClick={() => void helpApplyToJob()} disabled={runIsActive}>{usingDemoProfile ? "Start with my CV" : selectedIsPractice ? "Choose a role" : "View fit summary"} <span>→</span></button>
        </section>
        <section className="start-flow concise-path" aria-labelledby="start-flow-title">
          <div className="start-flow-heading"><p className="section-kicker">HOW IT WORKS</p><h2 id="start-flow-title">Three clear steps. One application at a time.</h2><p>Everything stays tied to work you can support. You remain in control of every claim, export, and submission.</p></div>
          <div className="start-flow-grid">
            <article className="flow-step-card"><div className="flow-step-number">01</div><div><p className="flow-eyebrow">ADD YOUR EXPERIENCE</p><h3>Bring in your CV.</h3><p>We find literal work examples and keep the source visible for your review.</p></div></article>
            <article className="flow-step-card"><div className="flow-step-number">02</div><div><p className="flow-eyebrow">CHOOSE ONE ROLE</p><h3>Pick a target you trust.</h3><p>Use a public listing or paste a role. Sample roles always stay labeled as demos.</p></div></article>
            <article className="flow-step-card"><div className="flow-step-number">03</div><div><p className="flow-eyebrow">USE THE PLAN</p><h3>Highlight proof. Address gaps honestly.</h3><p>Practice, review suggested wording, and approve before exporting anything.</p></div></article>
          </div>
        </section>
        <section className="dashboard-overview applications-overview" aria-labelledby="applications-overview-title">
          <div className="current-applications"><div className="overview-heading"><div><p className="kicker">{inDemoWorkspace ? "DEMO APPLICATIONS" : "YOUR CURRENT APPLICATIONS"}</p><h2 id="applications-overview-title">Keep your next step clear.</h2></div><span>{jobs.length}</span></div>{jobs.slice(0, 2).map((job) => { const itemProgress = job.id === selectedJob?.id ? application : { step: 1, status: "New", next: "Add your CV" }; return <article className="application-status-row" key={job.id}><div><b>{job.title}</b><p>{job.company}</p><small>Step {itemProgress.step} of 6: {itemProgress.status}</small><em>Next: {itemProgress.next}</em></div><button className="outline-action small" onClick={() => selectRole(job.id)} disabled={runIsActive}>Continue</button></article>; })}</div>
          <div className="quick-actions"><p className="kicker">QUICK ACTIONS</p><button onClick={() => setShowIntake(true)}>Upload CV</button><button onClick={() => void openRoleFinder()}>Find a job</button><button onClick={() => { setView("rehearse"); scrollToWorkspacePanel(); }}>Practice interview</button><button onClick={() => navigate("documents")}>View documents</button></div>
        </section>
        <details className="advanced-explainer"><summary><span><b>Advanced details</b><small>See the evidence-backed material HireSwarm can help you prepare.</small></span><i>⌄</i></summary><section className="outcomes-card" aria-labelledby="outcomes-title"><div><p className="section-kicker">WHAT YOU WILL GET</p><h2 id="outcomes-title">Useful material for one real application.</h2><p>HireSwarm prepares evidence-backed work. You review it and decide what to use.</p></div><ul><li><span>01</span><p><b>Fit summary</b><small>A requirement-by-requirement skills and evidence map.</small></p></li><li><span>02</span><p><b>Honest gap plan</b><small>Missing proof stays visible, with practical next steps.</small></p></li><li><span>03</span><p><b>Stronger CV points</b><small>Tailored wording linked to your original work examples.</small></p></li><li><span>04</span><p><b>Cover letter points</b><small>A draft grounded in the experience you can support.</small></p></li><li><span>05</span><p><b>Interview practice</b><small>Role-specific questions and evidence-based answer guidance.</small></p></li><li><span>06</span><p><b>Final packet</b><small>PDF or DOCX export only after your approval.</small></p></li></ul></section></details>
        {isBootstrapping ? <InitialWorkspaceSkeleton /> : <>
        <section className="advanced-workspace-heading" aria-label="Advanced application details"><p className="section-kicker">ADVANCED APPLICATION DETAILS</p><h2>Open the six-step workspace when you are ready.</h2><p>Fit mapping, proof checks, practice, edits, and export stay here — after the first steps are clear.</p></section>
        <section className="progress-nav six-step-progress" aria-label="Six-step application path">
          {journeySteps.map((item, index) => {
            const done = item.id === "profile"
              ? !usingDemoProfile
              : item.id === "role"
                ? Boolean(selectedJob)
                : (item.id === "match" && Boolean(market)) || (item.id === "tailor" && patches.length > 0) || (item.id === "rehearse" && turns.length > 0) || (item.id === "review" && ["awaiting_approval", "approved"].includes(runState));
            const active = item.id === "role" ? activeNavigation === "applications" : item.id !== "profile" && view === item.id;
            return <button key={item.id} className={cx("progress-step", active && "active", done && "done")} onClick={() => {
              if (item.id === "profile") { setShowIntake(true); return; }
              if (item.id === "role") { setActiveNavigation("applications"); scrollToShortlist(); return; }
              setView(item.id);
              setActiveNavigation(item.id === "match" ? "workspace" : item.id === "rehearse" ? "practice" : "documents");
              scrollToWorkspacePanel();
            }}><span>{done ? "✓" : item.number}</span><div><b>{item.label}</b><small>{item.hint}</small></div>{index < journeySteps.length - 1 && <i />}</button>;
          })}
        </section>
        <div className="workspace-grid"><section className="main-column">
          <article className="target-card"><div className="target-card-top"><div className="target-label"><span>{sourceLabel(selectedJob?.origin || "demo_fixture")}</span><b className={selectedIsPractice ? "sample-role-label" : undefined}>{selectedIsPractice ? "SAMPLE ROLE — NOT YOUR APPLICATION" : "Current application"}</b></div><div className="target-card-actions">{selectedJob?.url && selectedJob.origin !== "demo_fixture" && <button className="text-action" onClick={() => openOfficialListing(selectedJob.url)}>Open source ↗</button>}<button className="text-action" onClick={adaptSelectedJob}>Edit job details</button></div></div><div className="target-body"><div className="company-seal">{selectedJob?.company.split(" ").map((word) => word[0]).join("").slice(0, 2)}</div><div className="target-copy"><h2>{selectedJob?.title}</h2><p>{selectedJob?.company} <i>·</i> {selectedJob?.location} <i>·</i> {selectedJob?.type}</p><small className="source-line">{sourceDetail(selectedJob)} · updated {selectedJob?.posted || "not disclosed"}</small><div className="role-tags">{roleSkills(selectedJob).slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}</div></div><div className="fit-summary"><div className="score-orbit" style={{ "--score": `${market?.score || 0}%` } as React.CSSProperties}><span>{market?.score || "—"}<small>{market ? "%" : "FIT"}</small></span></div><div><small>FIT CHECK</small><b>{market ? "Evidence mapped" : "Not assessed yet"}</b><p>{market ? `${directMatches} direct strengths found` : selectedIsPractice ? "Demo role for safe practice" : "Match this job with your CV"}</p></div></div></div></article>
          <section ref={workspacePanelRef} className="workspace-panel"><div className="panel-topline"><div><p className="kicker">{views.find((item) => item.id === view)?.number} / {views.find((item) => item.id === view)?.label?.toUpperCase()}</p><h2>{panelHeading(view, runState)}</h2></div><div className="live-context"><span className={cx("tiny-status", runState === "running" && "is-live")} />{activeAgent}</div></div>
            {view === "match" && <Suspense fallback={<DeferredPanelLoading eyebrow="FIT VIEW" label="Fit check is loading…" detail="Your workspace is ready — opening this role’s evidence view." />}><DeferredMatchPanel selectedJob={selectedJob} candidate={candidate} market={market} onStart={() => void startRehearsal()} onSampleStart={startSampleFitCheck} onImport={() => setShowIntake(true)} onReviewRole={() => selectedJob && void loadJobDetail(selectedJob.id)} onAddEvidence={addEvidenceForGap} onPracticeGap={practiceGap} isRoleLoading={loadingJobId === selectedJob?.id} runState={runState} canRun={canStartLiveAction} usingDemoProfile={usingDemoProfile} selectedIsPractice={Boolean(selectedIsPractice)} /></Suspense>}
            {view === "rehearse" && <Suspense fallback={<DeferredPanelLoading label="Loading practice workspace…" />}><DeferredRehearsalPanel turns={turns} currentTurn={currentTurn} runState={runState} onStart={() => void startRehearsal()} canRun={canStartLiveAction} focusGap={practiceFocus} /></Suspense>}
            {view === "tailor" && <Suspense fallback={<DeferredPanelLoading label="Loading revisions…" />}><DeferredTailorPanel patches={patches} coverLetter={coverLetter} coverLetterEvidenceIds={coverLetterEvidenceIds} showCoverLetter={showCoverLetter} onToggleCoverLetter={() => setShowCoverLetter((current) => !current)} onStart={() => void startRehearsal()} canRun={canStartLiveAction} runState={runState} /></Suspense>}
            {view === "review" && <Suspense fallback={<DeferredPanelLoading label="Loading review and export controls…" />}><DeferredReviewPanel runState={runState} patches={patches} gaps={market?.gaps || []} readiness={exportReadiness} selectedJob={selectedJob} onApprove={() => void approvePacket()} onExport={exportPacket} onOpenOfficial={openOfficialListing} serviceOnline={serviceOnline} isApproving={isApproving} isExporting={isExporting} /></Suspense>}
          </section>
          <section ref={shortlistRef} className="shortlist-card"><div className="section-heading"><div><p className="kicker">YOUR ROLE SHORTLIST</p><h2>{selectedIsPractice ? "Choose a demo role" : "Choose your current application"}</h2><p className="shortlist-helper">Review one role at a time. Public roles keep their source link; pasted roles stay marked as yours.</p></div><div className="shortlist-actions"><button className="primary-action small" onClick={() => void openRoleFinder()} disabled={runIsActive} aria-disabled={runIsActive}>Find public roles <span>↗</span></button><button className="outline-action small" onClick={openBlankJobForm} disabled={runIsActive} aria-disabled={runIsActive}>Paste a listing</button></div></div><div className="job-grid">{visibleJobs.map((job) => <button key={job.id} className={cx("job-tile", job.id === selectedJob?.id && "selected")} disabled={runIsActive} aria-label={runIsActive ? "Role switching is locked while the rehearsal runs" : `${job.id === selectedJob?.id ? (selectedIsPractice ? "Demo role" : "Current application") : "Review this role"} ${job.title} at ${job.company}`} onClick={() => selectRole(job.id)}><span className="job-tile-index">{String(jobs.indexOf(job) + 1).padStart(2, "0")}</span><div><b>{job.title}</b><p>{job.company} · {job.location}</p><small>{roleSkills(job).slice(0, 3).join(" · ") || "Open to review skills"}</small></div><i>{job.id === selectedJob?.id ? (selectedIsPractice ? "Demo role" : "Current application") : "Review this role"}</i></button>)}</div>{jobs.length > 3 && <div className="shortlist-footer"><button className="text-action" onClick={() => setShowAllJobs((current) => !current)}>{showAllJobs ? "Show fewer roles" : `Show ${jobs.length - 3} more role${jobs.length - 3 === 1 ? "" : "s"}`} <span>{showAllJobs ? "↑" : "↓"}</span></button><small>{visibleJobs.length} of {jobs.length} targets shown</small></div>}</section>
        </section>
        <aside className="insight-column"><section className="evidence-card"><div className="section-heading"><div><p className="kicker">YOUR WORK EXAMPLES</p><h2>Work you can stand behind</h2><p className="evidence-explainer">A work example is a real CV line or project that supports a skill or claim.</p></div><span className="count-pill">{candidate.evidence.length}</span></div><div className="evidence-meter"><div className="meter-number"><b>{market ? coverage : "—"}</b><span>{market ? "%" : "not checked"}</span></div><div className="meter-copy"><b>Coverage, not confidence.</b><p>{market ? "Direct evidence is kept separate from related experience." : "Check a role to see evidence coverage for its requirements."}</p></div></div><EvidenceGroup label="Direct evidence" tone="mint" items={market ? market.verified_strengths.map((item) => item.skill) : evidencePreviewSkills} /><EvidenceGroup label="Related experience" tone="amber" items={market ? market.adjacent_strengths.map((item) => item.skill) : []} /><EvidenceGroup label="Gaps to address" tone="coral" items={market ? market.gaps.map((item) => item.skill) : []} /></section>
          <section className="proof-card"><p className="kicker">EXAMPLE FROM YOUR EVIDENCE</p><blockquote>“{proofItem?.source_text || "Import or write a literal work statement to begin."}”</blockquote><div><span>Work example {proofItem?.evidence_id || "—"}</span><b>{proofItem ? "Source-linked" : "Needs a source"}</b></div></section>
          <section className="activity-card"><div className="section-heading"><div><p className="kicker">WORK LOG</p><h2>What just happened</h2></div><span className="log-count">{events.length}</span></div>{events.length ? <Suspense fallback={<div className="activity-empty">Loading recent workspace updates…</div>}><DeferredActivityStream events={events} /></Suspense> : <div className="activity-empty">Your work log will stay short, readable, and useful — not a wall of agent chatter.</div>}</section>
        </aside></div>
        </>}
      </div>
    </div>
    {showIntake && <Suspense fallback={<DeferredDialogLoading label="Loading profile editor…" />}><CandidateModal candidate={candidate} isDemoProfile={usingDemoProfile} onClose={() => setShowIntake(false)} onChange={updateCandidate} onRestore={() => { setCandidate(fallbackCandidate); setUsingDemoProfile(true); resetRun("match"); }} onAnalyze={() => void analyzeResume()} onUpload={(file) => void importResume(file)} isAnalyzing={isAnalyzing} isImporting={isImporting} serviceStatus={serviceStatus} runIsActive={runIsActive} /></Suspense>}
    {showJobForm && <Suspense fallback={<DeferredDialogLoading label="Loading role editor…" />}><JobModal title={manualTitle} company={manualCompany} location={manualLocation} url={manualUrl} description={manualDescription} onTitle={setManualTitle} onCompany={setManualCompany} onLocation={setManualLocation} onUrl={setManualUrl} onDescription={setManualDescription} onClose={() => setShowJobForm(false)} onSubmit={(event) => void addManualJob(event)} /></Suspense>}
    {showLiveFinder && <Suspense fallback={<DeferredDialogLoading label="Loading role search…" />}><LiveRolesModal onClose={() => setShowLiveFinder(false)} onDiscover={discoverPublicRoles} onConnect={connectPublicBoard} /></Suspense>}
    {showGuide && <Suspense fallback={<DeferredDialogLoading label="Loading guide…" />}><HowItWorksModal onClose={() => setShowGuide(false)} onOpenProfile={() => { setShowGuide(false); setShowIntake(true); }} onOpenLive={() => { setShowGuide(false); void openRoleFinder(); }} onOpenManual={() => { setShowGuide(false); openBlankJobForm(); }} /></Suspense>}
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

function DeferredPanelLoading({ label, detail, eyebrow = "PREPARING WORKSPACE" }: { label: string; detail?: string; eyebrow?: string }) {
  return <div className="deferred-panel-loading" role="status" aria-live="polite"><p className="kicker">{eyebrow}</p><b>{label}</b>{detail && <small>{detail}</small>}<div className="inline-skeleton" /><div className="inline-skeleton short" /></div>;
}

function HeroScene({ candidateName, evidenceCount, job, score, serviceStatus }: { candidateName: string; evidenceCount: number; job?: Job; score: number | null; serviceStatus: ServiceStatus }) {
  const scoreLabel = score === null ? "—" : `${score}%`;
  return <div className="hero-scene" aria-label={`A visual map from ${evidenceCount} evidence items to ${job?.title || "your target role"}`}>
    <div className="scene-aurora" /><div className="scene-grid" /><div className="scene-shadow" />
    <div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="scene-spark spark-one" /><span className="scene-spark spark-two" /><span className="scene-spark spark-three" />
    <article className="scene-card scene-evidence"><span className="scene-card-label"><i>✓</i> YOUR WORK EXAMPLES</span><b>{evidenceCount} work examples</b><p>Only source-linked work enters the flow.</p><div className="mini-bars"><i /><i /><i /></div></article>
    <article className="scene-core"><span className="core-halo" /><span className="core-orb">{scoreLabel}<small>{score === null ? "FIT CHECK" : "MAPPED"}</small></span><div><small>YOUR CASE</small><b>Evidence, not hype.</b></div></article>
    <article className="scene-card scene-role"><span className="scene-card-label"><i>↗</i> {job?.origin === "demo_fixture" ? "DEMO ROLE" : "CURRENT APPLICATION"}</span><b>{job?.title || "Choose a job"}</b><p>{job?.company || "Bring in a real listing"}</p><span className="scene-chip">{job?.origin === "demo_fixture" ? "Demo role" : "You approve everything"}</span></article>
    <article className="scene-person"><span>{initials(candidateName)}</span><div><small>APPLICANT</small><b>{candidateName}</b><p>{serviceStatus === "online" ? "Workspace ready" : serviceStatus === "checking" ? "Preparing workspace" : serviceStatus === "demo-only" ? "Sample-only workspace" : "Preview only · API unavailable"}</p></div></article>
  </div>;
}

function panelHeading(view: WorkspaceView, state: RunState) { if (view === "match") return "How well does your experience match this job?"; if (view === "rehearse") return state === "running" ? "Practice is in progress" : "Practice for this specific role"; if (view === "tailor") return "Turn your experience into application-ready proof"; return state === "approved" ? "Your packet is ready to use" : "Review before you use it"; }

function EvidenceGroup({ label, tone, items }: { label: string; tone: "mint" | "amber" | "coral"; items: string[] }) { return <section className={cx("evidence-group", tone)}><div><span /> <b>{label}</b><small>{items.length}</small></div><p>{items.slice(0, 3).join(" · ") || "No evidence yet"}</p></section>; }

function NavGlyph({ type }: { type: "grid" | "briefcase" | "search" | "chat" | "document" }) {
  if (type === "grid") return <svg viewBox="0 0 18 18"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="11" y="2" width="5" height="5" rx="1"/><rect x="2" y="11" width="5" height="5" rx="1"/><rect x="11" y="11" width="5" height="5" rx="1"/></svg>;
  if (type === "briefcase") return <svg viewBox="0 0 18 18"><rect x="2" y="5" width="14" height="10" rx="2"/><path d="M6 5V3.8c0-.7.5-1.3 1.2-1.3h3.6c.7 0 1.2.6 1.2 1.3V5M2 9h14M7.5 9v2h3V9"/></svg>;
  if (type === "search") return <svg viewBox="0 0 18 18"><circle cx="7.5" cy="7.5" r="4.5"/><path d="m11 11 4 4"/></svg>;
  if (type === "chat") return <svg viewBox="0 0 18 18"><path d="M3 3.5h12v8H8l-3.7 3V11.5H3z"/><path d="M6 6.8h6M6 9h3.5"/></svg>;
  return <svg viewBox="0 0 18 18"><path d="M5 2.5h6l2.5 2.5v10.5H5z"/><path d="M11 2.5V5h2.5M7 8h4M7 10.5h4M7 13h2.5"/></svg>;
}
