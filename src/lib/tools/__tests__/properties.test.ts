import { describe, it, expect, beforeEach } from "vitest";
import { searchAllUniqueProperties } from "@/lib/tools/searchAllUniqueProperties";
import { replaceAllMatchingProperties } from "@/lib/tools/replaceAllMatchingProperties";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene, seedVariables } from "@/test/fixtures";
import type { FlatFrameNode, TextNode } from "@/types/scene";

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

  // Note: gap and padding rules each rebuild `layout` from the original node,
  // so combining both in one call would clobber the earlier change. They are
  // exercised in separate calls here (matching how the agent uses the tool).
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
