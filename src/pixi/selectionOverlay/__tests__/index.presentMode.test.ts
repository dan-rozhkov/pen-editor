import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Container } from "pixi.js";
import { createSelectionOverlay } from "../index";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores, seedScene } from "@/test/fixtures";

// See drawFrameNames.test.ts: stub out canvas-based text measurement, which
// happy-dom cannot provide.
vi.mock("@/pixi/frameLabelUtils", () => ({
  truncateLabelToWidth: (text: string) => text,
}));

function flushFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * bug-18 defect 2: entering/exiting Play (present) mode must redraw the
 * frame-names layer so labels disappear/reappear immediately, mirroring how
 * the overlay already reacts to selection/scene/scale changes.
 */
describe("createSelectionOverlay: frame names react to mode change", () => {
  let selectionContainer: Container;
  let sceneRoot: Container;
  let dispose: () => void;

  beforeEach(() => {
    resetStores();
    seedScene();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    selectionContainer = new Container();
    sceneRoot = new Container();
  });

  afterEach(() => {
    dispose?.();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });

  it("clears frame name labels on entering present mode and restores them on exit", async () => {
    dispose = createSelectionOverlay(selectionContainer, sceneRoot);
    const frameNames = selectionContainer.getChildByLabel("frame-names") as Container;
    expect(frameNames.children.length).toBeGreaterThan(0);

    useEditorModeStore.setState({ mode: "present", presentFrameIds: ["frame1"], presentIndex: 0 });
    await flushFrame();
    expect(frameNames.children.length).toBe(0);

    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    await flushFrame();
    expect(frameNames.children.length).toBeGreaterThan(0);
  });
});
