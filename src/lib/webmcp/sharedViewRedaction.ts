import { useSceneStore } from "@/store/sceneStore";

/**
 * Narrows what the read-only tools reveal about *someone else's* document.
 *
 * The threat this answers needs no XSS. On `/c/:shareId` the read tools stay
 * published — withholding them would kill the reason the surface exists — and
 * they return the sharer's document to whatever agent the viewer is running.
 * An attacker who can publish a share link can therefore write instructions
 * into the document and have a stranger's agent ingest them as though they
 * were content to work with. `untrustedContentHint` is advisory; nothing in
 * any client is obliged to act on it.
 *
 * The rule is provenance, not secrecy: **what an agent reads on a shared
 * canvas must be what the viewer's own screen can show.** Anything the canvas
 * does not draw is where an attacker hides text that the victim will never
 * see and therefore never question.
 *
 * What that includes, and what it deliberately does not:
 *
 * - *Hidden nodes* keep their id, type and name — the shared viewer renders
 *   the layers panel, so those names are already on the victim's screen — but
 *   lose their content. Dropping them outright would be stricter than the UI
 *   and would misreport the document's structure.
 * - *Embed and component source HTML* is removed entirely. It is never
 *   rendered as text anywhere in the viewer: comments, `display: none`
 *   blocks and off-screen markup all survive in it, which makes it the
 *   densest hiding place in the format.
 * - *Nodes far from the visible viewport are kept.* On an infinite canvas
 *   "off-screen" is not a property of the document, only of the current
 *   scroll position, and the layers panel lists them regardless. This is the
 *   honest limit of this pass: **it removes the invisible channels, not the
 *   inattentive ones.** Text that is genuinely drawn, just far away, still
 *   reaches the agent — only refusing to publish the tools at all would stop
 *   that, at the cost of the feature.
 *
 * Redaction is marked, never silent. An agent told nothing would conclude the
 * embed is empty and describe the design wrongly; one told the source was
 * withheld can say so.
 */

const SOURCE_HTML_KEYS = ["htmlContent", "sourceTemplate", "templateHtml"] as const;

/** Fields kept on a node the canvas does not draw. */
const HIDDEN_NODE_KEPT_KEYS = ["id", "type", "name", "children"] as const;

export const REDACTED_SOURCE = "[redacted: source HTML is not exposed on a shared canvas]";
export const REDACTED_HIDDEN = "[redacted: this layer is hidden and is not drawn]";

/**
 * Ids of every node the canvas does not draw: those explicitly hidden, plus
 * their descendants, which a hidden ancestor takes off screen with it.
 *
 * Read from the store rather than from the tool's own output, because the
 * serializer does not emit `visible` at all — there is nothing in the result
 * to filter on.
 */
export function collectHiddenNodeIds(): Set<string> {
  const { nodesById, childrenById } = useSceneStore.getState();
  const hidden = new Set<string>();

  const bury = (id: string): void => {
    if (hidden.has(id)) return;
    hidden.add(id);
    for (const childId of childrenById[id] ?? []) bury(childId);
  };

  for (const [id, node] of Object.entries(nodesById)) {
    if (node.visible === false) bury(id);
  }
  return hidden;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function redactValue(value: unknown, hidden: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, hidden));
  }
  if (!isRecord(value)) return value;

  const id = value.id;
  const isHiddenNode = typeof id === "string" && hidden.has(id);

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if ((SOURCE_HTML_KEYS as readonly string[]).includes(key)) {
      // Present but emptied, so the shape a caller expects is intact and the
      // omission is legible rather than looking like an embed with no content.
      out[key] = REDACTED_SOURCE;
      continue;
    }
    if (isHiddenNode && !(HIDDEN_NODE_KEPT_KEYS as readonly string[]).includes(key)) {
      continue;
    }
    out[key] = redactValue(child, hidden);
  }

  if (isHiddenNode) out.redacted = REDACTED_HIDDEN;
  return out;
}

/**
 * Applies the rules above to one tool result. A non-object result (a plain
 * string from a handler that does not return JSON) is passed through: there
 * is no node structure in it to narrow.
 */
export function redactForSharedView(result: unknown): unknown {
  if (typeof result === "string" || result === null || result === undefined) {
    return result;
  }
  return redactValue(result, collectHiddenNodeIds());
}
