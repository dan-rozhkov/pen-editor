import { toast } from "sonner";
import { classifyHref, isPlaceholderId } from "./docLinks";
import { readDoc } from "./docStore";
import { requestCanvasFocus } from "./canvasFocusRequest";

export const DOC_MISSING_MESSAGE = "This document no longer exists.";
export const DOC_PLACEHOLDER_MESSAGE = "Replace DOC_ID with a document link.";
export const NODE_PLACEHOLDER_MESSAGE = "Replace NODE_ID with a frame link.";

export interface LinkActions {
  openDoc: (id: string) => void;
  focusNode: (id: string) => void;
  openExternal: (href: string) => void;
}

/** What a click on a link in the document does. Wrapped so a link can never throw into the editor. */
export function handleLinkClick(href: string, actions: LinkActions): void {
  try {
    const target = classifyHref(href);
    if (target.kind === "external") actions.openExternal(target.href);
    else if (target.kind === "doc") actions.openDoc(target.id);
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

export function openExternalLink(href: string): void {
  window.open(href, "_blank", "noopener,noreferrer");
}
