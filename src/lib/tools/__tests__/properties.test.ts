import { describe, it, expect, beforeEach } from "vitest";
import { searchAllUniqueProperties } from "@/lib/tools/searchAllUniqueProperties";
import { replaceAllMatchingProperties } from "@/lib/tools/replaceAllMatchingProperties";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene, seedVariables } from "@/test/fixtures";
import type { FlatFrameNode, Paint, TextNode } from "@/types/scene";

/** Add a node with a multi-paint `fills` stack as a child of frame1. */
function seedNodeWithFills(
  id: string,
  fills: Paint[],
  extra: Record<string, unknown> = {},
): void {
  useSceneStore.setState((state) => ({
    nodesById: {
      ...state.nodesById,
      [id]: {
        id,
        type: "rect",
        x: 0,
        y: 0,
        width: 5,
        height: 5,
        fills,
        ...extra,
      } as unknown as never,
    },
    parentById: { ...state.parentById, [id]: "frame1" },
    childrenById: {
      ...state.childrenById,
      frame1: [...state.childrenById["frame1"], id],
    },
  }));
}

beforeEach(() => {
  resetStores();
  seedScene();
});

describe("search_all_unique_properties", () => {
  it("validates required arguments", async () => {
    expect(JSON.parse(await searchAllUniqueProperties({}))).toEqual({
      error: "No parent IDs provided",
    });
    expect(
      JSON.parse(await searchAllUniqueProperties({ parents: ["frame1"] }))
    ).toEqual({ error: "No properties specified" });
  });

  it("collects unique fill colors across a subtree", async () => {
    const result = JSON.parse(
      await searchAllUniqueProperties({
        parents: ["frame1"],
        properties: ["fillColor"],
      })
    );
    expect(result.fillColor).toEqual(
      expect.arrayContaining(["#ffffff", "#ff0000", "#000000"])
    );
    expect(result.fillColor).toHaveLength(3);
  });

  it("collects text-only and frame-only properties", async () => {
    const result = JSON.parse(
      await searchAllUniqueProperties({
        parents: ["frame1"],
        properties: ["fontSize", "cornerRadius", "gap"],
      })
    );
    expect(result.fontSize).toEqual([16]);
    expect(result.cornerRadius).toEqual([4]);
    expect(result.gap).toEqual([8]);
  });

  it("deduplicates repeated values", async () => {
    // rect2 has the same fill as nothing else; add a second red rect
    useSceneStore.setState((state) => ({
      nodesById: {
        ...state.nodesById,
        rect3: { id: "rect3", type: "rect", x: 0, y: 0, width: 5, height: 5, fill: "#ff0000" },
      },
      parentById: { ...state.parentById, rect3: "frame1" },
      childrenById: {
        ...state.childrenById,
        frame1: [...state.childrenById["frame1"], "rect3"],
      },
    }));

    const result = JSON.parse(
      await searchAllUniqueProperties({
        parents: ["frame1"],
        properties: ["fillColor"],
      })
    );
    expect(
      result.fillColor.filter((c: string) => c === "#ff0000")
    ).toHaveLength(1);
  });

  it("collects solid colors from the fills paint stack", async () => {
    seedNodeWithFills("rectF", [
      { id: "p1", type: "solid", color: "#abcdef" },
      { id: "p2", type: "gradient", gradient: { type: "linear", stops: [], startX: 0, startY: 0, endX: 1, endY: 1 } },
      { id: "p3", type: "solid", color: "#fedcba" },
    ]);

    const result = JSON.parse(
      await searchAllUniqueProperties({
        parents: ["frame1"],
        properties: ["fillColor"],
      })
    );
    // legacy fills (#ffffff frame, #ff0000 rect1, #000000 text1) + both solid
    // paints from the stack; the gradient paint contributes no fillColor.
    expect(result.fillColor).toEqual(
      expect.arrayContaining(["#abcdef", "#fedcba", "#ff0000", "#000000"])
    );
  });

  it("collects textColor from text nodes using the fills paint stack", async () => {
    seedNodeWithFills(
      "textF",
      [
        { id: "p1", type: "solid", color: "#111111" },
        { id: "p2", type: "solid", color: "#abcdef" },
      ],
      { type: "text", text: "Hi", fontSize: 14 },
    );

    const result = JSON.parse(
      await searchAllUniqueProperties({
        parents: ["frame1"],
        properties: ["textColor"],
      })
    );
    // text1 contributes its legacy fill; textF contributes the topmost solid
    // paint of its stack (not the bottom one).
    expect(result.textColor).toEqual(
      expect.arrayContaining(["#000000", "#abcdef"])
    );
    expect(result.textColor).not.toContain("#111111");
  });
});

describe("replace_all_matching_properties", () => {
  it("validates required arguments", async () => {
    expect(JSON.parse(await replaceAllMatchingProperties({}))).toEqual({
      error: "No parent IDs provided",
    });
    expect(
      JSON.parse(await replaceAllMatchingProperties({ parents: ["frame1"] }))
    ).toEqual({ error: "No property replacements specified" });
  });

  it("replaces matching fill colors case-insensitively and saves history", async () => {
    const result = JSON.parse(
      await replaceAllMatchingProperties({
        parents: ["frame1"],
        properties: {
          fillColor: [{ from: "#FF0000", to: "#123456" }],
        },
      })
    );
    expect(result).toEqual({ success: true, replacements: 1 });
    expect(useSceneStore.getState().nodesById["rect1"].fill).toBe("#123456");
    // text1 fill (#000000) untouched
    expect(useSceneStore.getState().nodesById["text1"].fill).toBe("#000000");
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it("binds a variable when the replacement value is a $reference", async () => {
    seedVariables();
    const result = JSON.parse(
      await replaceAllMatchingProperties({
        parents: ["frame1"],
        properties: {
          fillColor: [{ from: "#ff0000", to: "$--primary" }],
        },
      })
    );
    expect(result.replacements).toBe(1);
    const rect = useSceneStore.getState().nodesById["rect1"] as Record<
      string,
      unknown
    >;
    expect(rect.fill).toBe("#3366ff");
    expect(rect.fillBinding).toEqual({ variableId: "var-primary" });
  });

  it("replaces text-scoped properties only on text nodes", async () => {
    const result = JSON.parse(
      await replaceAllMatchingProperties({
        parents: ["frame1"],
        properties: {
          fontSize: [{ from: 16, to: 24 }],
          textColor: [{ from: "#000000", to: "#444444" }],
        },
      })
    );
    expect(result.replacements).toBe(2);
    const text = useSceneStore.getState().nodesById["text1"] as TextNode;
    expect(text.fontSize).toBe(24);
    expect(text.fill).toBe("#444444");
  });

  it("replaces layout padding on frames (all matching sides)", async () => {
    const result = JSON.parse(
      await replaceAllMatchingProperties({
        parents: ["frame1"],
        properties: { padding: [{ from: 16, to: 32 }] },
      })
    );
    expect(result.replacements).toBe(1);
    const frame = useSceneStore.getState().nodesById["frame1"] as FlatFrameNode;
    expect(frame.layout?.paddingTop).toBe(32);
    expect(frame.layout?.paddingRight).toBe(32);
    expect(frame.layout?.paddingBottom).toBe(32);
    expect(frame.layout?.paddingLeft).toBe(32);
  });

  it("replaces layout gap on frames", async () => {
    const result = JSON.parse(
      await replaceAllMatchingProperties({
        parents: ["frame1"],
        properties: { gap: [{ from: 8, to: 12 }] },
      })
    );
    expect(result.replacements).toBe(1);
    const frame = useSceneStore.getState().nodesById["frame1"] as FlatFrameNode;
    expect(frame.layout?.gap).toBe(12);
    expect(frame.layout?.paddingTop).toBe(16);
  });

  it("applies padding and gap rules together in one call", async () => {
    const result = JSON.parse(
      await replaceAllMatchingProperties({
        parents: ["frame1"],
        properties: {
          padding: [{ from: 16, to: 32 }],
          gap: [{ from: 8, to: 12 }],
        },
      })
    );
    expect(result.replacements).toBe(2);
    const frame = useSceneStore.getState().nodesById["frame1"] as FlatFrameNode;
    expect(frame.layout?.paddingTop).toBe(32);
    expect(frame.layout?.paddingRight).toBe(32);
    expect(frame.layout?.paddingBottom).toBe(32);
    expect(frame.layout?.paddingLeft).toBe(32);
    expect(frame.layout?.gap).toBe(12);
  });

  it("replaces matching solid colors inside the fills stack", async () => {
    seedNodeWithFills("rectF", [
      { id: "p1", type: "solid", color: "#ff0000" },
      { id: "p2", type: "image", image: { url: "https://x/a.png", mode: "fill" } },
    ]);

    const result = JSON.parse(
      await replaceAllMatchingProperties({
        parents: ["frame1"],
        properties: { fillColor: [{ from: "#FF0000", to: "#123456" }] },
      })
    );
    // rect1 (legacy fill) + the solid paint in rectF's stack
    expect(result.replacements).toBe(2);
    const fills = useSceneStore.getState().nodesById["rectF"].fills as Paint[];
    expect(fills[0]).toMatchObject({ type: "solid", color: "#123456" });
    // non-solid paint untouched
    expect(fills[1].type).toBe("image");
  });

  it("binds a variable when replacing a color inside the fills stack", async () => {
    seedVariables();
    seedNodeWithFills("rectF", [{ id: "p1", type: "solid", color: "#ff0000" }]);

    const result = JSON.parse(
      await replaceAllMatchingProperties({
        parents: ["rectF"],
        properties: { fillColor: [{ from: "#ff0000", to: "$--primary" }] },
      })
    );
    expect(result.replacements).toBe(1);
    const fills = useSceneStore.getState().nodesById["rectF"].fills as Paint[];
    expect(fills[0]).toMatchObject({
      type: "solid",
      color: "#3366ff",
      colorBinding: { variableId: "var-primary" },
    });
  });

  it("ignores the legacy fill field on nodes that use a fills stack", async () => {
    // The renderer ignores legacy `fill` once `fills` is set — "replacing" it
    // must not count as a replacement.
    seedNodeWithFills("rectF", [{ id: "p1", type: "solid", color: "#abcdef" }], {
      fill: "#ff0000",
    });

    const result = JSON.parse(
      await replaceAllMatchingProperties({
        parents: ["rectF"],
        properties: { fillColor: [{ from: "#ff0000", to: "#123456" }] },
      })
    );
    expect(result).toEqual({ success: true, replacements: 0 });
    const node = useSceneStore.getState().nodesById["rectF"];
    expect(node.fill).toBe("#ff0000"); // stale legacy field left untouched
    expect((node.fills as Paint[])[0]).toMatchObject({ color: "#abcdef" });
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });

  it("reports zero replacements and skips history when nothing matches", async () => {
    const result = JSON.parse(
      await replaceAllMatchingProperties({
        parents: ["frame1"],
        properties: { fillColor: [{ from: "#abcdef", to: "#000000" }] },
      })
    );
    expect(result).toEqual({ success: true, replacements: 0 });
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });
});
