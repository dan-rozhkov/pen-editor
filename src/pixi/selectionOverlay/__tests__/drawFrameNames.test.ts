import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Container } from "pixi.js";
import { createFrameNameRenderer } from "../drawFrameNames";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores, seedScene } from "@/test/fixtures";

// truncateLabelToWidth measures text via pixi's CanvasTextMetrics, which
// needs a real CanvasRenderingContext2D global happy-dom doesn't provide.
// Stub it so this test exercises only the present-mode suppression logic,
// not text measurement (kept out of unit tests per repo convention: PixiJS
// text/canvas measurement is WebGL/canvas territory, covered by e2e).
vi.mock("@/pixi/frameLabelUtils", () => ({
  truncateLabelToWidth: (text: string) => text,
}));

/**
 * bug-18 defect 2: Play (present) mode must show no editor chrome, including
 * top-level frame name labels. createFrameNameRenderer reads
 * useEditorModeStore directly, so it can be unit-tested by flipping the mode
 * and inspecting the (plain, non-rendered) Pixi Container it populates —
 * no WebGL/renderer involved.
 */
describe("createFrameNameRenderer: present-mode suppression", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });

  afterEach(() => {
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });

  it("draws frame name labels outside present mode", () => {
    const container = new Container();
    const renderer = createFrameNameRenderer();
    renderer.redraw(container);
    expect(container.children.length).toBeGreaterThan(0);
    renderer.cleanup();
  });

  it("draws no frame name labels in present mode", () => {
    useEditorModeStore.setState({ mode: "present" });
    const container = new Container();
    const renderer = createFrameNameRenderer();
    renderer.redraw(container);
    expect(container.children.length).toBe(0);
    renderer.cleanup();
  });
});
