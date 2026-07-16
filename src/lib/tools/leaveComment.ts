import { useCommentsStore, type CommentAnchor } from "@/store/commentsStore";
import type { ToolHandler } from "../toolRegistry";

interface RawCommentItem {
  nodeId?: unknown;
  x?: unknown;
  y?: unknown;
  text?: unknown;
}

/**
 * leave_comment — the agent drops one or more comment pins in a single
 * batch call (design-review style: 5-15 findings per turn). Matches the
 * backend zod schema (`comments: [{ nodeId?, x?, y?, text }]`, 1..50 items,
 * each item needs nodeId OR both x and y) — mirrored here defensively since
 * the frontend can't rely on the backend's `refine` having run (a
 * misbehaving model, or a future caller, could still send a malformed item).
 *
 * Each valid item becomes its own new thread via
 * `commentsStore.addAgentThread` (author "agent"), reusing the same
 * document-wide `order` counter as user-placed comments (`submitDraft`) —
 * no duplicated order logic here.
 *
 * A `nodeId` that no longer resolves to a live node still creates a thread
 * (rendered "unattached" per cmt-01, same as any node deleted after a user
 * comment was placed) rather than silently dropping the agent's feedback —
 * the agent has no way to re-derive which node it meant.
 *
 * Comments are outside undo/redo (cmt-01 decision) — `addAgentThread` never
 * touches history.
 */
export const leaveComment: ToolHandler = async (args) => {
  const rawComments = Array.isArray(args.comments) ? (args.comments as RawCommentItem[]) : null;

  if (!rawComments || rawComments.length === 0) {
    return "No comments were left: the `comments` array was empty or invalid.";
  }

  const store = useCommentsStore.getState();
  const created: number[] = [];
  let skipped = 0;

  for (const item of rawComments) {
    const nodeId = typeof item.nodeId === "string" && item.nodeId ? item.nodeId : undefined;
    const x = typeof item.x === "number" ? item.x : undefined;
    const y = typeof item.y === "number" ? item.y : undefined;
    const text = typeof item.text === "string" ? item.text : "";

    if (!text.trim()) {
      skipped += 1;
      continue;
    }

    let anchor: CommentAnchor;
    if (nodeId) {
      anchor = { kind: "node", nodeId, ox: 0.5, oy: 0.5 };
    } else if (x !== undefined && y !== undefined) {
      anchor = { kind: "canvas", x, y };
    } else {
      skipped += 1;
      continue;
    }

    const threadId = store.addAgentThread(anchor, text);
    if (!threadId) {
      skipped += 1;
      continue;
    }
    const thread = useCommentsStore.getState().threads.find((t) => t.id === threadId);
    if (thread) created.push(thread.order);
  }

  const parts: string[] = [];
  if (created.length > 0) {
    parts.push(`Left ${created.length} comment${created.length === 1 ? "" : "s"}: ${created.map((n) => `#${n}`).join(", ")}`);
  } else {
    parts.push("No comments were left.");
  }
  if (skipped > 0) {
    parts.push(
      `Skipped ${skipped} invalid item${skipped === 1 ? "" : "s"} (each comment needs either nodeId, or both x and y, and non-empty text).`,
    );
  }
  return parts.join(" ");
};
