import type { ToolHandler } from "../toolRegistry";
import { createDoc, getDoc, listDocs, updateDoc } from "../docs/docStore";
import { applyDocEdits, type DocEdit } from "../docs/applyDocEdits";
import { getAgentPanelDocsBridge, getAgentPanelTraceTabsBridge } from "../agentPanel";
import { whenDesktopDocsReady } from "../docs/desktopDocMirror";
import { buildImageMarkdown, insertImageIntoMarkdown } from "../docs/insertImage";
import { stripLeadingTitle } from "../docs/stripLeadingTitle";
import { ensurePublicUrl } from "../imageOps/resolveSourceUrl";
import { isPanelCanvasLinkActive, panelCallTool } from "../canvasLink/panelRuntime";
import { parseBrowseTrace } from "@sideform/browser-agent/agent/session";
import { getScreenshot } from "./getScreenshot";

// Panel-local (canvasLink/canvasTools.ts, prefix "doc_"): markdown documents live in this
// browser's localStorage (docs/docStore.ts) and the desktop shell shows them in a /doc tab.
// Advertised by the backend only when clientCapabilities.docTabs is true. Output: JSON string,
// `{"error": "..."}` on failure.

const err = (message: string): string => JSON.stringify({ error: message });

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A trimmed string, or undefined when absent or blank (the backend schema passes "" through). */
function optStr(value: unknown): string | undefined {
  return str(value)?.trim() || undefined;
}

const aborted = () => err("The call was cancelled before the document was changed.");

/** Rejects when `signal` aborts first, so a hung upload cannot hold the call open. */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("The call was cancelled."));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Opens the doc tab. Returns an error message, or undefined on success. */
async function openTab(docId: string): Promise<string | undefined> {
  const bridge = getAgentPanelDocsBridge();
  if (!bridge) return "Document tabs are not available here (desktop app only). The document exists but no tab was opened.";
  try {
    const result = await bridge.open(docId);
    return result.ok ? undefined : result.error || "The document tab could not be opened.";
  } catch (e) {
    return e instanceof Error ? e.message : "The document tab could not be opened.";
  }
}

export const docList: ToolHandler = async () => {
  await whenDesktopDocsReady();
  return JSON.stringify({ documents: listDocs().map(({ id, title, updatedAt }) => ({ docId: id, title, updatedAt })) });
};

export const docCreate: ToolHandler = async (args) => {
  await whenDesktopDocsReady();
  const rawTitle = str(args?.title);
  const rawMarkdown = str(args?.markdown);
  if (rawTitle === undefined || rawMarkdown === undefined) return err("title and markdown are required strings.");
  // The doc page shows the title above the body: a leading `# Title` in the body would show it twice.
  const stripped = stripLeadingTitle(rawMarkdown, rawTitle);
  const markdown = stripped.markdown;
  const title = rawTitle.trim() === "" && stripped.title ? stripped.title : rawTitle;
  let doc;
  try {
    doc = createDoc({ title, markdown }, "agent");
  } catch (e) {
    return err(e instanceof Error ? e.message : "The document could not be saved.");
  }
  const openError = await openTab(doc.id);
  return JSON.stringify({ docId: doc.id, title: doc.title, ...(openError ? { openError } : {}) });
};

export const docRead: ToolHandler = async (args) => {
  await whenDesktopDocsReady();
  const docId = str(args?.docId);
  if (!docId) return err("docId is required.");
  const doc = getDoc(docId);
  if (!doc) return err(`Unknown docId "${docId}". Call doc_list to see the documents.`);
  return JSON.stringify({ docId: doc.id, title: doc.title, markdown: doc.markdown });
};

export const docEdit: ToolHandler = async (args) => {
  await whenDesktopDocsReady();
  const docId = str(args?.docId);
  if (!docId) return err("docId is required.");
  const edits = args?.edits as DocEdit[] | undefined;
  const rawMarkdown = str(args?.markdown);
  const title = str(args?.title);
  const hasEdits = Array.isArray(edits) && edits.length > 0;
  if (hasEdits && rawMarkdown !== undefined) return err("Pass either edits or markdown, not both.");
  if (!hasEdits && rawMarkdown === undefined && title === undefined) {
    return err("Nothing to change: pass edits, markdown or title.");
  }
  const doc = getDoc(docId);
  if (!doc) return err(`Unknown docId "${docId}". Call doc_list to see the documents.`);
  // Strip a leading H1 only when it repeats the (new or stored) title.
  const markdown = rawMarkdown === undefined ? undefined : stripLeadingTitle(rawMarkdown, title ?? doc.title).markdown;

  let nextMarkdown = markdown;
  let applied = markdown !== undefined ? 1 : 0;
  if (hasEdits) {
    const result = applyDocEdits(doc.markdown, edits);
    if (!result.ok) return err(result.error);
    nextMarkdown = result.markdown;
    applied = result.applied;
  }
  let updated;
  try {
    updated = updateDoc(docId, { ...(nextMarkdown !== undefined ? { markdown: nextMarkdown } : {}), ...(title !== undefined ? { title } : {}) }, "agent");
  } catch (e) {
    return err(e instanceof Error ? e.message : "The document could not be saved.");
  }
  if (!updated) return err(`Unknown docId "${docId}".`);
  return JSON.stringify({ docId: updated.id, title: updated.title, applied });
};

export const docOpen: ToolHandler = async (args) => {
  await whenDesktopDocsReady();
  const docId = str(args?.docId);
  if (!docId) return err("docId is required.");
  if (!getDoc(docId)) return err(`Unknown docId "${docId}". Call doc_list to see the documents.`);
  const openError = await openTab(docId);
  return openError ? err(openError) : JSON.stringify({ docId, opened: true });
};

// Documents need readable evidence: ask get_screenshot for up to 2048 px (its default is 1024, sized for model vision).
const DOC_SCREENSHOT_MAX_SIDE = 2048;

// A node screenshot plus the upload; the chat-side budget (useDesignChat) is 60 s.
const SCREENSHOT_TIMEOUT_MS = 45_000;

/** Screenshot of a canvas node as a data URL (via the bound canvas tab in the panel). */
async function screenshotNode(nodeId: string, context: Parameters<ToolHandler>[1]): Promise<string> {
  const raw =
    isPanelCanvasLinkActive() && context?.sessionId
      ? await panelCallTool(context.sessionId, "get_screenshot", { nodeId, maxSide: DOC_SCREENSHOT_MAX_SIDE }, {
          toolCallId: `${context.toolCallId ?? "doc_insert_image"}:screenshot`,
          timeoutMs: SCREENSHOT_TIMEOUT_MS,
          signal: context.signal,
        })
      : await getScreenshot({ nodeId, maxSide: DOC_SCREENSHOT_MAX_SIDE }, context);
  let parsed: { imageData?: unknown; error?: unknown; note?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error("The screenshot of the node could not be read.");
  }
  if (typeof parsed.error === "string") throw new Error(`Screenshot failed: ${parsed.error}`);
  if (typeof parsed.note === "string") throw new Error(`Screenshot failed: ${parsed.note}`);
  if (typeof parsed.imageData !== "string" || !parsed.imageData.startsWith("data:")) {
    throw new Error("The screenshot of the node returned no image.");
  }
  return parsed.imageData;
}

/** The `src` of one frame of an open trace tab: a data: image URL or an http(s) URL. */
async function traceFrameSrc(traceId: string, frameId: number | undefined): Promise<string> {
  const bridge = getAgentPanelTraceTabsBridge();
  if (!bridge) throw new Error("Trace tabs are not available here (desktop app only).");
  const result: unknown = await bridge.read(traceId);
  if (!result || typeof result !== "object") throw new Error("The desktop app returned an unexpected answer.");
  if ("error" in result) throw new Error(String((result as { error: unknown }).error));
  const parsed = parseBrowseTrace((result as { trace?: unknown }).trace);
  if ("error" in parsed) throw new Error(`The trace is not valid: ${parsed.error}`);
  const frames = parsed.trace.frames ?? [];
  if (frames.length === 0) throw new Error(`The trace "${traceId}" has no screenshots.`);
  let frame;
  if (frameId === undefined) {
    frame = [...frames].sort((a, b) => (a.kind === "final" ? 1 : 0) - (b.kind === "final" ? 1 : 0) || a.at - b.at || a.id - b.id).at(-1);
  } else {
    frame = frames.find((f) => f.id === frameId);
    if (!frame) {
      const ids = frames.slice(-10).map((f) => f.id).join(", ");
      throw new Error(`Unknown frameId ${frameId} in trace "${traceId}". Latest frameIds: ${frames.length > 10 ? "..., " : ""}${ids}. Call trace_read to see the frames.`);
    }
  }
  const src = frame?.src;
  if (typeof src !== "string" || !(/^data:image\//i.test(src) || /^https?:\/\//i.test(src))) {
    throw new Error("The frame image could not be loaded (the trace holds no image data for it).");
  }
  return src;
}

/** An https URL for the image source; never returns a data: URL. */
async function resolveImageUrl(
  imageUrl: string | undefined,
  nodeId: string | undefined,
  traceId: string | undefined,
  frameId: number | undefined,
  context: Parameters<ToolHandler>[1],
): Promise<string> {
  const signal = context?.signal;
  if (traceId !== undefined) {
    const src = await traceFrameSrc(traceId, frameId);
    if (signal?.aborted) throw new Error("The call was cancelled.");
    if (/^https?:\/\//i.test(src)) return src;
    return raceAbort(ensurePublicUrl(src), signal);
  }
  if (imageUrl !== undefined) {
    if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
    if (imageUrl.startsWith("data:")) return raceAbort(ensurePublicUrl(imageUrl), signal);
    throw new Error("imageUrl must be an http(s) URL or a data: URL.");
  }
  const shot = await screenshotNode(nodeId as string, context);
  if (signal?.aborted) throw new Error("The call was cancelled.");
  return raceAbort(ensurePublicUrl(shot), signal);
}

export const docInsertImage: ToolHandler = async (args, context) => {
  await whenDesktopDocsReady();
  const docId = str(args?.docId);
  if (!docId) return err("docId is required.");
  const imageUrl = optStr(args?.imageUrl);
  const nodeId = optStr(args?.nodeId);
  const traceId = optStr(args?.traceId);
  const frameIdRaw = args?.frameId;
  const frameId = typeof frameIdRaw === "number" && Number.isInteger(frameIdRaw) && frameIdRaw >= 0 ? frameIdRaw : undefined;
  if (frameIdRaw !== undefined && frameIdRaw !== null && frameId === undefined) return err("frameId must be an integer from 0.");
  if (frameId !== undefined && traceId === undefined) return err("frameId needs traceId.");
  if ([imageUrl, nodeId, traceId].filter((v) => v !== undefined).length !== 1) return err("Pass exactly one of imageUrl, nodeId or traceId.");
  const alt = str(args?.alt);
  if (!alt || !alt.trim()) return err("alt is required (a short description of the image).");
  const afterHeading = optStr(args?.afterHeading);
  const doc = getDoc(docId);
  if (!doc) return err(`Unknown docId "${docId}". Call doc_list to see the documents.`);

  let url: string;
  try {
    url = await resolveImageUrl(imageUrl, nodeId, traceId, frameId, context);
  } catch (e) {
    return err(e instanceof Error ? e.message : "The image could not be prepared.");
  }
  if (context?.signal?.aborted) return aborted();
  // Re-read: the screenshot and upload took time, the user may have typed meanwhile.
  const fresh = getDoc(docId);
  if (!fresh) return err(`Unknown docId "${docId}".`);
  const inserted = insertImageIntoMarkdown(fresh.markdown, buildImageMarkdown(alt, url), afterHeading);
  if (!inserted.ok) return err(inserted.error);
  try {
    if (!updateDoc(docId, { markdown: inserted.markdown }, "agent")) return err(`Unknown docId "${docId}".`);
  } catch (e) {
    return err(e instanceof Error ? e.message : "The document could not be saved.");
  }
  return JSON.stringify({ docId, url });
};
