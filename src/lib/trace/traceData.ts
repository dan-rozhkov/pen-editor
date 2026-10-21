import type { BrowseTrace, BrowseTraceAction, BrowseTraceRequest, BrowseTraceStep } from "@sideform/browser-agent/agent/session";

// Pure readers of the newer trace fields (batched actions, the request log). Shared by the trace viewer and the
// agent's trace_read; they validate everything, because a trace file is untrusted input.

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ---- fields of newer recorders ---------------------------------------------

/** The actions of a batched `browse_act` that ran; undefined for older traces and other tools. */
export function stepActions(step: BrowseTraceStep): BrowseTraceAction[] | undefined {
  const raw: unknown = (step as { actions?: unknown }).actions;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(isRecord).flatMap((a) =>
    typeof a.action === "string" && typeof a.ok === "boolean" ? [{ action: a.action, ok: a.ok, ...(typeof a.error === "string" ? { error: a.error } : {}) }] : [],
  );
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The string-valued entries of a headers object; undefined when it is not one. */
function cleanHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"));
}

function cleanRequest(raw: unknown): BrowseTraceRequest | null {
  if (!isRecord(raw) || !isNum(raw.at) || typeof raw.method !== "string" || typeof raw.url !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const num = (v: unknown) => (isNum(v) ? v : undefined);
  return {
    at: raw.at,
    stepIndex: num(raw.stepIndex),
    method: raw.method,
    url: raw.url,
    type: str(raw.type),
    status: num(raw.status),
    error: str(raw.error),
    durationMs: num(raw.durationMs),
    size: num(raw.size),
    mimeType: str(raw.mimeType),
    requestHeaders: cleanHeaders(raw.requestHeaders),
    responseHeaders: cleanHeaders(raw.responseHeaders),
    responseBody: str(raw.responseBody),
    bodyTruncated: typeof raw.bodyTruncated === "boolean" ? raw.bodyTruncated : undefined,
  };
}

/** All recorded requests in time order; [] when the recorder did not keep them. */
export function traceRequests(trace: BrowseTrace): BrowseTraceRequest[] {
  const raw: unknown = (trace as { requests?: unknown }).requests;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => cleanRequest(r) ?? []).sort((a, b) => a.at - b.at);
}

/** How many requests the recorder's cap left out. */
export function droppedRequests(trace: BrowseTrace): number | undefined {
  const n = (trace.dropped as { requests?: unknown } | undefined)?.requests;
  return isNum(n) ? n : undefined;
}

export interface BatchProgress {
  /** Actions the call asked for. */
  total: number;
  ran: number;
  notRun: number;
}

/** What a batched act did: the actions asked for against the ones that ran. Null for a step that is not a batch. */
export function batchProgress(step: BrowseTraceStep): BatchProgress | null {
  const ran = stepActions(step);
  if (!ran) return null;
  const asked = isRecord(step.args) && Array.isArray(step.args.actions) ? step.args.actions.length : ran.length;
  const total = Math.max(asked, ran.length);
  return { total, ran: ran.length, notRun: total - ran.length };
}

export function requestFailed(request: BrowseTraceRequest): boolean {
  return !!request.error || (request.status !== undefined && request.status >= 400);
}
