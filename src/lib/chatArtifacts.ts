import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { SavedTrace } from "@/lib/browseTraces";
import { getAgentPanelCanvasBridge, getAgentPanelDocsBridge } from "@/lib/agentPanel";
import { runsInCanvasTab } from "@/lib/canvasLink/canvasTools";
import { traceOpener } from "@/lib/traceOpener";

export type ChatArtifactKind = "doc" | "canvas" | "trace";

export interface ChatArtifact {
  kind: ChatArtifactKind;
  /** docId, String(tabId) or traceId. */
  id: string;
  title: string;
  source?: "local" | "cloud";
  tabId?: number;
  /** Docs only: a docTitle resolver was given and found no document (deleted). */
  missing?: boolean;
}

export interface CollectDeps {
  /** Live document title; wins over the title recorded in the tool output. undefined = the document no longer exists. */
  docTitle?: (docId: string) => string | undefined;
  /** The canvas tab a tool call ran in (PanelClient.tabForCall); null/undefined = unknown or gone. */
  tabForCall?: (toolCallId: string) => number | null | undefined;
}

const DOC_TOOLS: ReadonlySet<string> = new Set(["doc_create", "doc_edit", "doc_read", "doc_open", "doc_insert_image"]);
const FALLBACK_DOC_TITLE = "Untitled document";
const FALLBACK_CANVAS_TITLE = "Canvas";
const FALLBACK_TRACE_TITLE = "Trace";

type Rec = Record<string, unknown>;

const asRecord = (v: unknown): Rec | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined;

/** A tool output is a JSON string or an already-parsed object. Never throws. */
function parseOutput(output: unknown): Rec | undefined {
  if (typeof output !== "string") return asRecord(output);
  try {
    return asRecord(JSON.parse(output));
  } catch {
    return undefined;
  }
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

const oneLine = (v: unknown): string | undefined => {
  const s = nonEmpty(v);
  return s ? s.replace(/\s+/g, " ") : undefined;
};

/** Accumulates artifacts in walk order (newest first); a fallback title never beats a real one. */
class Collector {
  private readonly byKey = new Map<string, { artifact: ChatArtifact; fallback: boolean }>();

  add(artifact: Omit<ChatArtifact, "title"> & { title?: string }, fallbackTitle: string, authoritativeSource = false): void {
    const key = `${artifact.kind}:${artifact.id}`;
    const title = artifact.title ?? fallbackTitle;
    const fallback = artifact.title === undefined;
    const existing = this.byKey.get(key);
    if (!existing) {
      this.byKey.set(key, { artifact: { ...artifact, title }, fallback });
    } else {
      if (existing.fallback && !fallback) {
        existing.artifact.title = title;
        existing.fallback = false;
      }
      // browse_agent records where the trace really lives; trace_read only assumes "local".
      if (authoritativeSource && artifact.source) existing.artifact.source = artifact.source;
    }
  }

  list(): ChatArtifact[] {
    return [...this.byKey.values()].map((e) => e.artifact);
  }
}

/**
 * Every document, canvas tab and trace a chat's tool calls touched. Deduped by kind + id; within a kind the most
 * recently referenced comes first. Pure and defensive: malformed parts are skipped, never thrown on.
 */
export function collectChatArtifacts(messages: UIMessage[], deps: CollectDeps = {}): ChatArtifact[] {
  const docs = new Collector();
  const canvases = new Collector();
  const traces = new Collector();

  for (let m = messages.length - 1; m >= 0; m--) {
    const parts = messages[m]?.parts;
    if (!Array.isArray(parts)) continue;
    for (let p = parts.length - 1; p >= 0; p--) {
      try {
        const part = parts[p] as unknown as Rec;
        if (!isToolUIPart(part as never)) continue;
        collectPart(part, deps, docs, canvases, traces);
      } catch {
        // A malformed part must not break the list.
      }
    }
  }
  return [...docs.list(), ...canvases.list(), ...traces.list()];
}

function collectPart(part: Rec, deps: CollectDeps, docs: Collector, canvases: Collector, traces: Collector): void {
  const toolName = getToolName(part as never);
  const done = part.state === "output-available";
  const input = asRecord(part.input);
  const out = done ? parseOutput(part.output) : undefined;

  if (DOC_TOOLS.has(toolName)) {
    if (!done) return;
    const failed = out?.error !== undefined;
    // A failed call may still name an existing doc in its input; doc_create has no docId to name.
    if (failed && toolName === "doc_create") return;
    const id = failed ? nonEmpty(input?.docId) : (nonEmpty(out?.docId) ?? nonEmpty(input?.docId));
    if (!id) return;
    const live = deps.docTitle ? deps.docTitle(id) : undefined;
    docs.add(
      {
        kind: "doc",
        id,
        title: nonEmpty(live) ?? (failed ? undefined : nonEmpty(out?.title)),
        ...(deps.docTitle && live === undefined ? { missing: true } : {}),
      },
      FALLBACK_DOC_TITLE,
    );
    return;
  }

  if (toolName === "open_canvas_tab") {
    if (!out || out.error !== undefined || typeof out.tabId !== "number") return;
    canvases.add({ kind: "canvas", id: String(out.tabId), tabId: out.tabId, title: nonEmpty(out.title) }, FALLBACK_CANVAS_TITLE);
    return;
  }

  if (toolName === "browse_agent") {
    const trace = asRecord(out?.trace);
    if (!trace || typeof trace.id !== "string" || trace.id === "") return;
    if (trace.source !== "local" && trace.source !== "cloud") return;
    traces.add({ kind: "trace", id: trace.id, source: trace.source, title: oneLine(input?.goal) }, FALLBACK_TRACE_TITLE, true);
    return;
  }

  if (toolName === "trace_read" || toolName === "trace_frame") {
    if (!done || out?.error !== undefined) return;
    const id = nonEmpty(input?.traceId);
    if (!id) return;
    traces.add({ kind: "trace", id, source: "local", title: oneLine(out?.goal) }, FALLBACK_TRACE_TITLE);
    return;
  }

  if (runsInCanvasTab(toolName) && typeof part.toolCallId === "string") {
    const tabId = deps.tabForCall?.(part.toolCallId);
    if (typeof tabId !== "number") return;
    canvases.add({ kind: "canvas", id: String(tabId), tabId }, FALLBACK_CANVAS_TITLE);
  }
}

export interface OpenContext {
  docsBridge?: { open(docId: string): Promise<unknown> };
  canvasBridge?: { activateTab(tabId: number): void };
  openWindow?: (url: string) => void;
  openTrace?: (trace: SavedTrace) => (() => void) | undefined;
}

function defaultContext(): OpenContext {
  return {
    docsBridge: getAgentPanelDocsBridge(),
    canvasBridge: getAgentPanelCanvasBridge(),
    openWindow: (url) => void window.open(url, "_blank", "noopener"),
    openTrace: traceOpener,
  };
}

/** Opens an artifact where it lives. Never throws: a click on a stale row does nothing. */
export function openChatArtifact(artifact: ChatArtifact, ctx: OpenContext = defaultContext()): void {
  try {
    if (artifact.kind === "doc") {
      if (ctx.docsBridge) {
        void Promise.resolve(ctx.docsBridge.open(artifact.id)).catch(() => undefined);
      } else {
        ctx.openWindow?.(`${import.meta.env.BASE_URL}doc?id=${encodeURIComponent(artifact.id)}`);
      }
    } else if (artifact.kind === "canvas") {
      if (artifact.tabId !== undefined) ctx.canvasBridge?.activateTab(artifact.tabId);
    } else if (artifact.source) {
      ctx.openTrace?.({ id: artifact.id, source: artifact.source })?.();
    }
  } catch {
    // Swallowed on purpose.
  }
}
