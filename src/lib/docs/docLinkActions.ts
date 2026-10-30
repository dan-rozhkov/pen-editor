import { toast } from "sonner";
import { getAgentPanelCanvasBridge } from "@/lib/agentPanel";
import { traceOpener } from "@/lib/traceOpener";
import type { TraceSource } from "@/lib/browseTraces";
import { classifyHref, isPlaceholderId } from "./docLinks";
import { readDoc } from "./docStore";
import { requestCanvasFocus } from "./canvasFocusRequest";

export const DOC_MISSING_MESSAGE = "This document no longer exists.";
export const DOC_PLACEHOLDER_MESSAGE = "Replace DOC_ID with a document link.";
export const NODE_PLACEHOLDER_MESSAGE = "Replace NODE_ID with a frame link.";

export const CANVAS_TAB_UNAVAILABLE_MESSAGE = "Canvas tabs open only in the desktop app.";
export const CANVAS_TAB_IN_DOC_MESSAGE = "Canvas tab links work only in the agent chat.";
export const TRACE_OPEN_FAILED_MESSAGE = "The trace could not be opened.";

export interface LinkActions {
  openDoc: (id: string) => void;
  focusNode: (id: string) => void;
  activateCanvasTab: (tabId: number) => void;
  openTrace: (id: string, source: TraceSource) => void;
  openExternal: (href: string) => void;
}

/** What a click on a link in the document does. Wrapped so a link can never throw into the editor. */
export function handleLinkClick(href: string, actions: LinkActions): void {
  try {
    const target = classifyHref(href);
    if (target.kind === "external") actions.openExternal(target.href);
    else if (target.kind === "doc") actions.openDoc(target.id);
    else if (target.kind === "canvasTab") actions.activateCanvasTab(target.tabId);
    else if (target.kind === "trace") actions.openTrace(target.id, target.source);
    else actions.focusNode(target.id);
  } catch (e) {
    console.error("link click failed", e);
  }
}

/** Switches the /doc tab to `id` through `select`, or says why it cannot. */
export function openDocLink(id: string, select: (id: string) => void): void {
  if (isPlaceholderId(id)) return void toast(DOC_PLACEHOLDER_MESSAGE);
  if (readDoc(id).kind === "missing") return void toast(DOC_MISSING_MESSAGE);
  select(id);
}

/** Asks the canvas to show the frame; a template placeholder only gets a hint. */
export function focusNodeLink(id: string): void {
  if (isPlaceholderId(id)) return void toast(NODE_PLACEHOLDER_MESSAGE);
  requestCanvasFocus(id);
}

/** Shows a canvas tab through the desktop panel bridge; without it there is no tab to show. */
export function activateCanvasTabLink(tabId: number): void {
  const bridge = getAgentPanelCanvasBridge();
  if (!bridge) return void toast(CANVAS_TAB_UNAVAILABLE_MESSAGE);
  bridge.activateTab(tabId);
}

/** A canvas tab link in a document: tab ids are ephemeral, so only the agent chat can follow one. */
export function canvasTabInDocLink(): void {
  toast(CANVAS_TAB_IN_DOC_MESSAGE);
}

/**
 * Opens a browse-run trace: the agent panel when it can; else, for a local trace, the desktop shell's
 * doc-page bridge (it denies same-origin window.open); else the viewer route in a new browser tab. Never throws.
 */
export function openTraceLink(id: string, source: TraceSource): void {
  try {
    const open = traceOpener({ id, source });
    if (open) return open();
    const desktopOpen = source === "local" ? window.penDesktop?.traces?.open : undefined;
    if (desktopOpen) {
      const fail = (message?: string) => toast(message || TRACE_OPEN_FAILED_MESSAGE);
      desktopOpen
        .call(window.penDesktop?.traces, id)
        .then((result) => {
          if (!result?.ok) fail(result?.error);
        })
        .catch((e: unknown) => fail(e instanceof Error ? e.message : undefined));
      return;
    }
    window.open(`${import.meta.env.BASE_URL}trace/${encodeURIComponent(id)}?src=${source}`, "_blank", "noopener");
  } catch (e) {
    console.error("open trace failed", e);
  }
}

export function openExternalLink(href: string): void {
  window.open(href, "_blank", "noopener,noreferrer");
}
