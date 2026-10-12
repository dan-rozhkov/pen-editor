import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiBase";
import { isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";

let cloudEnabled: Promise<boolean> | null = null;

/** Whether the backend hosts a cloud browser (`GET /api/browser/config`). Asked once per page load. */
export function loadCloudBrowserEnabled(): Promise<boolean> {
  cloudEnabled ??= apiFetch("/api/browser/config")
    .then((res) => (res.ok ? res.json() : { enabled: false }))
    .then((body: unknown) => (body as { enabled?: unknown } | null)?.enabled === true)
    .catch(() => false);
  return cloudEnabled;
}

/** Test seam: forget the cached answer. */
export function resetCloudBrowserConfigCache(): void {
  cloudEnabled = null;
}

/** True when a browser agent can run: the desktop bridge, or an enabled cloud browser. */
export function useBrowserAgentAvailable(): boolean {
  const desktop = isDesktopBrowserAvailable();
  const [cloud, setCloud] = useState(false);
  useEffect(() => {
    if (desktop) return;
    let alive = true;
    void loadCloudBrowserEnabled().then((v) => {
      if (alive) setCloud(v);
    });
    return () => {
      alive = false;
    };
  }, [desktop]);
  return desktop || cloud;
}
