import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Container } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import { createPixiSync } from "../pixiSync";
import type { FlatSceneNode } from "@/types/scene";

/**
 * Regression coverage for two bugs fixed together in pixiSync's incremental
 * update path:
 *
 * - A root-level node's `isMask` flag toggling in place (no children-order
 *   change) previously had no effect at all: `maskDirtyParentIds` is keyed
 *   by `parentById[id]`, which is undefined for root nodes, so the toggle
 *   was silently dropped.
 * - Toggling a masker's visibility (`visible`/`enabled`) must re-resolve
 *   masking the same way toggling `isMask` does (Figma semantics: a hidden
 *   mask stops masking).
 *
 * `createPixiSync` schedules scene updates via `requestAnimationFrame`; a
 * helper flushes one frame after each store mutation.
 */
function flushFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function rootRect(id: string, overrides: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return {
    id,
    type: "rect",
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    fill: "#ff0000",
    ...overrides,
  } as unknown as FlatSceneNode;
}

describe("pixiSync: mask dirty-tracking", () => {
  let sceneRoot: Container;
  let dispose: () => void;

  beforeEach(async () => {
    resetStores();
    sceneRoot = new Container();
  });

  afterEach(() => {
    dispose?.();
  });

  it("resolves a root-level isMask toggle (no prior masking effect otherwise)", async () => {
    const maskShape = rootRect("maskShape", { isMask: false });
    const content = rootRect("content");

    useSceneStore.setState({
      nodesById: { maskShape, content },
      parentById: { maskShape: null, content: null },
      childrenById: {},
      rootIds: ["maskShape", "content"],
      componentArtifactsById: {},
      _cachedTree: null,
    });

    dispose = createPixiSync(sceneRoot);

    const contentContainer = sceneRoot.getChildByLabel("content")!;
    const maskShapeContainer = sceneRoot.getChildByLabel("maskShape")!;
    expect(contentContainer.mask).toBeFalsy();

    // Toggle isMask on in place — no rootIds/childrenById structural change.
    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, maskShape: { ...s.nodesById.maskShape, isMask: true } as FlatSceneNode },
    }));
    await flushFrame();

    expect(contentContainer.mask).toBe(maskShapeContainer);

    // Toggle it back off — masking must be un-applied too.
    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, maskShape: { ...s.nodesById.maskShape, isMask: false } as FlatSceneNode },
    }));
    await flushFrame();

    expect(contentContainer.mask).toBeFalsy();
  });

  it("re-resolves root masking when a masker's visibility toggles (hidden mask stops masking)", async () => {
    const maskShape = rootRect("maskShape", { isMask: true });
    const content = rootRect("content");

    useSceneStore.setState({
      nodesById: { maskShape, content },
      parentById: { maskShape: null, content: null },
      childrenById: {},
      rootIds: ["maskShape", "content"],
      componentArtifactsById: {},
      _cachedTree: null,
    });

    dispose = createPixiSync(sceneRoot);

    const contentContainer = sceneRoot.getChildByLabel("content")!;
    const maskShapeContainer = sceneRoot.getChildByLabel("maskShape")!;
    expect(contentContainer.mask).toBe(maskShapeContainer);

    // Hide the masker — masking must stop, content shows unmasked.
    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, maskShape: { ...s.nodesById.maskShape, visible: false } as FlatSceneNode },
    }));
    await flushFrame();

    expect(contentContainer.mask).toBeFalsy();

    // Show it again — masking resumes.
    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, maskShape: { ...s.nodesById.maskShape, visible: true } as FlatSceneNode },
    }));
    await flushFrame();

    expect(contentContainer.mask).toBe(maskShapeContainer);
  });

  it("resolves a nested (non-root) isMask toggle via maskDirtyParentIds", async () => {
    const frame = {
      id: "frame",
      type: "frame",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      fill: "#ffffff",
      layout: { autoLayout: false },
    } as unknown as FlatSceneNode;
    const maskShape = rootRect("maskShape", { isMask: false });
    const content = rootRect("content");

    useSceneStore.setState({
      nodesById: { frame, maskShape, content },
      parentById: { frame: null, maskShape: "frame", content: "frame" },
      childrenById: { frame: ["maskShape", "content"] },
      rootIds: ["frame"],
      componentArtifactsById: {},
      _cachedTree: null,
    });

    dispose = createPixiSync(sceneRoot);

    const frameContainer = sceneRoot.getChildByLabel("frame")!;
    const childrenHost = frameContainer.getChildByLabel("frame-children")!;
    const contentContainer = childrenHost.getChildByLabel("content")!;
    const maskShapeContainer = childrenHost.getChildByLabel("maskShape")!;
    expect(contentContainer.mask).toBeFalsy();

    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, maskShape: { ...s.nodesById.maskShape, isMask: true } as FlatSceneNode },
    }));
    await flushFrame();

    expect(contentContainer.mask).toBe(maskShapeContainer);
  });
});
