import { useMemo, useRef, useState } from "react";
import { CheckIcon, TrashIcon, SparkleIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { useViewportStore } from "@/store/viewportStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useCommentsStore, type CommentAnchor, type CommentThread } from "@/store/commentsStore";
import {
  getNodeAbsolutePositionWithLayout,
  getNodeEffectiveSize,
} from "@/utils/nodeUtils";
import { resolveAnchorPoint, buildClickAnchor, isAgentThread, type NodeRect } from "@/lib/comments/commentsLogic";
import { findCanvasHitTargetAtPoint } from "@/pixi/interaction/hitTesting";
import { sendCommentToAgent } from "@/lib/sendCommentToAgent";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PIN_SIZE = 28; // fixed screen px — pins do not scale with zoom
const DRAG_THRESHOLD = 4;

/** Resolve a node's current absolute rect (world coords), or null if gone. */
function currentNodeRect(nodeId: string): NodeRect | null {
  const state = useSceneStore.getState();
  const node = state.nodesById[nodeId];
  if (!node) return null;
  const nodes = state.getNodes();
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const pos = getNodeAbsolutePositionWithLayout(nodes, nodeId, calc);
  if (!pos) return null;
  const size = getNodeEffectiveSize(nodes, nodeId, calc);
  return {
    x: pos.x,
    y: pos.y,
    width: size?.width ?? node.width,
    height: size?.height ?? node.height,
  };
}

function canvasRect(): DOMRect | null {
  const el = document.querySelector("[data-canvas]");
  return el ? el.getBoundingClientRect() : null;
}

/** Client (event) coords → world coords, via the viewport transform. */
function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvasRect();
  const { scale, x, y } = useViewportStore.getState();
  const sx = clientX - (rect?.left ?? 0);
  const sy = clientY - (rect?.top ?? 0);
  return { x: (sx - x) / scale, y: (sy - y) / scale };
}

interface Screen {
  left: number;
  top: number;
}

/** World point → screen (CSS px) position within the Pixi host. */
function worldToScreen(wx: number, wy: number, scale: number, panX: number, panY: number): Screen {
  return { left: wx * scale + panX, top: wy * scale + panY };
}

export function CommentLayer() {
  const scale = useViewportStore((s) => s.scale);
  const panX = useViewportStore((s) => s.x);
  const panY = useViewportStore((s) => s.y);
  // Subscribe to the node map so pins follow node move/resize/auto-layout
  // (any geometry change mutates nodesById → re-render → anchor recompute).
  const nodesById = useSceneStore((s) => s.nodesById);
  const threads = useCommentsStore((s) => s.threads);
  const draftAnchor = useCommentsStore((s) => s.draftAnchor);
  const pinsHidden = useCommentsStore((s) => s.pinsHidden);

  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  // A node lookup closed over the *subscribed* `nodesById`, so a node move/
  // resize/auto-layout change (which mutates that map) re-runs the memos below
  // and re-resolves every pin's world point via the node's fresh rect.
  const lookupRect = useMemo(
    () => (nodeId: string): NodeRect | null =>
      nodeId in nodesById ? currentNodeRect(nodeId) : null,
    [nodesById],
  );

  // Resolve each thread to a screen position, dropping node-anchored threads
  // whose node is gone (unattached → no pin drawn; still listed in the panel).
  const placed = useMemo(() => {
    return threads
      .map((thread) => {
        const world = resolveAnchorPoint(thread.anchor, lookupRect);
        if (!world) return null;
        return { thread, screen: worldToScreen(world.x, world.y, scale, panX, panY) };
      })
      .filter((v): v is { thread: CommentThread; screen: Screen } => v !== null);
  }, [threads, lookupRect, scale, panX, panY]);

  const draftScreen = useMemo(() => {
    if (!draftAnchor) return null;
    const world = resolveAnchorPoint(draftAnchor, lookupRect);
    if (!world) return null;
    return worldToScreen(world.x, world.y, scale, panX, panY);
  }, [draftAnchor, lookupRect, scale, panX, panY]);

  return (
    <div
      data-comment-layer
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 12 }}
    >
      {!pinsHidden &&
        placed.map(({ thread, screen }) => (
          <CommentPin
            key={thread.id}
            thread={thread}
            screen={screen}
            open={openThreadId === thread.id}
            onOpen={() => setOpenThreadId((cur) => (cur === thread.id ? null : thread.id))}
            onClose={() => setOpenThreadId(null)}
          />
        ))}

      {draftScreen && draftAnchor && <DraftComposer screen={draftScreen} />}
    </div>
  );
}

interface CommentPinProps {
  thread: CommentThread;
  screen: Screen;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function CommentPin({ thread, screen, open, onOpen, onClose }: CommentPinProps) {
  const dragState = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

  const resolved = thread.resolvedAt != null;
  const agent = isAgentThread(thread);
  // Agent-initiated pins (from `leave_comment`) get a distinct violet color +
  // a small sparkle glyph instead of the order number, so a design-review
  // batch reads as clearly agent-authored at a glance vs. user pins (blue).
  const pinColor = agent ? "#8b5cf6" : "var(--color-accent-primary, #0d99ff)";

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const st = dragState.current;
    if (!st) return;
    if (Math.abs(e.clientX - st.startX) > DRAG_THRESHOLD || Math.abs(e.clientY - st.startY) > DRAG_THRESHOLD) {
      st.moved = true;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const st = dragState.current;
    dragState.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!st) return;
    if (!st.moved) {
      // Click (not a drag): toggle the thread popover.
      onOpen();
      return;
    }
    // Drag: re-anchor the pin under the release point (node vs canvas).
    const world = clientToWorld(e.clientX, e.clientY);
    const target = findCanvasHitTargetAtPoint(world.x, world.y, { deepSelect: true });
    const nodeId = target?.kind === "node" ? target.nodeId : null;
    const rect = nodeId ? currentNodeRect(nodeId) : null;
    const anchor: CommentAnchor = buildClickAnchor(
      world.x,
      world.y,
      nodeId && rect ? { nodeId, rect } : null,
    );
    useCommentsStore.getState().updateAnchor(thread.id, anchor);
  };

  return (
    <div style={{ position: "absolute", left: screen.left, top: screen.top, pointerEvents: "none" }}>
      <button
        data-comment-pin
        data-thread-id={thread.id}
        data-agent-pin={agent ? "true" : undefined}
        title={`${agent ? "Agent comment" : "Comment"} #${thread.order}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: "absolute",
          left: 0,
          top: -PIN_SIZE, // anchor the pin's bottom-left tip at the point
          width: PIN_SIZE,
          height: PIN_SIZE,
          borderRadius: "50% 50% 50% 0",
          transform: "translateY(0)",
          background: pinColor,
          opacity: resolved ? 0.5 : 1,
          color: "#fff",
          fontSize: 11,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          border: "1.5px solid #fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
          cursor: "pointer",
          pointerEvents: "auto",
        }}
      >
        {agent && <SparkleIcon size={10} weight="fill" />}
        {thread.order}
      </button>
      {open && <ThreadPopover thread={thread} onClose={onClose} />}
    </div>
  );
}

function ThreadPopover({ thread, onClose }: { thread: CommentThread; onClose: () => void }) {
  const [replyText, setReplyText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const store = useCommentsStore;
  const resolved = thread.resolvedAt != null;
  const rootId = thread.messages[0]?.id;

  const submitReply = () => {
    if (!replyText.trim()) return;
    store.getState().addReply(thread.id, "me", replyText);
    setReplyText("");
  };

  const startEdit = (id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
  };
  const commitEdit = () => {
    if (editingId) store.getState().editMessage(thread.id, editingId, editText);
    setEditingId(null);
    setEditText("");
  };

  return (
    <div
      data-comment-popover
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: PIN_SIZE + 6,
        top: -PIN_SIZE,
        width: 260,
        maxHeight: 360,
        overflowY: "auto",
        pointerEvents: "auto",
        zIndex: 1,
      }}
      className="rounded-lg border border-border-default bg-surface-panel p-2 shadow-lg"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-text-primary">Comment #{thread.order}</span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            title={resolved ? "Reopen" : "Resolve"}
            onClick={() =>
              resolved
                ? store.getState().unresolveThread(thread.id)
                : store.getState().resolveThread(thread.id)
            }
          >
            {resolved ? <ArrowCounterClockwiseIcon /> : <CheckIcon />}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Send to agent"
            onClick={() => sendCommentToAgent(thread.id)}
          >
            <SparkleIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Delete thread"
            onClick={() => setConfirmDelete(true)}
          >
            <TrashIcon />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {thread.messages.map((m) => (
          <div key={m.id} className="rounded-md bg-secondary/60 px-2 py-1.5">
            <div className="mb-0.5 flex items-center justify-between">
              <span className="text-[10px] font-medium text-text-muted">
                {m.author === "agent" ? "Agent" : "You"}
                {m.editedAt ? " (edited)" : ""}
              </span>
              {m.author === "me" && editingId !== m.id && (
                <div className="flex items-center gap-1">
                  <button
                    className="text-[10px] text-text-muted hover:text-text-primary"
                    onClick={() => startEdit(m.id, m.text)}
                  >
                    Edit
                  </button>
                  {m.id !== rootId && (
                    <button
                      className="text-[10px] text-text-muted hover:text-text-primary"
                      onClick={() => store.getState().deleteMessage(thread.id, m.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
            {editingId === m.id ? (
              <div className="flex flex-col gap-1">
                <textarea
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full resize-none rounded border border-border-default bg-background px-1.5 py-1 text-xs text-text-primary outline-none"
                  rows={2}
                />
                <div className="flex justify-end gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                  <Button size="xs" onClick={commitEdit}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words text-xs text-text-primary">{m.text}</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex items-end gap-1">
        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitReply();
            }
          }}
          placeholder="Reply…"
          rows={1}
          className="min-h-7 flex-1 resize-none rounded border border-border-default bg-background px-1.5 py-1 text-xs text-text-primary outline-none"
        />
        <Button size="sm" onClick={submitReply} disabled={!replyText.trim()}>
          Post
        </Button>
      </div>

      <div className="mt-1 flex justify-end">
        <Button size="xs" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment thread?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone — comments live outside the undo history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                store.getState().deleteThread(thread.id);
                setConfirmDelete(false);
                onClose();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DraftComposer({ screen }: { screen: Screen }) {
  const [text, setText] = useState("");
  const cancel = () => useCommentsStore.getState().cancelDraft();
  const submit = () => {
    useCommentsStore.getState().submitDraft(text);
    setText("");
  };

  return (
    <div style={{ position: "absolute", left: screen.left, top: screen.top, pointerEvents: "none" }}>
      {/* Ghost pin marking where the new thread will land. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -PIN_SIZE,
          width: PIN_SIZE,
          height: PIN_SIZE,
          borderRadius: "50% 50% 50% 0",
          background: "#0d99ff",
          border: "1.5px solid #fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        }}
      />
      <div
        data-comment-draft
        onPointerDown={(e) => e.stopPropagation()}
        style={{ position: "absolute", left: PIN_SIZE + 6, top: -PIN_SIZE, width: 240, pointerEvents: "auto" }}
        className="rounded-lg border border-border-default bg-surface-panel p-2 shadow-lg"
      >
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder="Add a comment…"
          rows={2}
          className="w-full resize-none rounded border border-border-default bg-background px-1.5 py-1 text-xs text-text-primary outline-none"
        />
        <div className="mt-1 flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button size="xs" onClick={submit} disabled={!text.trim()}>
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
