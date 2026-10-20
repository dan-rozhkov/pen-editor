import { parseBrowseTrace, type BrowseTrace } from "@sideform/browser-agent/agent/session";
import { apiFetch } from "@/lib/apiBase";

export type TraceSource = "local" | "cloud";

export type TraceLoadResult =
  | { ok: true; trace: BrowseTrace }
  | { ok: false; reason: "not-found" | "invalid" | "no-bridge" | "error"; message: string };

/** `?src=` -> a source. Anything but "local" is the cloud. */
export function traceSourceFromParam(value: string | null): TraceSource {
  return value === "local" ? "local" : "cloud";
}

function validate(value: unknown): TraceLoadResult {
  const parsed = parseBrowseTrace(value);
  if ("error" in parsed) return { ok: false, reason: "invalid", message: parsed.error };
  return { ok: true, trace: parsed.trace };
}

async function loadLocal(id: string): Promise<TraceLoadResult> {
  const read = window.penDesktop?.traces?.read;
  if (!read) {
    return { ok: false, reason: "no-bridge", message: "Local traces open only inside the Sideform desktop app." };
  }
  const value = await read(id);
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") {
    const missing = /not found|no such|missing|enoent/i.test(value.error);
    return { ok: false, reason: missing ? "not-found" : "error", message: value.error };
  }
  if (!value || typeof value !== "object" || !("trace" in value)) {
    return { ok: false, reason: "invalid", message: "The desktop app returned an unexpected answer." };
  }
  return validate(value.trace);
}

async function loadCloud(id: string): Promise<TraceLoadResult> {
  const response = await apiFetch(`/api/browse/traces/${encodeURIComponent(id)}`);
  if (response.status === 404) return { ok: false, reason: "not-found", message: "This trace does not exist." };
  if (!response.ok) return { ok: false, reason: "error", message: `The server answered ${response.status}.` };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "invalid", message: "The response is not JSON." };
  }
  return validate(body);
}

/** Loads and validates a trace. Never rejects. */
export async function loadBrowseTrace(id: string, source: TraceSource): Promise<TraceLoadResult> {
  try {
    return source === "local" ? await loadLocal(id) : await loadCloud(id);
  } catch (error) {
    return { ok: false, reason: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
