// Links between documents and from a document to a canvas frame. They are plain
// relative markdown links, so the agent can write them and they survive a round trip:
//   [Title](/doc?id=<docId>)    [Name](/app?node=<nodeId>)
//   [Tab](/app?tab=<tabId>) (chat only: tab ids are ephemeral)     [Run](/trace/<traceId>?src=local|cloud)

import type { TraceSource } from "@/lib/browseTraces";
import { traceSourceFromParam } from "@/lib/traceSource";

export type LinkTarget =
  | { kind: "doc"; id: string }
  | { kind: "node"; id: string }
  | { kind: "canvasTab"; tabId: number }
  | { kind: "trace"; id: string; source: TraceSource }
  | { kind: "external"; href: string };

export function docLinkHref(docId: string): string {
  return `/doc?id=${encodeURIComponent(docId)}`;
}

export function nodeLinkHref(nodeId: string): string {
  return `/app?node=${encodeURIComponent(nodeId)}`;
}

export function traceLinkHref(id: string, source: TraceSource): string {
  return `/trace/${encodeURIComponent(id)}?src=${source}`;
}

/** Template placeholders (`DOC_ID`, `NODE_ID`) the user must replace before the link works. */
export function isPlaceholderId(id: string): boolean {
  return id === "DOC_ID" || id === "NODE_ID";
}

/**
 * Decides what a clicked href means. Only a relative `/doc?id=`, `/app?node=`, `/app?tab=` or
 * `/trace/<id>` link counts (an absolute URL to another host is external).
 */
export function classifyHref(href: string): LinkTarget {
  const trimmed = href.trim();
  const trace = /^\/trace\/([^/?#]+)(?:\?([^#]*))?(?:#.*)?$/.exec(trimmed);
  if (trace) {
    try {
      const id = decodeURIComponent(trace[1]);
      if (id) return { kind: "trace", id, source: traceSourceFromParam(new URLSearchParams(trace[2] ?? "").get("src")) };
    } catch {
      // A malformed escape is not a trace link.
    }
    return { kind: "external", href };
  }
  const match = /^\/(doc|app)\?(.*)$/.exec(trimmed);
  if (match) {
    const params = new URLSearchParams(match[2]);
    const id = params.get(match[1] === "doc" ? "id" : "node");
    if (id) return { kind: match[1] === "doc" ? "doc" : "node", id };
    const tab = match[1] === "app" ? params.get("tab") : null;
    if (tab && /^\d+$/.test(tab)) return { kind: "canvasTab", tabId: Number(tab) };
  }
  return { kind: "external", href };
}
