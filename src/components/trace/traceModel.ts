import type { BrowseTrace, BrowseTraceFrame, BrowseTraceLogEntry, BrowseTraceStep } from "@sideform/browser-agent/agent/session";

// Pure helpers of the trace viewer: no React, no DOM. Everything the UI
// shows that needs a decision (a summary text, a position on the time axis,
// which frame is "before") is computed here so it can be unit-tested.

export type Tone = "success" | "danger" | "warning" | "neutral";

/** Total run time in ms (never negative). */
export function traceDuration(trace: BrowseTrace): number {
  return Math.max(0, trace.endedAt - trace.startedAt);
}

export function stepDuration(step: BrowseTraceStep): number {
  return Math.max(0, step.endedAt - step.startedAt);
}

/** "840 ms", "3.2 s", "1 m 05 s". */
export function formatDuration(ms: number): string {
  const value = Math.max(0, Math.round(ms));
  if (value < 1000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes} m ${String(seconds).padStart(2, "0")} s`;
}

/** Offset from the run start for a frame or log row: "+0:03.2". */
export function formatOffset(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const rest = tenths % 600;
  return `+${minutes}:${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}`;
}

/** The offset without the sign, as a clock: "0:03.2". */
export function formatClock(ms: number): string {
  return formatOffset(ms).slice(1);
}

/** The first line of a goal, or "Untitled run". */
export function goalFirstLine(goal: string): string {
  return goal.trim().split(/\r?\n/)[0]!.trim() || "Untitled run";
}

/** "browse_act" -> "act"; other names stay as they are. */
export function toolLabel(tool: string): string {
  return tool.replace(/^browse_/, "");
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function clip(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** "https://example.com/a/b?x=1" -> "example.com/a/b". Falls back to the input. */
export function shortUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname === "/" ? "" : url.pathname;
    return clip(`${url.host}${path}`, 64);
  } catch {
    return clip(raw, 64);
  }
}

function describeAction(entry: Record<string, unknown>): string {
  const action = typeof entry.action === "string" ? entry.action : "act";
  const subject =
    typeof entry.target === "string"
      ? entry.target
      : typeof entry.element === "string"
        ? entry.element
        : typeof entry.index === "number"
          ? `#${entry.index}`
          : typeof entry.key === "string"
            ? entry.key
            : typeof entry.device === "string"
              ? entry.device
              : undefined;
  const text = typeof entry.text === "string" ? ` “${clip(entry.text, 32)}”` : "";
  return clip(`${action}${subject ? ` ${subject}` : ""}${text}`);
}

/** A short human summary of a step's arguments: "click Sign in", "example.com/pricing". */
export function summarizeArgs(tool: string, args: unknown): string {
  if (!isRecord(args)) return typeof args === "string" ? clip(args) : "";
  if (tool === "browse_open" && typeof args.url === "string") return shortUrl(args.url);
  if (tool === "browse_act") {
    if (Array.isArray(args.actions) && args.actions.length > 0) {
      const entries = args.actions.filter(isRecord);
      const first = entries[0] ? describeAction(entries[0]) : "";
      return args.actions.length > 1 ? `${first} +${args.actions.length - 1} more` : first;
    }
    return describeAction(args);
  }
  if (tool === "browse_tabs" && typeof args.action === "string") return args.action;
  if (typeof args.url === "string") return shortUrl(args.url);
  const firstString = Object.values(args).find((v): v is string => typeof v === "string");
  return firstString ? clip(firstString) : "";
}

export interface StepRow {
  step: BrowseTraceStep;
  label: string;
  summary: string;
  durationMs: number;
  /** 0..1 against the longest step. */
  ratio: number;
}

export function buildStepRows(trace: BrowseTrace): StepRow[] {
  const durations = trace.steps.map(stepDuration);
  const longest = Math.max(1, ...durations);
  return trace.steps.map((step, i) => ({
    step,
    label: toolLabel(step.tool),
    summary: summarizeArgs(step.tool, step.args),
    durationMs: durations[i]!,
    ratio: durations[i]! / longest,
  }));
}

export interface Outcome {
  label: string;
  tone: Tone;
}

/** The headline badge: the QA outcome when there is one, else the run status. */
export function describeOutcome(trace: BrowseTrace): Outcome {
  if (trace.qa) {
    switch (trace.qa.outcome) {
      case "passed":
        return { label: "QA passed", tone: "success" };
      case "failed":
        return { label: "QA failed", tone: "danger" };
      case "inconclusive":
        return { label: "QA inconclusive", tone: "warning" };
      case "setup_failed":
        return { label: "Setup failed", tone: "danger" };
      case "error":
        return { label: "QA error", tone: "danger" };
      case "aborted":
        return { label: "Aborted", tone: "neutral" };
    }
  }
  const status = trace.status.toLowerCase();
  const label = status.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  if (status === "done" || status === "completed" || status === "success") return { label: "Done", tone: "success" };
  if (/error|fail/.test(status)) return { label, tone: "danger" };
  if (/abort|cancel|timeout|limit|stopped/.test(status)) return { label, tone: "warning" };
  return { label: label || "Unknown", tone: "neutral" };
}

/** "cloud" -> "Cloud browser", "desktop" -> "Desktop browser"; a run in a desktop app -> the app's name. */
export function browserLabel(trace: BrowseTrace): string | undefined {
  const app = trace.labels?.app;
  if (app) return app;
  const browser = trace.labels?.browser;
  if (!browser) return undefined;
  if (browser === "cloud") return "Cloud browser";
  if (browser === "desktop") return "Desktop browser";
  return browser;
}

// ---- frames ----------------------------------------------------------------

/** Frames in time order (stable for equal times). */
export function sortedFrames(trace: BrowseTrace): BrowseTraceFrame[] {
  return [...trace.frames].sort((a, b) => a.at - b.at || a.id - b.id);
}

/** The last frame that belongs to a step; falls back to the latest frame taken before the step ended. */
export function lastFrameOfStep(trace: BrowseTrace, stepIndex: number): BrowseTraceFrame | undefined {
  const frames = sortedFrames(trace);
  const own = frames.filter((f) => f.stepIndex === stepIndex);
  if (own.length > 0) return own[own.length - 1];
  const step = trace.steps.find((s) => s.index === stepIndex);
  if (!step) return undefined;
  const earlier = frames.filter((f) => f.at <= step.endedAt);
  return earlier[earlier.length - 1];
}

/** The step a frame should select: its own, else the step running (or last finished) at that time. */
export function stepOfFrame(trace: BrowseTrace, frame: BrowseTraceFrame): number | undefined {
  if (frame.stepIndex !== undefined && trace.steps.some((s) => s.index === frame.stepIndex)) return frame.stepIndex;
  let found: number | undefined;
  for (const step of trace.steps) if (step.startedAt <= frame.at) found = step.index;
  return found;
}

// ---- timeline --------------------------------------------------------------

export interface Timeline {
  /** Axis length in ms (at least 1). */
  span: number;
  frames: { frame: BrowseTraceFrame; pct: number }[];
  steps: { index: number; startPct: number; widthPct: number; ok: boolean }[];
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** The last moment of the run: the end, or the latest frame or step end if one lies beyond it. */
export function traceEnd(trace: BrowseTrace): number {
  return Math.max(trace.startedAt, trace.endedAt, ...trace.frames.map((f) => f.at), ...trace.steps.map((s) => s.endedAt));
}

export function buildTimeline(trace: BrowseTrace): Timeline {
  const span = Math.max(1, traceEnd(trace) - trace.startedAt);
  const pct = (at: number) => clampPct(((at - trace.startedAt) / span) * 100);
  return {
    span,
    frames: sortedFrames(trace).map((frame) => ({ frame, pct: pct(frame.at) })),
    steps: trace.steps.map((step) => {
      const startPct = pct(step.startedAt);
      return { index: step.index, startPct, widthPct: Math.max(0.4, pct(step.endedAt) - startPct), ok: step.ok };
    }),
  };
}

// ---- logs ------------------------------------------------------------------

export function entriesOfStep(entries: BrowseTraceLogEntry[], stepIndex: number): BrowseTraceLogEntry[] {
  return entries.filter((e) => e.stepIndex === stepIndex);
}

/** Step indexes that have a console or network entry, for the markers on steps and the filmstrip. */
export function stepsWithProblems(trace: BrowseTrace): Set<number> {
  const out = new Set<number>();
  for (const step of trace.steps) if (!step.ok) out.add(step.index);
  for (const entry of [...trace.console, ...trace.network]) if (entry.stepIndex !== undefined) out.add(entry.stepIndex);
  return out;
}

/** Parses the `output` text of a step as JSON when it is JSON; else returns it as it is. */
export function prettyText(text: string | undefined): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function prettyJson(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/** The document title: the goal, cut short (doc and canvas tabs use the plain name too). */
export function traceTitle(goal: string): string {
  return clip(goalFirstLine(goal), 60);
}

// ---- QA and log rows -------------------------------------------------------

/** One-line text of a QA check: "Text “Pro” is visible", "URL contains /pricing". */
export function describeCheck(check: unknown): string {
  if (!isRecord(check) || typeof check.type !== "string") return "Check";
  const where = typeof check.selector === "string" ? check.selector : typeof check.index === "number" ? `element #${check.index}` : "element";
  switch (check.type) {
    case "text":
      return `Text “${clip(String(check.text ?? ""), 48)}” is ${check.absent ? "absent" : "visible"}`;
    case "element":
      return `${clip(where, 48)} is ${String(check.state ?? "visible")}`;
    case "value": {
      const rule = check.equals !== undefined ? `equals “${String(check.equals)}”` : check.contains !== undefined ? `contains “${String(check.contains)}”` : "has a value";
      return `${clip(where, 40)} ${rule}`;
    }
    case "count":
      return `${clip(where, 40)} count ${check.equals !== undefined ? `= ${String(check.equals)}` : `${check.min !== undefined ? `≥ ${String(check.min)}` : ""} ${check.max !== undefined ? `≤ ${String(check.max)}` : ""}`.trim()}`;
    case "url": {
      if (check.equals !== undefined) return `URL equals ${String(check.equals)}`;
      if (check.contains !== undefined) return `URL contains ${String(check.contains)}`;
      return `URL matches ${String(check.matches ?? "")}`;
    }
    case "no_console_errors":
      return "No console errors";
    case "no_failed_requests":
      return "No failed requests";
    default:
      return check.type.replace(/_/g, " ");
  }
}

export interface NetworkRow {
  method: string;
  status: string;
  url: string;
  /** True for 4xx, 5xx and transport errors. */
  failed: boolean;
}

/** Splits "<METHOD> <status|error> <url>"; null when the text has another shape. */
export function parseNetworkEntry(text: string): NetworkRow | null {
  const match = /^([A-Z]+)\s+(\S+)\s+(.+)$/.exec(text.trim());
  if (!match) return null;
  const status = match[2]!;
  const code = Number(status);
  return { method: match[1]!, status, url: match[3]!, failed: !Number.isFinite(code) || code >= 400 };
}

// ---- layout ----------------------------------------------------------------

/**
 * Left edges for items of equal `size` wanted at `centers` (px) inside
 * `total` px: each item stays as close to its center as it can without
 * overlapping its neighbour, and never leaves [0, total]. Needs
 * `n * (size + gap) - gap <= total`; a narrower `total` is treated as that minimum.
 */
export function spreadPositions(centers: number[], size: number, gap: number, total: number): number[] {
  const n = centers.length;
  if (n === 0) return [];
  const step = size + gap;
  const room = Math.max(total, n * step - gap);
  const left = centers.map((c) => c - size / 2);
  for (let i = 0; i < n; i++) left[i] = Math.max(i === 0 ? 0 : left[i - 1]! + step, left[i]!);
  for (let i = n - 1; i >= 0; i--) {
    const limit = i === n - 1 ? room - size : left[i + 1]! - step;
    left[i] = Math.min(left[i]!, limit);
  }
  for (let i = 0; i < n; i++) left[i] = Math.max(i === 0 ? 0 : left[i - 1]! + step, left[i]!);
  return left;
}
