import { parseBrowseTrace, type BrowseTrace, type BrowseTraceRequest, type BrowseTraceStep } from "@sideform/browser-agent/agent/session";
import type { ToolHandler } from "../toolRegistry";
import { getAgentPanelTraceTabsBridge } from "../agentPanel";
import { readTraceFrame } from "@/lib/trace/traceFrame";
import { placeImageRect } from "./browser/placeOnCanvas";
import { batchProgress, droppedRequests, requestFailed, stepActions, traceRequests } from "@/lib/trace/traceData";

// Panel-local (canvasLink/canvasTools.ts, prefix "trace_"): the agent reads the browse-run traces the
// desktop shell has open in trace tabs. Advertised by the backend only when
// clientCapabilities.traceTabs is true. Output: JSON string, `{"error": "..."}` on failure.
// trace_read returns a bounded TEXT summary: never screenshots, data URLs or asset paths. Its `frames` index
// ({total, shown: [{frameId, step, kind}]}) names the frames trace_frame can fetch as an image.

const err = (message: string): string => JSON.stringify({ error: message });

const MAX_TOTAL_CHARS = 30_000;
const MAX_TEXT = 300;
const MAX_ARGS = 200;
const MAX_OUTPUT = 600;
const MAX_FRAMES = 60;

/** List caps. Halved until the summary fits MAX_TOTAL_CHARS. */
interface Caps {
  steps: number;
  qaChecks: number;
  logEntries: number;
  labels: number;
  frames: number;
}
const FULL_CAPS: Caps = { steps: 60, qaChecks: 30, logEntries: 20, labels: 20, frames: MAX_FRAMES };

/** Any `data:<type>/<subtype>...` URL, up to the next whitespace or quote (base64 or percent-encoded, with parameters). */
const DATA_URL = /data:[a-z]+\/[a-z0-9.+-]+[^\s"'`<>)]*/gi;

/** Cuts a string, removes data URLs and says how much is gone. */
function clip(value: unknown, max = MAX_TEXT): string {
  let raw: string;
  try {
    raw = String(value ?? "");
  } catch {
    return "";
  }
  const text = raw.replace(DATA_URL, "[image omitted]");
  return text.length > max ? `${text.slice(0, max)}... [${text.length - max} more chars]` : text;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Runs `fn`; a throw gives undefined, so one bad field is dropped and not the whole read. */
function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** An object with only the fields whose value is not undefined. Each field is computed in isolation. */
function pick(fields: Record<string, () => unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, fn] of Object.entries(fields)) {
    const value = safe(fn);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function argsSummary(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  const json = JSON.stringify(args);
  if (!json || json === "{}") return undefined;
  return clip(json, MAX_ARGS);
}

/** The first http(s) URL in the step's args or output, when there is one. */
function stepUrl(args: unknown, output: unknown): string | undefined {
  const fromArgs = isObj(args) ? args.url : undefined;
  if (typeof fromArgs === "string" && /^https?:/i.test(fromArgs)) return clip(fromArgs, 500);
  const match = typeof output === "string" ? output.match(/"url"\s*:\s*"(https?:[^"]+)"/) : null;
  return match ? clip(match[1], 500) : undefined;
}

/** A list with its entries mapped once; `render` slices the precomputed entries. */
interface Prepared {
  total: number;
  entries: unknown[];
  dropped?: number;
}
function prepare<T>(items: unknown, max: number, map: (item: T) => unknown, dropped?: unknown): Prepared {
  const list = Array.isArray(items) ? (items as T[]).filter((i) => i !== null && i !== undefined) : [];
  return {
    total: list.length,
    entries: list.slice(0, max).map((item) => safe(() => map(item)) ?? {}),
    ...(finite(dropped) && dropped > 0 ? { dropped } : {}),
  };
}
/** `newestFirst`: the entries were prepared newest first; the newest `max` are shown, oldest of them first. */
function render(p: Prepared, max: number, newestFirst = false) {
  const shown = p.entries.slice(0, max);
  if (newestFirst) shown.reverse();
  const omitted = p.total - shown.length;
  return { total: p.total, shown, ...(omitted > 0 ? { omitted } : {}), ...(p.dropped ? { droppedByRecorder: p.dropped } : {}) };
}

function frameEntry(f: Record<string, unknown>): Record<string, unknown> {
  if (!isObj(f)) return {};
  return pick({
    frameId: () => (finite(f.id) ? f.id : undefined),
    step: () => (finite(f.stepIndex) ? f.stepIndex : undefined),
    kind: () => (typeof f.kind === "string" ? clip(f.kind, 20) : undefined),
  });
}

/** Everything that does not depend on the caps, computed once. */
interface PreparedSummary {
  head: Record<string, unknown>;
  labels: [string, string][];
  steps: Prepared;
  console: Prepared;
  network: Prepared;
  /** The recorder's request log, failed requests first. Absent when the trace has none. */
  requests?: { failed: number; list: Prepared };
  /** Newest first: the last frames matter most (the final screenshot). */
  frames: Prepared;
  qa?: { head: Record<string, unknown>; checks: Prepared };
}

/** "1/5 ok, 3 not run, failed: <action - error>" for a batched act; undefined when the step has no action list. */
function actionsSummary(step: BrowseTraceStep): string | undefined {
  const progress = batchProgress(step);
  const actions = stepActions(step);
  if (!progress || !actions?.length) return undefined;
  const ok = actions.filter((a) => a.ok).length;
  const failed = actions.find((a) => !a.ok);
  return [
    `${ok}/${progress.total} ok`,
    ...(progress.notRun > 0 ? [`${progress.notRun} not run`] : []),
    ...(failed ? [`failed: ${clip(`${failed.action}${failed.error ? ` - ${failed.error}` : ""}`, 160)}`] : []),
  ].join(", ");
}

function prepareRequests(trace: BrowseTrace): PreparedSummary["requests"] {
  if (!Array.isArray((trace as { requests?: unknown }).requests)) return undefined;
  const failed: BrowseTraceRequest[] = [];
  const rest: BrowseTraceRequest[] = [];
  for (const r of traceRequests(trace)) (requestFailed(r) ? failed : rest).push(r);
  const failedFirst = [...failed, ...rest];
  const dropped = droppedRequests(trace);
  return {
    failed: failed.length,
    list: prepare<BrowseTraceRequest>(
      failedFirst,
      FULL_CAPS.logEntries,
      (r) =>
        pick({
          step: () => r.stepIndex,
          method: () => clip(r.method, 16),
          ...(r.error ? { error: () => clip(r.error, 120) } : { status: () => r.status }),
          url: () => clip(r.url, 200),
          ms: () => (r.durationMs === undefined ? undefined : Math.round(r.durationMs)),
        }),
      dropped,
    ),
  };
}

function prepareSummary(trace: BrowseTrace): PreparedSummary {
  const t = trace as unknown as Record<string, unknown>;
  const dropped = isObj(t.dropped) ? t.dropped : {};
  const logEntry = (e: Record<string, unknown>) =>
    pick({ step: () => (finite(e.stepIndex) ? e.stepIndex : undefined), text: () => clip(e.text) });
  const qa = isObj(t.qa) ? t.qa : undefined;
  return {
    head: pick({
      traceId: () => clip(t.id, 200),
      goal: () => clip(t.goal, 1000),
      status: () => (typeof t.status === "string" ? clip(t.status, 60) : undefined),
      answer: () => (t.answer ? clip(t.answer, 1000) : undefined),
      error: () => (t.error ? clip(t.error, 500) : undefined),
      startedAt: () => (finite(t.startedAt) ? new Date(t.startedAt).toISOString() : undefined),
      durationMs: () => (finite(t.startedAt) && finite(t.endedAt) ? Math.max(0, t.endedAt - t.startedAt) : undefined),
    }),
    labels: safe(() => (isObj(t.labels) ? Object.entries(t.labels).map(([k, v]): [string, string] => [clip(k, 60), clip(v, 120)]) : [])) ?? [],
    steps: prepare<Record<string, unknown>>(
      t.steps,
      FULL_CAPS.steps,
      (s) => {
        const url = safe(() => stepUrl(s.args, s.output));
        return pick({
          index: () => (finite(s.index) ? s.index : undefined),
          tool: () => (typeof s.tool === "string" ? clip(s.tool, 100) : undefined),
          ok: () => (typeof s.ok === "boolean" ? s.ok : undefined),
          args: () => argsSummary(s.args),
          output: () => (s.output ? clip(s.output, MAX_OUTPUT) : undefined),
          error: () => (s.error ? clip(s.error) : undefined),
          actions: () => actionsSummary(s as unknown as BrowseTraceStep),
          url: () => url,
          ms: () => (finite(s.startedAt) && finite(s.endedAt) ? Math.max(0, s.endedAt - s.startedAt) : undefined),
        });
      },
      dropped.steps,
    ),
    console: prepare<Record<string, unknown>>(t.console, FULL_CAPS.logEntries, logEntry, dropped.console),
    network: prepare<Record<string, unknown>>(t.network, FULL_CAPS.logEntries, logEntry, dropped.network),
    requests: safe(() => prepareRequests(trace)),
    // Ids only, never `src`: doc_insert_image takes traceId + frameId.
    frames: prepare<Record<string, unknown>>(Array.isArray(t.frames) ? [...t.frames].reverse() : [], FULL_CAPS.frames, frameEntry),
    ...(qa
      ? {
          qa: {
            head: pick({
              outcome: () => (typeof qa.outcome === "string" ? clip(qa.outcome, 60) : undefined),
              verdict: () => (qa.verdict ? clip(qa.verdict, 60) : undefined),
              reason: () => (qa.reason ? clip(qa.reason, 500) : undefined),
              judge: () => {
                const j = qa.judge;
                if (!isObj(j)) return undefined;
                if ("error" in j) return { error: clip(j.error) };
                return pick({ verdict: () => (j.verdict ? clip(j.verdict, 60) : undefined), reason: () => (j.reason ? clip(j.reason, 500) : undefined) });
              },
            }),
            checks: prepare<Record<string, unknown>>(
              Array.isArray(qa.checks) ? qa.checks.filter(isObj) : [],
              FULL_CAPS.qaChecks,
              (c) =>
                pick({
                  source: () => (typeof c.source === "string" ? clip(c.source, 60) : undefined),
                  passed: () => (typeof c.passed === "boolean" ? c.passed : undefined),
                  check: () => clip(JSON.stringify(c.check), MAX_ARGS),
                  actual: () => (c.actual ? clip(c.actual) : undefined),
                  error: () => (c.error ? clip(c.error) : undefined),
                }),
            ),
          },
        }
      : {}),
  };
}

function omitTotal({ total: _total, ...rest }: ReturnType<typeof render>) {
  return rest;
}

function renderSummary(p: PreparedSummary, caps: Caps): Record<string, unknown> {
  const labels = p.labels.slice(0, caps.labels);
  const labelsOmitted = p.labels.length - labels.length;
  return {
    ...p.head,
    ...(labels.length ? { labels: Object.fromEntries(labels) } : {}),
    ...(labelsOmitted > 0 ? { labelsOmitted } : {}),
    steps: render(p.steps, caps.steps),
    ...(p.frames.total > 0 ? { frames: render(p.frames, caps.frames, true) } : {}),
    consoleErrors: render(p.console, caps.logEntries),
    // With a request log the failures are listed there; the console-derived list shrinks to its count.
    failedRequests: p.requests ? { total: p.network.total } : render(p.network, caps.logEntries),
    ...(p.requests ? { requests: { total: p.requests.list.total, failed: p.requests.failed, ...omitTotal(render(p.requests.list, caps.logEntries)) } } : {}),
    ...(p.qa ? { qa: { ...p.qa.head, checks: render(p.qa.checks, caps.qaChecks) } } : {}),
  };
}

export function summarizeTrace(trace: BrowseTrace, caps: Caps = FULL_CAPS): Record<string, unknown> {
  return renderSummary(prepareSummary(trace), caps);
}

export const traceList: ToolHandler = async () => {
  const bridge = getAgentPanelTraceTabsBridge();
  if (!bridge) return err("Trace tabs are not available here (desktop app only).");
  try {
    const result: unknown = await bridge.listTabs();
    if (!isObj(result)) return err("The desktop app returned an unexpected answer.");
    if ("error" in result) return err(clip(result.error));
    const raw = Array.isArray(result.tabs) ? result.tabs : [];
    const tabs = raw
      .filter((t): t is Record<string, unknown> => isObj(t) && typeof t.traceId === "string")
      .map((t) => ({ traceId: t.traceId as string, title: clip(typeof t.title === "string" ? t.title : "Trace", 200), active: t.active === true }));
    return JSON.stringify({ tabs });
  } catch (e) {
    return err(clip(e instanceof Error ? e.message : "The trace tabs could not be listed.", 500));
  }
};

export const traceOpen: ToolHandler = async (args) => {
  const traceId = typeof args?.traceId === "string" ? args.traceId.trim() : "";
  if (!traceId) return err("traceId is required. Use `trace.id` from the browse_agent result, or call trace_list to see the open trace tabs.");
  const bridge = getAgentPanelTraceTabsBridge();
  if (!bridge || typeof bridge.open !== "function") return err("Trace tabs are not available here (desktop app only).");
  try {
    // Check first, so the agent does not open a tab for a trace that is not stored.
    const found: unknown = await bridge.read(traceId, { frames: false });
    if (isObj(found) && typeof found.error === "string" && found.error) return err(clip(found.error));
    if (!isObj(found) || !found.trace) return err(`No trace with this id is stored: ${clip(traceId, 100)}`);
    const result: unknown = await bridge.open(traceId);
    if (isObj(result) && result.ok === true) return JSON.stringify({ traceId, opened: true });
    return err(isObj(result) && typeof result.error === "string" && result.error ? clip(result.error) : "The trace tab could not be opened.");
  } catch (e) {
    return err(clip(e instanceof Error ? e.message : "The trace tab could not be opened.", 500));
  }
};

export const traceRead: ToolHandler = async (args) => {
  const traceId = typeof args?.traceId === "string" ? args.traceId.trim() : "";
  if (!traceId) return err("traceId is required. Use `trace.id` from the browse_agent result, or call trace_list to see the open trace tabs.");
  const bridge = getAgentPanelTraceTabsBridge();
  if (!bridge) return err("Trace tabs are not available here (desktop app only).");
  try {
    // frames: false — the summary never uses images, so the shell skips loading them (10-25 MB of base64).
    const result = await bridge.read(traceId, { frames: false });
    if (!result || typeof result !== "object") return err("The desktop app returned an unexpected answer.");
    if ("error" in result) return err(clip(result.error));
    const parsed = parseBrowseTrace(result.trace);
    if ("error" in parsed) return err(`The trace is not valid: ${clip(parsed.error)}`);
    const prepared = prepareSummary(parsed.trace);
    let caps = FULL_CAPS;
    let text = JSON.stringify(renderSummary(prepared, caps));
    // Halve the list caps until it fits (the summary says how many entries it left out).
    for (let i = 0; i < 6 && text.length > MAX_TOTAL_CHARS; i++) {
      caps = { steps: Math.floor(caps.steps / 2), qaChecks: Math.floor(caps.qaChecks / 2), logEntries: Math.floor(caps.logEntries / 2), labels: Math.floor(caps.labels / 2), frames: Math.floor(caps.frames / 2) };
      text = JSON.stringify(renderSummary(prepared, caps));
    }
    return text.length > MAX_TOTAL_CHARS ? err(`The trace summary is too large (${text.length} chars).`) : text;
  } catch (e) {
    return err(clip(e instanceof Error ? e.message : "The trace could not be read.", 500));
  }
};

/** A frame id as the model may send it: an integer, or an integer in a string. */
function parseFrameId(raw: unknown): number | undefined {
  const n = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * trace_frame: one frame of a trace as an image, in browse_screenshot's result shape (`imageData` data URL, which the
 * backend's toModelOutput turns into an image part). `placeOnCanvas` also puts it on the canvas (`placedNodeId`).
 * Cost: the shell loads ALL frame images of the trace for this one read.
 */
export const traceFrame: ToolHandler = async (args, context) => {
  const traceId = typeof args?.traceId === "string" ? args.traceId.trim() : "";
  if (!traceId) return err("traceId is required. Use `trace.id` from the browse_agent result, or call trace_list to see the open trace tabs.");
  const frameId = parseFrameId(args?.frameId);
  if (frameId === undefined) return err("frameId must be an integer from 0. Call trace_read and take it from frames.shown[].frameId.");
  let frame;
  try {
    frame = await readTraceFrame(traceId, frameId);
  } catch (e) {
    return err(clip(e instanceof Error ? e.message : "The frame could not be read.", 500));
  }
  const isData = frame.src.startsWith("data:");
  const out: Record<string, unknown> = {
    traceId,
    frameId: frame.id,
    kind: frame.kind,
    ...(frame.stepIndex !== undefined ? { stepIndex: frame.stepIndex } : {}),
    ...(frame.width && frame.height ? { width: frame.width, height: frame.height } : {}),
    ...(isData ? { imageData: frame.src } : { imageUrl: frame.src }),
  };
  if (args?.placeOnCanvas !== true) return JSON.stringify(out);
  // The image is in hand: a failed placement is reported next to it.
  try {
    const placed = await placeImageRect(frame.src, frame as unknown as Record<string, unknown>, `Trace frame ${frame.id}${typeof frame.stepIndex === "number" ? ` · step ${frame.stepIndex}` : ""}`, args, context?.signal, context?.sessionId);
    if (!placed) return JSON.stringify({ ...out, placeError: "Placing the frame was aborted." });
    return JSON.stringify({ ...out, placedNodeId: placed.id, placedAt: { x: placed.x, y: placed.y, width: placed.width, height: placed.height } });
  } catch (e) {
    return JSON.stringify({ ...out, placeError: clip(e instanceof Error ? e.message : "Placing the frame failed.", 500) });
  }
};
