import { splitTraceAssets, type BrowseTrace } from "@sideform/browser-agent/agent/session";
import { apiFetch } from "@/lib/apiBase";
import { getRequestUserId } from "@/lib/auth/authState";
import type { BrowseTraceSavePayload, BrowseTraceSaveResult } from "@/lib/desktopBridge";

/** Longest wait for a trace save: a slow shell or network must not hold the tool result. */
export const TRACE_SAVE_TIMEOUT_MS = 15_000;

/** Where a saved trace lives: on this desktop ("local") or in the backend bucket ("cloud"). */
export type TraceSource = "local" | "cloud";

export interface SavedTrace {
  id: string;
  source: TraceSource;
}

/** The shell's save function, panel first. Undefined on the web or on an older shell. */
function desktopSave(): ((payload: BrowseTraceSavePayload) => Promise<BrowseTraceSaveResult>) | undefined {
  const panel = window.penAgentPanel?.traces?.save;
  if (panel) return panel.bind(window.penAgentPanel!.traces);
  const tab = window.penDesktop?.traces?.save;
  return tab ? tab.bind(window.penDesktop!.traces) : undefined;
}

async function postCloud(payload: BrowseTraceSavePayload): Promise<string> {
  const userId = getRequestUserId();
  const res = await apiFetch("/api/browse/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(userId ? { userId } : {}), ...payload }),
  });
  if (!res.ok) throw new Error(`trace upload failed: ${res.status}`);
  const data = (await res.json()) as { id?: unknown };
  if (typeof data.id !== "string" || data.id === "") throw new Error("trace upload returned no id");
  return data.id;
}

/**
 * Stores a finished trace and returns where it went. A desktop run (`desktop`) is saved
 * through the shell and never leaves the machine: a shell without `traces.save` stores
 * nothing. A cloud run is POSTed to /api/browse/traces. Bounded by TRACE_SAVE_TIMEOUT_MS;
 * a failure only logs and resolves undefined. Never rejects.
 */
export async function saveBrowseTrace(trace: BrowseTrace, desktop: boolean): Promise<SavedTrace | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const save = async (): Promise<SavedTrace | undefined> => {
      const payload = splitTraceAssets(trace);
      if (desktop) {
        const fn = desktopSave();
        if (!fn) return undefined;
        const out = await fn(payload);
        if ("error" in out) throw new Error(out.error);
        return { id: out.id, source: "local" };
      }
      return { id: await postCloud(payload), source: "cloud" };
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), TRACE_SAVE_TIMEOUT_MS);
    });
    return await Promise.race([save(), timeout]);
  } catch (error) {
    console.warn("[browse trace] not saved:", error instanceof Error ? error.message : error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
