import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Container } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores } from "@/test/fixtures";
import { createPixiSync } from "../pixiSync";
import type { FlatSceneNode } from "@/types/scene";

/**
 * Defense-in-depth for Play/Present slide isolation: pixiSync's own
 * scene-resync path (`applyTextEditingVisibility`, called on selection/theme/
 * scene updates and full rebuilds) must not clobber the "only the active
 * slide is visible" state that PresentController applies directly to
 * containers. Making the resync itself present-mode-aware means it's
 * self-healing even across a full container rebuild.
 */
function flushFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function rootRect(id: string, x: number): FlatSceneNode {
  return { id, type: "rect", x, y: 0, width: 50, height: 50, fill: "#ff0000" } as unknown as FlatSceneNode;
}

describe("pixiSync: present-mode slide isolation survives resync", () => {
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

  it("re-hides inactive root containers after a scene resync while presenting", async () => {
    useSceneStore.setState({
      nodesById: { A: rootRect("A", 0), B: rootRect("B", 100) },
      parentById: {},
      childrenById: { A: [], B: [] },
      rootIds: ["A", "B"],
    });

    dispose = createPixiSync(sceneRoot);
    await flushFrame();

    useEditorModeStore.setState({ mode: "present", presentFrameIds: ["A", "B"], presentIndex: 0 });

    // Trigger the same resync path a selection change would (applyTextEditingVisibility).
    const containerA = sceneRoot.getChildByLabel("A")!;
    const containerB = sceneRoot.getChildByLabel("B")!;
    expect(containerA.visible).toBe(true);
    expect(containerB.visible).toBe(false);

    // An unrelated node-data change (opacity tweak) drives pixiSync's normal
    // incremental-update resync — the present-mode hide must survive it.
    useSceneStore.setState({
      nodesById: { A: { ...rootRect("A", 0), opacity: 0.9 }, B: rootRect("B", 100) },
      parentById: {},
      childrenById: { A: [], B: [] },
      rootIds: ["A", "B"],
    });
    await flushFrame();

    expect(sceneRoot.getChildByLabel("A")!.visible).toBe(true);
    expect(sceneRoot.getChildByLabel("B")!.visible).toBe(false);
  });

  it("keeps a user-hidden root node hidden on enter, across next/prev, and on exit", async () => {
    // C has `visible: false` — the user hid it via the Layers panel before
    // ever entering Play. Isolation must never flip it back to visible.
    useSceneStore.setState({
      nodesById: {
        A: rootRect("A", 0),
        B: rootRect("B", 100),
        C: { ...rootRect("C", 200), visible: false },
      },
      parentById: {},
      childrenById: { A: [], B: [], C: [] },
      rootIds: ["A", "B", "C"],
    });

    dispose = createPixiSync(sceneRoot);
    await flushFrame();

    const containerA = sceneRoot.getChildByLabel("A")!;
    const containerB = sceneRoot.getChildByLabel("B")!;
    const containerC = sceneRoot.getChildByLabel("C")!;

    // Before Play: C renders as hidden per its own `visible: false`.
    expect(containerC.visible).toBe(false);

    // Enter present on A: B and C are isolated-out; C stays hidden (not
    // merely "isolated", genuinely hidden either way — but must not become
    // visible=true, which would be the FINDING 1 bug).
    useEditorModeStore.setState({ mode: "present", presentFrameIds: ["A", "B", "C"], presentIndex: 0 });
    expect(containerA.visible).toBe(true);
    expect(containerB.visible).toBe(false);
    expect(containerC.visible).toBe(false);

    // Next slide (B): A is isolated-out, C remains hidden regardless of
    // isolation because its own baseVisible is false.
    useEditorModeStore.setState({ presentIndex: 1 });
    expect(containerA.visible).toBe(false);
    expect(containerB.visible).toBe(true);
    expect(containerC.visible).toBe(false);

    // Advance present onto C itself: even as the "active" slide, a node the
    // user hid must stay hidden — Play must not force it visible.
    useEditorModeStore.setState({ presentIndex: 2 });
    expect(containerA.visible).toBe(false);
    expect(containerB.visible).toBe(false);
    expect(containerC.visible).toBe(false);

    // Exit to edit: A and B (never hidden by the user) are restored to
    // visible; C stays hidden — exit must not force every root visible.
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    expect(containerA.visible).toBe(true);
    expect(containerB.visible).toBe(true);
    expect(containerC.visible).toBe(false);
  });
});
