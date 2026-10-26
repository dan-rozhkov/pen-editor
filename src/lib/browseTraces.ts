import { splitTraceAssets, type BrowseTrace } from "@sideform/browser-agent/agent/session";
import { apiFetch } from "@/lib/apiBase";
import { combineSignals } from "@/lib/abortSignals";
import { getRequestUserId } from "@/lib/auth/authState";
import type { BrowseTraceSavePayload, BrowseTraceSaveResult } from "@/lib/desktopBridge";

/** Longest wait for a trace save: a slow shell or network must not hold the tool result. */
export const TRACE_SAVE_TIMEOUT_MS = 15_000;

/** Kept free before the tool's outer timeout: the save must not push the result past it. */
export const TRACE_SAVE_SAFETY_MARGIN_MS = 5_000;

/** A cloud upload above this many characters (manifest JSON plus frame data URLs) loses frames first. */
export const TRACE_UPLOAD_MAX_CHARS = 20_000_000;

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

/** True when a trace of this run can be stored: a cloud run always (the backend decides), a desktop run only with a shell save bridge. */
export function canSaveBrowseTrace(desktop: boolean): boolean {
  return !desktop || desktopSave() !== undefined;
}

const payloadChars = (p: BrowseTraceSavePayload): number =>
  JSON.stringify(p.manifest).length + p.assets.reduce((sum, a) => sum + a.dataUrl.length, 0);

/**
 * Makes a payload fit `maxChars` by dropping frames: the first, the last and the frames of failed steps stay; the
 * rest are dropped evenly across the middle, as few as needed. The count goes to `manifest.dropped.frames`.
 * A payload that still does not fit with only the kept frames is returned as it is then. Pure.
 */
export function fitTracePayload(payload: BrowseTraceSavePayload, maxChars: number = TRACE_UPLOAD_MAX_CHARS): BrowseTraceSavePayload {
  if (payloadChars(payload) <= maxChars) return payload;
  const { manifest, assets } = payload;
  const failed = new Set(manifest.steps.filter((x) => !x.ok).map((x) => x.index));
  const droppable = manifest.frames.filter(
    (f, i) => i !== 0 && i !== manifest.frames.length - 1 && !(f.stepIndex !== undefined && failed.has(f.stepIndex)),
  );
  const build = (count: number): BrowseTraceSavePayload => {
    const gone = new Set<number>();
    for (let i = 0; i < count; i++) gone.add(droppable[Math.floor(((i + 0.5) * droppable.length) / count)]!.id);
    const frames = manifest.frames.filter((f) => !gone.has(f.id));
    // DOM snapshots are never dropped here: they are few, small text, and belong to failed steps.
    const paths = new Set([...frames.map((f) => f.src), ...(manifest.doms ?? []).map((d) => d.src)]);
    return {
      manifest: { ...manifest, frames, dropped: { ...manifest.dropped, frames: (manifest.dropped?.frames ?? 0) + gone.size } },
      assets: assets.filter((a) => paths.has(a.path)),
    };
  };
  for (let count = 1; count < droppable.length; count++) {
    const next = build(count);
    if (payloadChars(next) <= maxChars) return next;
  }
  return droppable.length > 0 ? build(droppable.length) : payload;
}

async function postCloud(payload: BrowseTraceSavePayload, signal: AbortSignal): Promise<string> {
  const userId = getRequestUserId();
  const res = await apiFetch("/api/browse/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(userId ? { userId } : {}), ...fitTracePayload(payload) }),
    signal,
  });
  if (!res.ok) throw new Error(`trace upload failed: ${res.status}`);
  const data = (await res.json()) as { id?: unknown };
  if (typeof data.id !== "string" || data.id === "") throw new Error("trace upload returned no id");
  return data.id;
}

export interface SaveBrowseTraceOptions {
  /** `Date.now()` value at which the tool's outer timeout ends. The save stops TRACE_SAVE_SAFETY_MARGIN_MS before it. */
  outerEnd?: number;
  /** The run's signal: on Stop the save is abandoned at once. */
  signal?: AbortSignal;
}

/**
 * Stores a finished trace and returns where it went. A desktop run (`desktop`) is saved
 * through the shell and never leaves the machine: a shell without `traces.save` stores
 * nothing. A cloud run is POSTed to /api/browse/traces. Bounded by the smaller of
 * TRACE_SAVE_TIMEOUT_MS and the time left before `outerEnd` (minus a margin; none left = no save).
 * A stop, a timeout or a failure only logs and resolves undefined. Never rejects.
 */
export async function saveBrowseTrace(trace: BrowseTrace, desktop: boolean, options: SaveBrowseTraceOptions = {}): Promise<SavedTrace | undefined> {
  const budget = Math.min(
    TRACE_SAVE_TIMEOUT_MS,
    options.outerEnd === undefined ? TRACE_SAVE_TIMEOUT_MS : options.outerEnd - Date.now() - TRACE_SAVE_SAFETY_MARGIN_MS,
  );
  if (budget <= 0 || options.signal?.aborted) return undefined;
  const stop = new AbortController();
  const signal = combineSignals([stop.signal, options.signal]);
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
      return { id: await postCloud(payload, signal), source: "cloud" };
    };
    // Rejects on the timeout or on Stop: the shell call (no signal) is then no longer waited for.
    const gone = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), budget);
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const pending = save();
    pending.catch(() => undefined);
    return await Promise.race([pending, gone]);
  } catch (error) {
    console.warn("[browse trace] not saved:", error instanceof Error ? error.message : error);
    return undefined;
  } finally {
    clearTimeout(timer);
    stop.abort();
  }
}
