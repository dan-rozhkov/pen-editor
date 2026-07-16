import { describe, expect, it } from "vitest";
import { serializeDocument, deserializeDocument } from "@/utils/fileUtils";
import type { CommentThread } from "@/store/commentsStore";

const comments: CommentThread[] = [
  {
    id: "t1",
    order: 1,
    anchor: { kind: "node", nodeId: "rect1", ox: 0.5, oy: 0.25 },
    messages: [{ id: "m1", author: "me", text: "fix this", createdAt: 111 }],
  },
  {
    id: "t2",
    order: 2,
    anchor: { kind: "canvas", x: 40, y: 80 },
    messages: [
      { id: "m2", author: "me", text: "and this", createdAt: 222 },
      { id: "m3", author: "agent", text: "done", createdAt: 333 },
    ],
    resolvedAt: 444,
  },
];

describe(".pen comments round-trip", () => {
  it("preserves comments for a page through a save/load cycle", () => {
    const json = serializeDocument(
      [{ id: "page-1", name: "Page 1", nodes: [], pageBackground: "#f5f5f5", comments }],
      [],
      "light",
    );
    const data = deserializeDocument(json);
    expect(data.pages[0].comments).toEqual(comments);
  });

  it("defaults to an empty comments array when a page has none", () => {
    const json = serializeDocument(
      [{ id: "page-1", name: "Page 1", nodes: [], pageBackground: "#f5f5f5" }],
      [],
      "light",
    );
    const data = deserializeDocument(json);
    expect(data.pages[0].comments).toEqual([]);
  });

  it("defaults to an empty comments array for legacy single-page documents", () => {
    const legacyJson = JSON.stringify({ version: "1.0", nodes: [] });
    const data = deserializeDocument(legacyJson);
    expect(data.pages[0].comments).toEqual([]);
  });

  it("omits the comments key from JSON when a page has none (keeps files lean)", () => {
    const json = serializeDocument(
      [{ id: "page-1", name: "Page 1", nodes: [], pageBackground: "#f5f5f5", comments: [] }],
      [],
      "light",
    );
    const doc = JSON.parse(json);
    expect(doc.pages[0].comments).toBeUndefined();
  });
});
