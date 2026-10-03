import Link from "next/link";
import type { ReactNode } from "react";

export type IconName =
  | "arrow-right" | "arrow-up-right" | "briefcase" | "check" | "chevron-down"
  | "close" | "document" | "download" | "evidence" | "home" | "menu"
  | "plus" | "resume" | "settings" | "spark" | "team" | "warning" | "search"
  | "upload" | "refresh" | "external" | "lock" | "play";

export function Icon({ name, size = 18, stroke = 1.8, className = "" }: { name: IconName; size?: number; stroke?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className, "aria-hidden": true };
  const paths: Record<IconName, ReactNode> = {
    "arrow-right": <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    "arrow-up-right": <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></>,
    check: <path d="m5 12 4.2 4.2L19 6.5" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    document: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    evidence: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h4" /><path d="m8 9 1.2 1.2L11.5 8" /></>,
    home: <><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 22v-7h6v7" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    resume: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06A1.7 1.7 0 0 0 15.74 18a1.7 1.7 0 0 0-1.02 1.56v.09h-3v-.09A1.7 1.7 0 0 0 10.7 18a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 14.34a1.7 1.7 0 0 0-1.56-1.02h-.09v-3h.09A1.7 1.7 0 0 0 7 9.3a1.7 1.7 0 0 0-.34-1.88L6.6 7.36l2.12-2.12.06.06A1.7 1.7 0 0 0 10.66 5a1.7 1.7 0 0 0 1.02-1.56v-.09h3v.09A1.7 1.7 0 0 0 15.7 5a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19 8.66a1.7 1.7 0 0 0 1.56 1.02h.09v3h-.09A1.7 1.7 0 0 0 19.4 15Z" /></>,
    spark: <path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Zm7 14 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />,
    team: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 20a5 5 0 0 0-3-4.58" /></>,
    warning: <><path d="m10.3 3.2-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.7-2.8l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4" /><path d="M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" /></>,
    external: <><path d="M14 4h6v6M20 4 10 14" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    play: <path d="m8 5 11 7-11 7z" />,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return <Link href={href} className="hs-brand" aria-label="HireSwarm home">
    <span className="hs-brand-mark" aria-hidden="true"><i /><i /><i /></span>
    {!compact && <span>Hire<span>Swarm</span></span>}
  </Link>;
}

export function StatusDot({ state }: { state: "online" | "checking" | "offline" }) {
  const label = state === "online" ? "Workspace online" : state === "checking" ? "Checking workspace" : "Workspace unavailable";
  return <span className={`hs-service hs-service-${state}`} title={label}><i aria-hidden="true" />{state === "online" ? "Live" : state === "checking" ? "Checking" : "Offline"}</span>;
}
