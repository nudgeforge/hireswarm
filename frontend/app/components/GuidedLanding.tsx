"use client";

import { useEffect, useState } from "react";
import { GuidedStart, type GuidedStage } from "./GuidedStart";

type ServiceStatus = "checking" | "online" | "offline" | "demo-only";

const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE;
const API = configuredApiBase === undefined ? "/backend" : configuredApiBase.replace(/\/+$/, "");

/**
 * Intentionally small first-visit shell. The application workspace is loaded
 * only after a person chooses a starting point, so the opening experience is
 * clear and the browser does not parse the complete editing workflow merely to
 * render a welcome screen.
 */
export default function GuidedLanding() {
  const [stage, setStage] = useState<GuidedStage>("welcome");
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("checking");

  async function checkService() {
    setServiceStatus("checking");
    try {
      const response = await fetch(`${API}/healthz`);
      const health = await response.json() as { ok?: boolean };
      if (!response.ok || !health.ok) throw new Error("not ready");
      setServiceStatus("online");
    } catch {
      setServiceStatus("offline");
    }
  }

  useEffect(() => { void checkService(); }, []);

  function moveTo(path: string) {
    window.location.assign(path);
  }

  return <GuidedStart
    stage={stage}
    serviceStatus={serviceStatus}
    isActionChecking={false}
    onRetry={() => void checkService()}
    // One clear first action: the workspace itself now begins with CV upload.
    // Do not put a new job seeker through another chooser before that.
    onStart={() => moveTo("/workspace")}
    onExploreDemo={() => moveTo("/workspace?demo=1")}
    onChooseCv={() => moveTo("/workspace?entry=profile")}
    onChooseRole={() => moveTo("/workspace?entry=role")}
    onChooseSearch={() => moveTo("/workspace?entry=role&finder=1")}
    onOpenCv={() => moveTo("/workspace?entry=profile")}
    onFindRoles={() => moveTo("/workspace?entry=role")}
    onPasteRole={() => moveTo("/workspace?entry=role")}
    onUseDemoRole={() => moveTo("/workspace?demo=1")}
    onBack={() => setStage("welcome")}
  />;
}
