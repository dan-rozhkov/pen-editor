import { describe, expect, it } from "vitest";
import { findThreadLocation, centerOffsetForPoint } from "@/lib/comments/commentNavigation";
import type { CommentThread } from "@/store/commentsStore";

const t = (id: string): CommentThread => ({
  id,
  order: 1,
  anchor: { kind: "canvas", x: 0, y: 0 },
  messages: [{ id: "m", author: "me", text: "x", createdAt: 0 }],
});

describe("findThreadLocation", () => {
  it("finds a thread on the current page (pageId null = active)", () => {
    const loc = findThreadLocation("a", [t("a")], []);
    expect(loc).toEqual({ pageId: null, thread: t("a") });
  });

  it("finds a thread on another page", () => {
    const pages = [
      { id: "p2", comments: [t("b")] },
      { id: "p3", comments: [t("c")] },
    ];
    const loc = findThreadLocation("c", [], pages);
    expect(loc?.pageId).toBe("p3");
    expect(loc?.thread.id).toBe("c");
  });

  it("returns null when the thread exists nowhere", () => {
    expect(findThreadLocation("zzz", [t("a")], [{ id: "p2", comments: [t("b")] }])).toBeNull();
  });
});

describe("centerOffsetForPoint", () => {
  it("computes the pan offset that centers a world point in the viewport", () => {
    // screen = world*scale + pan  ⇒  pan = viewportCenter - world*scale
    const offset = centerOffsetForPoint({ x: 100, y: 50 }, 2, { width: 800, height: 600 });
    expect(offset).toEqual({ x: 400 - 200, y: 300 - 100 });
  });
});
