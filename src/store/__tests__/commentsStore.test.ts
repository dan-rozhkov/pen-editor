import { describe, expect, it, beforeEach } from "vitest";
import { useCommentsStore } from "@/store/commentsStore";
import { usePageStore } from "@/store/pageStore";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";

function pastLen() {
  return useHistoryStore.getState().past.length;
}

beforeEach(() => {
  resetStores();
  seedScene();
  useCommentsStore.setState({ threads: [], draftAnchor: null });
  // Reset pageStore to a single empty page so cross-page order lookup is deterministic.
  usePageStore.setState({
    pages: [
      {
        id: "p1",
        name: "Page 1",
        nodesById: {},
        parentById: {},
        childrenById: {},
        rootIds: [],
        pageBackground: "#f5f5f5",
        expandedFrameIds: new Set<string>(),
        viewport: { scale: 1, x: 0, y: 0 },
        history: { past: [], future: [] },
        guides: [],
        slideOrder: [],
        measurements: [],
      },
    ],
    activePageId: "p1",
  } as never);
});

describe("commentsStore", () => {
  it("starts empty with no draft", () => {
    expect(useCommentsStore.getState().threads).toEqual([]);
    expect(useCommentsStore.getState().draftAnchor).toBeNull();
  });

  it("submitDraft creates a thread from the draft anchor with a root 'me' message", () => {
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 10, y: 20 });
    const id = useCommentsStore.getState().submitDraft("please fix this");

    const { threads, draftAnchor } = useCommentsStore.getState();
    expect(id).toBeTruthy();
    expect(threads).toHaveLength(1);
    expect(threads[0].anchor).toEqual({ kind: "canvas", x: 10, y: 20 });
    expect(threads[0].messages[0]).toMatchObject({ author: "me", text: "please fix this" });
    expect(threads[0].order).toBe(1);
    expect(draftAnchor).toBeNull();
  });

  it("submitDraft is a no-op with empty text or no draft", () => {
    expect(useCommentsStore.getState().submitDraft("hi")).toBeNull(); // no draft
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    expect(useCommentsStore.getState().submitDraft("   ")).toBeNull(); // empty text
    expect(useCommentsStore.getState().threads).toHaveLength(0);
  });

  it("order increments as max+1 across existing threads", () => {
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    useCommentsStore.getState().submitDraft("a");
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 1, y: 1 });
    useCommentsStore.getState().submitDraft("b");

    const orders = useCommentsStore.getState().threads.map((t) => t.order);
    expect(orders).toEqual([1, 2]);
  });

  it("order counts threads on OTHER pages too (document-wide counter)", () => {
    usePageStore.setState((s) => ({
      pages: s.pages.map((p) =>
        p.id === "p1"
          ? {
              ...p,
              comments: [
                {
                  id: "old",
                  order: 7,
                  anchor: { kind: "canvas", x: 0, y: 0 },
                  messages: [{ id: "mm", author: "me", text: "x", createdAt: 0 }],
                },
              ],
            }
          : p,
      ),
    }));

    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    useCommentsStore.getState().submitDraft("new");
    expect(useCommentsStore.getState().threads[0].order).toBe(8);
  });

  it("addReply appends a message with the given author", () => {
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    const id = useCommentsStore.getState().submitDraft("root")!;
    useCommentsStore.getState().addReply(id, "agent", "on it");

    const t = useCommentsStore.getState().threads[0];
    expect(t.messages).toHaveLength(2);
    expect(t.messages[1]).toMatchObject({ author: "agent", text: "on it" });
  });

  it("editMessage edits a 'me' message and stamps editedAt", () => {
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    const id = useCommentsStore.getState().submitDraft("typo heer")!;
    const msgId = useCommentsStore.getState().threads[0].messages[0].id;
    useCommentsStore.getState().editMessage(id, msgId, "typo here");

    const m = useCommentsStore.getState().threads[0].messages[0];
    expect(m.text).toBe("typo here");
    expect(m.editedAt).toBeTypeOf("number");
  });

  it("editMessage does not touch an agent message", () => {
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    const id = useCommentsStore.getState().submitDraft("root")!;
    useCommentsStore.getState().addReply(id, "agent", "agent text");
    const agentMsgId = useCommentsStore.getState().threads[0].messages[1].id;

    useCommentsStore.getState().editMessage(id, agentMsgId, "hacked");
    expect(useCommentsStore.getState().threads[0].messages[1].text).toBe("agent text");
  });

  it("deleteMessage removes a reply but never the root", () => {
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    const id = useCommentsStore.getState().submitDraft("root")!;
    useCommentsStore.getState().addReply(id, "me", "reply");
    const rootId = useCommentsStore.getState().threads[0].messages[0].id;
    const replyId = useCommentsStore.getState().threads[0].messages[1].id;

    useCommentsStore.getState().deleteMessage(id, rootId); // no-op on root
    expect(useCommentsStore.getState().threads[0].messages).toHaveLength(2);

    useCommentsStore.getState().deleteMessage(id, replyId);
    expect(useCommentsStore.getState().threads[0].messages).toHaveLength(1);
  });

  it("deleteThread removes the whole thread", () => {
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    const id = useCommentsStore.getState().submitDraft("root")!;
    useCommentsStore.getState().deleteThread(id);
    expect(useCommentsStore.getState().threads).toEqual([]);
  });

  it("resolveThread / unresolveThread toggle resolvedAt", () => {
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    const id = useCommentsStore.getState().submitDraft("root")!;

    useCommentsStore.getState().resolveThread(id);
    expect(useCommentsStore.getState().threads[0].resolvedAt).toBeTypeOf("number");

    useCommentsStore.getState().unresolveThread(id);
    expect(useCommentsStore.getState().threads[0].resolvedAt).toBeUndefined();
  });

  it("updateAnchor repositions a pin", () => {
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    const id = useCommentsStore.getState().submitDraft("root")!;
    useCommentsStore.getState().updateAnchor(id, { kind: "node", nodeId: "rect1", ox: 0.2, oy: 0.3 });
    expect(useCommentsStore.getState().threads[0].anchor).toEqual({
      kind: "node",
      nodeId: "rect1",
      ox: 0.2,
      oy: 0.3,
    });
  });

  it("a scene edit's undo/redo leaves the comments snapshot identical", () => {
    useCommentsStore.getState().startDraft({ kind: "node", nodeId: "rect1", ox: 0.5, oy: 0.5 });
    useCommentsStore.getState().submitDraft("comment on rect1");
    const before = JSON.stringify(useCommentsStore.getState().threads);

    // Perform a real, undoable scene edit.
    useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
    useSceneStore.getState().updateNode("rect1", { x: 999 } as never);

    // Undo then redo the scene edit.
    const s1 = createSnapshot(useSceneStore.getState());
    const prev = useHistoryStore.getState().undo(s1);
    if (prev) useSceneStore.getState().restoreSnapshot(prev);
    const s2 = createSnapshot(useSceneStore.getState());
    const next = useHistoryStore.getState().redo(s2);
    if (next) useSceneStore.getState().restoreSnapshot(next);

    expect(JSON.stringify(useCommentsStore.getState().threads)).toBe(before);
  });

  it("does NOT record undo history for any comment operation (comments are outside undo/redo)", () => {
    const before = pastLen();
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 0, y: 0 });
    const id = useCommentsStore.getState().submitDraft("root")!;
    useCommentsStore.getState().addReply(id, "me", "r");
    useCommentsStore.getState().resolveThread(id);
    useCommentsStore.getState().deleteThread(id);
    expect(pastLen()).toBe(before);
  });
});
