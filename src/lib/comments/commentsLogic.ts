import type { CommentAnchor, CommentThread } from "@/store/commentsStore";

/** A world-space rect (absolute canvas coordinates). */
export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The next document-wide `order` counter value: `max(order)+1`, or 1 when
 * there are no threads yet. Old `.pen` files without an explicit counter get
 * a fresh, stable, monotonic number this way.
 */
export function nextOrder(existingOrders: number[]): number {
  if (existingOrders.length === 0) return 1;
  return Math.max(...existingOrders) + 1;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Resolve an anchor to a world-space point. For a node anchor the point is
 * `rect.origin + (ox,oy) * rect.size`, recomputed from the node's *current*
 * rect — so the pin tracks move/resize/auto-layout. Returns null when a node
 * anchor's node no longer exists (the thread is "unattached": no pin drawn).
 */
export function resolveAnchorPoint(
  anchor: CommentAnchor,
  lookupRect: (nodeId: string) => NodeRect | null,
): { x: number; y: number } | null {
  if (anchor.kind === "canvas") {
    return { x: anchor.x, y: anchor.y };
  }
  const rect = lookupRect(anchor.nodeId);
  if (!rect) return null;
  return {
    x: rect.x + anchor.ox * rect.width,
    y: rect.y + anchor.oy * rect.height,
  };
}

/**
 * Build the anchor for a click at world point (wx,wy): a node anchor (with
 * ox/oy = the click's fractional offset within the node rect, clamped to
 * [0,1]) when a node was hit, else a bare canvas anchor.
 */
export function buildClickAnchor(
  wx: number,
  wy: number,
  hit: { nodeId: string; rect: NodeRect } | null,
): CommentAnchor {
  if (!hit) {
    return { kind: "canvas", x: wx, y: wy };
  }
  const { nodeId, rect } = hit;
  const ox = rect.width > 0 ? clamp01((wx - rect.x) / rect.width) : 0;
  const oy = rect.height > 0 ? clamp01((wy - rect.y) / rect.height) : 0;
  return { kind: "node", nodeId, ox, oy };
}

/**
 * A node-anchored thread is "unattached" when its node is absent from the
 * scene (deleted). Canvas-anchored threads are never unattached.
 */
export function isThreadUnattached(
  thread: CommentThread,
  nodesById: Record<string, unknown>,
): boolean {
  if (thread.anchor.kind !== "node") return false;
  return !(thread.anchor.nodeId in nodesById);
}

export interface ReadCommentsOptions {
  includeResolved?: boolean;
  threadId?: string;
}

export interface ReadCommentMessage {
  author: "me" | "agent";
  text: string;
}

export interface ReadCommentThread {
  id: string;
  order: number;
  resolved: boolean;
  nodeId?: string;
  nodeName?: string;
  unattached?: boolean;
  messages: ReadCommentMessage[];
}

export interface ReadCommentsResult {
  threads: ReadCommentThread[];
}

/**
 * Shape the `read_comments` tool result from the live threads: apply the
 * includeResolved / threadId filters, attach node anchor id + name (and an
 * `unattached` flag when the node is gone). Message text is returned
 * verbatim — this result is JSON.stringify'd for the model, and JSON
 * already provides correct, sufficient structural encoding; HTML-entity
 * escaping would only garble ordinary text (e.g. quotes/apostrophes) without
 * mitigating the actual risk (prompt injection). Pure so it unit-tests
 * without stores.
 */
export function buildReadCommentsResult(
  threads: CommentThread[],
  nodesById: Record<string, { name?: string }>,
  options: ReadCommentsOptions,
): ReadCommentsResult {
  const { includeResolved = false, threadId } = options;

  const filtered = threads.filter((t) => {
    if (threadId != null && t.id !== threadId) return false;
    if (!includeResolved && t.resolvedAt != null) return false;
    return true;
  });

  return {
    threads: filtered.map((t) => {
      const out: ReadCommentThread = {
        id: t.id,
        order: t.order,
        resolved: t.resolvedAt != null,
        messages: t.messages.map((m) => ({
          author: m.author,
          text: m.text,
        })),
      };
      if (t.anchor.kind === "node") {
        out.nodeId = t.anchor.nodeId;
        const node = nodesById[t.anchor.nodeId];
        if (node) {
          out.nodeName = node.name ?? "";
        } else {
          out.unattached = true;
        }
      }
      return out;
    }),
  };
}
