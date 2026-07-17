import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Container } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores } from "@/test/fixtures";
import { createPixiSync } from "../pixiSync";
import type { FlatSceneNode } from "@/types/scene";

/**
 * Targeted `applyTextEditingVisibility` (Task 7): a selection/editing-mode
 * change must only touch containers whose visibility can actually flip
 * (the edited node + present-mode override deltas), not the entire
 * registry. This test instruments a spread of unrelated containers with a
 * `visible`-setter spy installed AFTER the initial build, so only the
 * targeted resync (not the full-pass fullRebuild) is under test.
 */
function flushFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function rect(id: string, x: number): FlatSceneNode {
  return { id, type: "rect", x, y: 0, width: 20, height: 20, fill: "#ff0000" } as unknown as FlatSceneNode;
}

function text(id: string, x: number): FlatSceneNode {
  return { id, type: "text", x, y: 0, width: 20, height: 20, characters: "hi", fontSize: 12 } as unknown as FlatSceneNode;
}

describe("pixiSync: targeted applyTextEditingVisibility", () => {
  let sceneRoot: Container;
  let dispose: () => void;

  beforeEach(() => {
    resetStores();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    sceneRoot = new Container();
  });

  afterEach(() => {
    dispose?.();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });

  it("selection change touches only override-affected containers", async () => {
    const nodesById: Record<string, FlatSceneNode> = { t1: text("t1", 0) };
    const rootIds = ["t1"];
    for (let i = 0; i < 199; i++) {
      const id = `r${i}`;
      nodesById[id] = rect(id, (i + 1) * 30);
      rootIds.push(id);
    }
    const childrenById: Record<string, string[]> = {};
    for (const id of rootIds) childrenById[id] = [];

    useSceneStore.setState({ nodesById, parentById: {}, childrenById, rootIds });

    dispose = createPixiSync(sceneRoot);
    await flushFrame();

    // Sample 5 unrelated node ids spread across the scene and spy on their
    // container's `visible` setter, installed AFTER initial build so the
    // full-pass fullRebuild doesn't count against the assertion.
    const sampledIds = ["r0", "r49", "r99", "r149", "r198"];
    const setterCalls = new Map<string, number>();
    for (const id of sampledIds) {
      const container = sceneRoot.getChildByLabel(id)!;
      let current = container.visible;
      setterCalls.set(id, 0);
      Object.defineProperty(container, "visible", {
        configurable: true,
        get: () => current,
        set: (v: boolean) => {
          setterCalls.set(id, (setterCalls.get(id) ?? 0) + 1);
          current = v;
        },
      });
    }

    const t1Container = sceneRoot.getChildByLabel("t1")!;
    expect(t1Container.visible).toBe(true);

    // Enter text editing on t1 — a plain selection-store change, routed
    // through unsubSelection -> applyTextEditingVisibility([]).
    useSelectionStore.setState({ editingNodeId: "t1", editingMode: "text" });

    expect(t1Container.visible).toBe(false);
    for (const id of sampledIds) {
      expect(setterCalls.get(id)).toBe(0);
    }

    // Exit editing — t1 becomes visible again; unrelated containers still
    // untouched.
    useSelectionStore.setState({ editingNodeId: null, editingMode: null });

    expect(t1Container.visible).toBe(true);
    for (const id of sampledIds) {
      expect(setterCalls.get(id)).toBe(0);
    }
  });
});
