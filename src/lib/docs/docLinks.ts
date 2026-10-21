// Links between documents and from a document to a canvas frame. They are plain
// relative markdown links, so the agent can write them and they survive a round trip:
//   [Title](/doc?id=<docId>)    [Name](/app?node=<nodeId>)

export type LinkTarget =
  | { kind: "doc"; id: string }
  | { kind: "node"; id: string }
  | { kind: "external"; href: string };

export function docLinkHref(docId: string): string {
  return `/doc?id=${encodeURIComponent(docId)}`;
}

export function nodeLinkHref(nodeId: string): string {
  return `/app?node=${encodeURIComponent(nodeId)}`;
}

/** Template placeholders (`DOC_ID`, `NODE_ID`) the user must replace before the link works. */
export function isPlaceholderId(id: string): boolean {
  return id === "DOC_ID" || id === "NODE_ID";
}

/**
 * Decides what a clicked href means. Only a relative `/doc?id=` or `/app?node=` link counts
 * (an absolute URL to another host is external).
 */
export function classifyHref(href: string): LinkTarget {
  const match = /^\/(doc|app)\?(.*)$/.exec(href.trim());
  if (match) {
    const params = new URLSearchParams(match[2]);
    const id = params.get(match[1] === "doc" ? "id" : "node");
    if (id) return { kind: match[1] === "doc" ? "doc" : "node", id };
  }
  return { kind: "external", href };
}
