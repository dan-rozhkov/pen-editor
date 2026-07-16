import { describe, expect, it } from "vitest";
import {
  nextOrder,
  resolveAnchorPoint,
  buildClickAnchor,
  isThreadUnattached,
  buildReadCommentsResult,
} from "@/lib/comments/commentsLogic";
import type { CommentThread } from "@/store/commentsStore";

describe("nextOrder", () => {
  it("returns 1 for an empty document", () => {
    expect(nextOrder([])).toBe(1);
  });

  it("returns max+1 across all given orders", () => {
    expect(nextOrder([1, 3, 2])).toBe(4);
  });

  it("ignores gaps — just tracks the running max", () => {
    expect(nextOrder([5])).toBe(6);
  });
});

describe("resolveAnchorPoint", () => {
  const lookup = (id: string) =>
    id === "rect1" ? { x: 100, y: 200, width: 50, height: 40 } : null;

  it("resolves a canvas anchor directly", () => {
    expect(resolveAnchorPoint({ kind: "canvas", x: 10, y: 20 }, lookup)).toEqual({
      x: 10,
      y: 20,
    });
  });

  it("resolves a node anchor using ox/oy fractions of the node's rect", () => {
    const point = resolveAnchorPoint(
      { kind: "node", nodeId: "rect1", ox: 0.5, oy: 0.25 },
      lookup,
    );
    expect(point).toEqual({ x: 100 + 0.5 * 50, y: 200 + 0.25 * 40 });
  });

  it("recomputes the world point when the node's rect changes (move/resize)", () => {
    const movedLookup = () => ({ x: 300, y: 300, width: 100, height: 100 });
    const point = resolveAnchorPoint(
      { kind: "node", nodeId: "rect1", ox: 0.5, oy: 0.5 },
      movedLookup,
    );
    expect(point).toEqual({ x: 350, y: 350 });
  });

  it("returns null (unattached) when the anchored node no longer exists", () => {
    const point = resolveAnchorPoint(
      { kind: "node", nodeId: "missing", ox: 0.5, oy: 0.5 },
      lookup,
    );
    expect(point).toBeNull();
  });
});

describe("buildClickAnchor", () => {
  it("builds a node anchor with ox/oy clamped to the node rect when a node is hit", () => {
    const anchor = buildClickAnchor(125, 220, {
      nodeId: "rect1",
      rect: { x: 100, y: 200, width: 50, height: 40 },
    });
    expect(anchor).toEqual({ kind: "node", nodeId: "rect1", ox: 0.5, oy: 0.5 });
  });

  it("clamps ox/oy to [0,1] even if the click point is slightly outside the rect", () => {
    const anchor = buildClickAnchor(1000, -1000, {
      nodeId: "rect1",
      rect: { x: 100, y: 200, width: 50, height: 40 },
    });
    expect(anchor).toEqual({ kind: "node", nodeId: "rect1", ox: 1, oy: 0 });
  });

  it("builds a canvas anchor when nothing was hit", () => {
    const anchor = buildClickAnchor(42, 84, null);
    expect(anchor).toEqual({ kind: "canvas", x: 42, y: 84 });
  });
});

describe("isThreadUnattached", () => {
  const thread = (anchor: CommentThread["anchor"]): CommentThread => ({
    id: "t1",
    order: 1,
    anchor,
    messages: [{ id: "m1", author: "me", text: "hi", createdAt: 0 }],
  });

  it("is false for a canvas-anchored thread", () => {
    expect(isThreadUnattached(thread({ kind: "canvas", x: 0, y: 0 }), {})).toBe(false);
  });

  it("is false when the anchored node exists", () => {
    expect(
      isThreadUnattached(thread({ kind: "node", nodeId: "rect1", ox: 0, oy: 0 }), {
        rect1: {},
      }),
    ).toBe(false);
  });

  it("is true when the anchored node is missing", () => {
    expect(
      isThreadUnattached(thread({ kind: "node", nodeId: "gone", ox: 0, oy: 0 }), {}),
    ).toBe(true);
  });
});

describe("buildReadCommentsResult", () => {
  const threads: CommentThread[] = [
    {
      id: "t1",
      order: 1,
      anchor: { kind: "node", nodeId: "rect1", ox: 0.5, oy: 0.5 },
      messages: [
        { id: "m1", author: "me", text: `don't shrink the <header> & "footer"`, createdAt: 0 },
      ],
    },
    {
      id: "t2",
      order: 2,
      anchor: { kind: "canvas", x: 1, y: 2 },
      messages: [{ id: "m2", author: "me", text: "second thread", createdAt: 0 }],
      resolvedAt: 123,
    },
  ];
  const nodesById = { rect1: { name: "Box" } };

  it("returns only unresolved threads by default", () => {
    const result = buildReadCommentsResult(threads, nodesById, {});
    expect(result.threads.map((t) => t.id)).toEqual(["t1"]);
  });

  it("includes resolved threads when includeResolved is true", () => {
    const result = buildReadCommentsResult(threads, nodesById, { includeResolved: true });
    expect(result.threads.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("filters to a single thread when threadId is given", () => {
    const result = buildReadCommentsResult(threads, nodesById, {
      includeResolved: true,
      threadId: "t2",
    });
    expect(result.threads.map((t) => t.id)).toEqual(["t2"]);
  });

  it("includes the anchored nodeId and node name for node-anchored threads", () => {
    const result = buildReadCommentsResult(threads, nodesById, {});
    expect(result.threads[0].nodeId).toBe("rect1");
    expect(result.threads[0].nodeName).toBe("Box");
  });

  it("returns message text verbatim, with no HTML-entity escaping", () => {
    const result = buildReadCommentsResult(threads, nodesById, {});
    expect(result.threads[0].messages[0].text).toBe(
      `don't shrink the <header> & "footer"`,
    );
  });

  it("marks unattached node-anchored threads whose node no longer exists", () => {
    const result = buildReadCommentsResult(threads, {}, {});
    expect(result.threads[0].nodeId).toBe("rect1");
    expect(result.threads[0].unattached).toBe(true);
  });
});
