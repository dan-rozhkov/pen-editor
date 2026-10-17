import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Container } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores } from "@/test/fixtures";
import { createPixiSync } from "../pixiSync";
import type { FlatFrameNode, TextNode } from "@/types/scene";

/**
 * Regression for the theme-refresh visibility gap: when a frame's
 * `themeOverride` changes, `incrementalUpdate`'s targeted THEME_SENTINEL pass
 * recolors every variable-dependent descendant of that frame (`subtreeIds`).
 * Those descendants are, by construction, excluded from `changedIds` (their
 * node objects didn't change — only their resolved colors did), yet the
 * sentinel diff in renderers/index.ts can still reset `container.visible`
 * for a node whose own `visible` field differs from the sentinel's
 * `undefined`. If a text node being edited (hidden via
 * `applyTextEditingVisibility`'s hide-while-editing rule) sits in that
 * subtree, it must stay hidden after the theme refresh.
 */
function flushFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("pixiSync: theme refresh preserves text-editing visibility", () => {
  let sceneRoot: Container;
  let dispose: () => void;

  beforeEach(() => {
    resetStores();
    sceneRoot = new Container();
  });

  afterEach(() => {
    dispose?.();
  });

  it("keeps a text-editing node's container hidden after its frame's themeOverride changes", async () => {
    const frame: FlatFrameNode = {
      id: "frame1",
      type: "frame",
      name: "Frame",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      fill: "#ffffff",
    } as FlatFrameNode;
    const text: TextNode = {
      id: "text1",
      type: "text",
      name: "Text",
      x: 10,
      y: 10,
      width: 100,
      height: 20,
      text: "Hello",
      fontSize: 14,
      // Explicit `visible: true` so the THEME_SENTINEL diff
      // (`node.visible !== prev.visible`, prev being the sentinel with
      // `visible: undefined`) actually re-touches `container.visible`.
      visible: true,
      fillBinding: { variableId: "var1" },
    } as unknown as TextNode;

    useSceneStore.setState({
      nodesById: { frame1: frame, text1: text },
      parentById: { frame1: null, text1: "frame1" },
      childrenById: { frame1: ["text1"], text1: [] },
      rootIds: ["frame1"],
    });

    dispose = createPixiSync(sceneRoot);
    await flushFrame();

    // Enter text-editing on the text node — its container hides while the
    // HTML inline editor overlays it.
    useSelectionStore.setState({ editingNodeId: "text1", editingMode: "text", selectedIds: ["text1"] });
    // applyTextEditingVisibility runs off a selection-store subscription in
    // pixiSync — no scene mutation needed for it to take effect.
    const textContainer = sceneRoot.getChildByLabel("text1", true)!;
    expect(textContainer).not.toBeNull();
    expect(textContainer.visible).toBe(false);

    // Change the frame's themeOverride — triggers the targeted THEME_SENTINEL
    // recolor pass over the frame's variable-dependent descendants (text1).
    useSceneStore.setState({
      nodesById: {
        frame1: { ...frame, themeOverride: "dark" },
        text1: text,
      },
    });
    await flushFrame();

    expect(textContainer.visible).toBe(false);
  });
});
