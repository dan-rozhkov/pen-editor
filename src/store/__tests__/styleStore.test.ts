import { describe, it, expect, beforeEach } from "vitest";
import { useStyleStore } from "@/store/styleStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import type { RectNode, SolidPaint } from "@/types/scene";
import { resetStores, seedScene, seedFillStyles, seedEffectStyles } from "@/test/fixtures";

function rect1(): RectNode {
  return useSceneStore.getState().nodesById["rect1"] as unknown as RectNode;
}

function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
  return prev;
}

describe("styleStore — fill styles", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    seedFillStyles();
  });

  it("applyFillStyleToNode adds a new style-bound paint layer when the node has none", () => {
    useStyleStore.getState().applyFillStyleToNode("rect1", "fillstyle-brand");
    const node = rect1();
    expect(node.fills).toHaveLength(1);
    expect(node.fills![0].styleId).toBe("fillstyle-brand");
  });

  it("applyFillStyleToNode binds the topmost existing paint layer, preserving the layer id", () => {
    useSceneStore.getState().updateNode("rect1", {
      fills: [{ id: "p1", type: "solid", color: "#ff0000" }],
    });
    useStyleStore.getState().applyFillStyleToNode("rect1", "fillstyle-brand");
    const node = rect1();
    expect(node.fills).toHaveLength(1);
    expect(node.fills![0].id).toBe("p1");
    expect(node.fills![0].styleId).toBe("fillstyle-brand");
  });

  it("applyFillStyleToPaint binds a specific paint layer by id", () => {
    useSceneStore.getState().updateNode("rect1", {
      fills: [
        { id: "p1", type: "solid", color: "#ff0000" },
        { id: "p2", type: "solid", color: "#00ff00" },
      ],
    });
    useStyleStore.getState().applyFillStyleToPaint("rect1", "p1", "fillstyle-brand");
    const node = rect1();
    expect(node.fills![0].styleId).toBe("fillstyle-brand");
    expect(node.fills![1].styleId).toBeUndefined();
  });

  it("updateFillStyle needs no propagation step — referencing paints re-resolve live from the store", () => {
    useStyleStore.getState().applyFillStyleToNode("rect1", "fillstyle-brand");
    useStyleStore.getState().updateFillStyle("fillstyle-brand", {
      paint: { id: "x", type: "solid", color: "#abcdef" },
    });
    // The node's own paint layer is untouched — only `styleId` is stored on it.
    expect(rect1().fills![0].styleId).toBe("fillstyle-brand");
    expect(useStyleStore.getState().fillStyles[0].paint).toMatchObject({ color: "#abcdef" });
  });

  it("detachFillStyleFromPaint inlines the style's current paint and clears styleId", () => {
    useStyleStore.getState().applyFillStyleToNode("rect1", "fillstyle-brand");
    const paintId = rect1().fills![0].id;
    useStyleStore.getState().detachFillStyleFromPaint("rect1", paintId);
    const node = rect1();
    expect(node.fills![0].styleId).toBeUndefined();
    expect(node.fills![0]).toMatchObject({ type: "solid", color: "#3366ff" });
    expect(node.fills![0].id).toBe(paintId);
  });

  it("detach survives a later style edit (the node keeps the pre-detach literal value)", () => {
    useStyleStore.getState().applyFillStyleToNode("rect1", "fillstyle-brand");
    const paintId = rect1().fills![0].id;
    useStyleStore.getState().detachFillStyleFromPaint("rect1", paintId);
    useStyleStore.getState().updateFillStyle("fillstyle-brand", {
      paint: { id: "x", type: "solid", color: "#000000" },
    });
    expect(rect1().fills![0]).toMatchObject({ color: "#3366ff" });
  });

  it("detach FREEZES the theme-resolved value when the style references a variable", () => {
    // Fill style whose solid paint is bound to a variable with per-theme values.
    useVariableStore.setState({
      variables: [
        {
          id: "var-brand",
          name: "--brand",
          type: "color",
          value: "#3366ff",
          themeValues: { light: "#3366ff", dark: "#99bbff" },
        },
      ],
    });
    useStyleStore.setState({
      fillStyles: [
        {
          id: "fs-var",
          name: "Brand/Var",
          paint: {
            id: "sp",
            type: "solid",
            color: "#000000",
            colorBinding: { variableId: "var-brand" },
          },
        },
      ],
    });
    useThemeStore.getState().setActiveTheme("light");
    useStyleStore.getState().applyFillStyleToNode("rect1", "fs-var");
    const paintId = rect1().fills![0].id;

    // Detach under LIGHT — should freeze the light value and drop the binding.
    useStyleStore.getState().detachFillStyleFromPaint("rect1", paintId);
    const detached = rect1().fills![0] as SolidPaint;
    expect(detached.styleId).toBeUndefined();
    expect(detached.colorBinding).toBeUndefined();
    expect(detached.color).toBe("#3366ff");

    // Switching to DARK must NOT change the frozen value.
    useThemeStore.getState().setActiveTheme("dark");
    expect((rect1().fills![0] as SolidPaint).color).toBe("#3366ff");
  });

  it("deleteFillStyle leaves dangling styleId references (fallback to inline value at render time)", () => {
    useStyleStore.getState().applyFillStyleToNode("rect1", "fillstyle-brand");
    useStyleStore.getState().deleteFillStyle("fillstyle-brand");
    expect(useStyleStore.getState().fillStyles).toEqual([]);
    expect(rect1().fills![0].styleId).toBe("fillstyle-brand");
  });

  describe("undo/redo", () => {
    it("undoing a fill-style edit reverts the style record", () => {
      useStyleStore.getState().updateFillStyle("fillstyle-brand", {
        paint: { id: "x", type: "solid", color: "#111111" },
      });
      expect(useStyleStore.getState().fillStyles[0].paint).toMatchObject({ color: "#111111" });
      undo();
      expect(useStyleStore.getState().fillStyles[0].paint).toMatchObject({ color: "#3366ff" });
    });
  });
});

describe("styleStore — effect styles", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    seedEffectStyles();
  });

  it("applyEffectStyleToNode sets effectStyleId without touching node.effects", () => {
    useStyleStore.getState().applyEffectStyleToNode("rect1", "effectstyle-card");
    expect(rect1().effectStyleId).toBe("effectstyle-card");
    expect(rect1().effects).toBeUndefined();
  });

  it("detachEffectStyleFromNode inlines the style's effects and clears effectStyleId", () => {
    useStyleStore.getState().applyEffectStyleToNode("rect1", "effectstyle-card");
    useStyleStore.getState().detachEffectStyleFromNode("rect1");
    const node = rect1();
    expect(node.effectStyleId).toBeUndefined();
    expect(node.effects).toHaveLength(1);
    expect(node.effects![0]).toMatchObject({ type: "shadow", blur: 8 });
  });

  it("updateEffectStyle needs no propagation — the node re-resolves the stack live", () => {
    useStyleStore.getState().applyEffectStyleToNode("rect1", "effectstyle-card");
    useStyleStore.getState().updateEffectStyle("effectstyle-card", {
      effects: [
        { type: "blur", radius: 12, id: "b1" },
      ],
    });
    expect(rect1().effectStyleId).toBe("effectstyle-card");
    expect(useStyleStore.getState().effectStyles[0].effects[0]).toMatchObject({ type: "blur", radius: 12 });
  });

  it("detach FREEZES each shadow's theme-resolved color when the style references a variable", () => {
    useVariableStore.setState({
      variables: [
        {
          id: "var-shadow",
          name: "--shadow",
          type: "color",
          value: "#111111",
          themeValues: { light: "#111111", dark: "#eeeeee" },
        },
      ],
    });
    useStyleStore.setState({
      effectStyles: [
        {
          id: "es-var",
          name: "Card/Var",
          effects: [
            {
              type: "shadow",
              shadowType: "outer",
              color: "#000000",
              colorBinding: { variableId: "var-shadow" },
              offset: { x: 0, y: 4 },
              blur: 8,
              spread: 0,
              id: "e1",
            },
          ],
        },
      ],
    });
    useThemeStore.getState().setActiveTheme("light");
    useStyleStore.getState().applyEffectStyleToNode("rect1", "es-var");

    useStyleStore.getState().detachEffectStyleFromNode("rect1");
    const shadow = rect1().effects![0] as import("@/types/scene").ShadowEffect;
    expect(rect1().effectStyleId).toBeUndefined();
    expect(shadow.colorBinding).toBeUndefined();
    expect(shadow.color).toBe("#111111");

    useThemeStore.getState().setActiveTheme("dark");
    expect((rect1().effects![0] as import("@/types/scene").ShadowEffect).color).toBe("#111111");
  });

  it("deleteEffectStyle unbinds every node that referenced it is NOT automatic (dangling reference kept, like fill styles)", () => {
    useStyleStore.getState().applyEffectStyleToNode("rect1", "effectstyle-card");
    useStyleStore.getState().deleteEffectStyle("effectstyle-card");
    expect(useStyleStore.getState().effectStyles).toEqual([]);
    expect(rect1().effectStyleId).toBe("effectstyle-card");
  });
});
