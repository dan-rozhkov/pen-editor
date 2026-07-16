import { describe, it, expect, beforeEach } from "vitest";
import { readComments } from "@/lib/tools/readComments";
import { replyComment } from "@/lib/tools/replyComment";
import { resolveComment } from "@/lib/tools/resolveComment";
import { useCommentsStore } from "@/store/commentsStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { CommentThread } from "@/store/commentsStore";

function seedThreads(threads: CommentThread[]): void {
  useCommentsStore.getState().setThreads(threads);
}

beforeEach(() => {
  resetStores();
  seedScene();
  useCommentsStore.getState().setThreads([]);
});

describe("read_comments", () => {
  it("returns a node-anchored thread with its nodeId and node name", async () => {
    seedThreads([
      {
        id: "t1",
        order: 1,
        anchor: { kind: "node", nodeId: "rect1", ox: 0.5, oy: 0.5 },
        messages: [{ id: "m1", author: "me", text: "fix padding", createdAt: 0 }],
      },
    ]);

    const result = JSON.parse(await readComments({}));
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]).toMatchObject({
      id: "t1",
      order: 1,
      nodeId: "rect1",
      nodeName: "Box",
    });
    expect(result.threads[0].messages[0]).toMatchObject({ author: "me", text: "fix padding" });
  });

  it("excludes resolved threads by default and includes them with includeResolved", async () => {
    seedThreads([
      {
        id: "t1",
        order: 1,
        anchor: { kind: "canvas", x: 0, y: 0 },
        messages: [{ id: "m1", author: "me", text: "open", createdAt: 0 }],
      },
      {
        id: "t2",
        order: 2,
        anchor: { kind: "canvas", x: 0, y: 0 },
        messages: [{ id: "m2", author: "me", text: "done", createdAt: 0 }],
        resolvedAt: 123,
      },
    ]);

    const openOnly = JSON.parse(await readComments({}));
    expect(openOnly.threads.map((t: { id: string }) => t.id)).toEqual(["t1"]);

    const all = JSON.parse(await readComments({ includeResolved: true }));
    expect(all.threads.map((t: { id: string }) => t.id)).toEqual(["t1", "t2"]);
  });

  it("filters to a single thread when threadId is given", async () => {
    seedThreads([
      {
        id: "t1",
        order: 1,
        anchor: { kind: "canvas", x: 0, y: 0 },
        messages: [{ id: "m1", author: "me", text: "a", createdAt: 0 }],
      },
      {
        id: "t2",
        order: 2,
        anchor: { kind: "canvas", x: 0, y: 0 },
        messages: [{ id: "m2", author: "me", text: "b", createdAt: 0 }],
      },
    ]);

    const result = JSON.parse(await readComments({ threadId: "t2" }));
    expect(result.threads.map((t: { id: string }) => t.id)).toEqual(["t2"]);
  });

  it("returns user-authored message text verbatim, not HTML-entity escaped", async () => {
    seedThreads([
      {
        id: "t1",
        order: 1,
        anchor: { kind: "canvas", x: 0, y: 0 },
        messages: [
          { id: "m1", author: "me", text: `don't shrink the <header> & "footer"`, createdAt: 0 },
        ],
      },
    ]);

    const raw = await readComments({});
    const result = JSON.parse(raw);
    expect(result.threads[0].messages[0].text).toBe(
      `don't shrink the <header> & "footer"`,
    );
  });

  it("marks a thread as unattached when its anchored node is gone", async () => {
    seedThreads([
      {
        id: "t1",
        order: 1,
        anchor: { kind: "node", nodeId: "ghost", ox: 0.5, oy: 0.5 },
        messages: [{ id: "m1", author: "me", text: "hi", createdAt: 0 }],
      },
    ]);

    const result = JSON.parse(await readComments({}));
    expect(result.threads[0].unattached).toBe(true);
    expect(result.threads[0].nodeId).toBe("ghost");
  });
});

describe("reply_comment", () => {
  it("appends an agent-authored message to the thread", async () => {
    seedThreads([
      {
        id: "t1",
        order: 1,
        anchor: { kind: "canvas", x: 0, y: 0 },
        messages: [{ id: "m1", author: "me", text: "please fix", createdAt: 0 }],
      },
    ]);

    const res = JSON.parse(await replyComment({ threadId: "t1", text: "done" }));
    expect(res.success).toBe(true);

    const thread = useCommentsStore.getState().threads[0];
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]).toMatchObject({ author: "agent", text: "done" });
  });

  it("returns an error for an unknown threadId", async () => {
    const res = JSON.parse(await replyComment({ threadId: "nope", text: "x" }));
    expect(res.error).toBeTruthy();
  });
});

describe("resolve_comment", () => {
  it("sets resolvedAt on the thread", async () => {
    seedThreads([
      {
        id: "t1",
        order: 1,
        anchor: { kind: "canvas", x: 0, y: 0 },
        messages: [{ id: "m1", author: "me", text: "please fix", createdAt: 0 }],
      },
    ]);

    const res = JSON.parse(await resolveComment({ threadId: "t1" }));
    expect(res.success).toBe(true);
    expect(useCommentsStore.getState().threads[0].resolvedAt).toBeTypeOf("number");
  });

  it("returns an error for an unknown threadId", async () => {
    const res = JSON.parse(await resolveComment({ threadId: "nope" }));
    expect(res.error).toBeTruthy();
  });
});
