import { describe, it, expect, beforeEach } from "vitest";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import type { TextNode } from "@/types/scene";
import { resetStores, seedScene, seedTextStyles } from "@/test/fixtures";

function text1(): TextNode {
  return useSceneStore.getState().nodesById["text1"] as unknown as TextNode;
}

// Replicate the real undo cycle (see sceneStore/__tests__/mutations.test.ts):
// snapshot current -> ask history for the target -> restore it if present.
function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
  return prev;
}

describe("textStyleStore", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    seedTextStyles();
  });

  it("applyStyleToNode binds the style and copies its properties onto the node", () => {
    useTextStyleStore.getState().applyStyleToNode("text1", "style-heading");
    const node = text1();
    expect(node.textStyleId).toBe("style-heading");
    expect(node.textStyleOverrides).toEqual([]);
    expect(node.fontFamily).toBe("Inter");
    expect(node.fontSize).toBe(32);
    expect(node.fontWeight).toBe("700");
    expect(node.lineHeight).toBe(1.1);
    expect(node.letterSpacing).toBe(-0.5);
  });

  it("updateTextStyle propagates the change to every bound node", () => {
    useTextStyleStore.getState().applyStyleToNode("text1", "style-heading");
    useTextStyleStore.getState().updateTextStyle("style-heading", { fontSize: 40 });
    expect(text1().fontSize).toBe(40);
    expect(useTextStyleStore.getState().textStyles[0].fontSize).toBe(40);
  });

  it("a local override on a node survives a subsequent centralized style edit", () => {
    useTextStyleStore.getState().applyStyleToNode("text1", "style-heading");
    // Simulate a local edit: node.fontSize diverges and the key is recorded as overridden.
    useSceneStore.getState().updateNode("text1", {
      fontSize: 20,
      textStyleOverrides: ["fontSize"],
    });
    useTextStyleStore.getState().updateTextStyle("style-heading", { fontSize: 40, fontWeight: "900" });
    const node = text1();
    expect(node.fontSize).toBe(20); // untouched — locally overridden
    expect(node.fontWeight).toBe("900"); // still tracks the style
  });

  it("detachStyleFromNode clears the binding but keeps the current literal values", () => {
    useTextStyleStore.getState().applyStyleToNode("text1", "style-heading");
    useTextStyleStore.getState().detachStyleFromNode("text1");
    const node = text1();
    expect(node.textStyleId).toBeUndefined();
    expect(node.textStyleOverrides).toBeUndefined();
    expect(node.fontSize).toBe(32); // baked value stays
  });

  it("deleteTextStyle unbinds every node that referenced it", () => {
    useTextStyleStore.getState().applyStyleToNode("text1", "style-heading");
    useTextStyleStore.getState().deleteTextStyle("style-heading");
    expect(useTextStyleStore.getState().textStyles).toEqual([]);
    expect(text1().textStyleId).toBeUndefined();
  });

  it("updateTextStyle's edit + propagation collapse into a single undo step", () => {
    useTextStyleStore.getState().applyStyleToNode("text1", "style-heading");
    const pastBefore = useHistoryStore.getState().past.length;
    useTextStyleStore.getState().updateTextStyle("style-heading", { fontSize: 40 });
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
  });

  it("createStyleFromNode creates a style from the node's current typography and binds it", () => {
    const style = useTextStyleStore.getState().createStyleFromNode("text1", "Body/M");
    expect(style).not.toBeNull();
    expect(style?.fontFamily).toBe("Arial");
    expect(style?.fontSize).toBe(16);
    expect(text1().textStyleId).toBe(style?.id);
    expect(useTextStyleStore.getState().textStyles).toHaveLength(2);
  });

  describe("undo/redo", () => {
    it("undoing a style edit reverts the style record, not just the node", () => {
      useTextStyleStore.getState().applyStyleToNode("text1", "style-heading");
      useTextStyleStore.getState().updateTextStyle("style-heading", { fontSize: 40 });
      expect(useTextStyleStore.getState().textStyles[0].fontSize).toBe(40);

      undo();

      expect(useTextStyleStore.getState().textStyles[0].fontSize).toBe(32);
      expect(text1().fontSize).toBe(32);
    });

    it("undoing a style deletion restores the style record so the node's textStyleId is valid again", () => {
      useTextStyleStore.getState().applyStyleToNode("text1", "style-heading");
      useTextStyleStore.getState().deleteTextStyle("style-heading");
      expect(useTextStyleStore.getState().textStyles).toEqual([]);

      undo();

      const styles = useTextStyleStore.getState().textStyles;
      expect(styles).toHaveLength(1);
      expect(styles[0].id).toBe("style-heading");
      expect(text1().textStyleId).toBe("style-heading");
    });
  });
});
