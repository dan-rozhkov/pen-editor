import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { Container } from "pixi.js";
import { createSelectionOverlay } from "../index";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
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
 * Code-review finding: `createSelectionOverlay`'s `embedPickerStore`
 * subscription used to schedule a full selection redraw (Graphics rebuild)
 * on EVERY store write, even though `drawSelection.ts`'s single-embed
 * size-badge skip reads only `selection?.embedId`. The store's hottest
 * writers — `setHoveredPath` (every hovered element while picking) and
 * `setDropIndicator` (every `pointermove` of a sortable drag, ~60/s) — never
 * touch that field, so they must schedule nothing.
 */
describe("createSelectionOverlay: embedPickerStore subscription is filtered to selection.embedId", () => {
  let selectionContainer: Container;
  let sceneRoot: Container;
  let dispose: (() => void) | undefined;
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // drawSelection.ts's size-label draws real Pixi Text, which measures
    // itself via a canvas 2D context happy-dom doesn't provide — see
    // drawSelection.embedPicker.test.ts for the same stub.
    vi.stubGlobal("CanvasRenderingContext2D", class {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    resetStores();
    seedScene();
    useSelectionStore.setState({ selectedIds: ["frame1"] });
    useEmbedPickerStore.getState().reset();
    selectionContainer = new Container();
    sceneRoot = new Container();
    rafSpy = vi.spyOn(window, "requestAnimationFrame");
  });

  afterEach(() => {
    dispose?.();
    rafSpy.mockRestore();
    useEmbedPickerStore.getState().reset();
  });

  it("does not schedule a redraw for hover/drop-indicator writes", async () => {
    dispose = createSelectionOverlay(selectionContainer, sceneRoot);
    rafSpy.mockClear(); // drop the mount-time frame-name-renderer bookkeeping, if any

    useEmbedPickerStore.getState().setHoveredPath("div:nth-of-type(1)");
    useEmbedPickerStore.getState().setDropIndicator({ left: 0, top: 0, width: 10, height: 10 });
    useEmbedPickerStore.getState().setDropIndicator({ left: 5, top: 5, width: 10, height: 10 });

    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("schedules a redraw when selection.embedId actually changes", async () => {
    dispose = createSelectionOverlay(selectionContainer, sceneRoot);
    rafSpy.mockClear();

    useEmbedPickerStore.getState().selectElement({
      embedId: "frame1",
      path: "div:nth-of-type(1)",
      tagName: "div",
      classes: [],
      textPreview: "hi",
      outerHtml: "<div>hi</div>",
    });

    expect(rafSpy).toHaveBeenCalledTimes(1);
    await flushFrame();
  });

  it("does not schedule a redraw again for a selectElement call that keeps the same embedId", async () => {
    useEmbedPickerStore.getState().selectElement({
      embedId: "frame1",
      path: "div:nth-of-type(1)",
      tagName: "div",
      classes: [],
      textPreview: "hi",
      outerHtml: "<div>hi</div>",
    });
    dispose = createSelectionOverlay(selectionContainer, sceneRoot);
    rafSpy.mockClear();

    // Same embedId, different path — noteSelectionEdit-style update that
    // doesn't change which embed owns the pick.
    useEmbedPickerStore.getState().selectElement({
      embedId: "frame1",
      path: "div:nth-of-type(2)",
      tagName: "div",
      classes: [],
      textPreview: "bye",
      outerHtml: "<div>bye</div>",
    });

    expect(rafSpy).not.toHaveBeenCalled();
  });
});
