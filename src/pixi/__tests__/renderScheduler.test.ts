import { describe, it, expect, vi, afterEach } from "vitest";
import type { Application } from "pixi.js";
import { usePenToolStore } from "@/store/penToolStore";
import { useStyleStore } from "@/store/styleStore";
import { useViewportStore } from "@/store/viewportStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { requestCanvasRender, setupRenderScheduler } from "../renderScheduler";

describe("requestCanvasRender", () => {
  it("is a no-op (does not throw) when no scheduler is installed", () => {
    // Importing renderScheduler initializes Pixi nowhere; calling the public
    // invalidate hook before/without setupRenderScheduler must be safe.
    expect(() => requestCanvasRender()).not.toThrow();
  });
});

describe("setupRenderScheduler invalidation sources", () => {
  // A minimal stand-in for the Pixi Application: the scheduler only touches
  // ticker.add/remove, render(), and canvas.parentElement.
  function makeFakeApp() {
    const tickListeners: Array<() => void> = [];
    const app = {
      render: vi.fn(),
      ticker: {
        add: (fn: () => void) => tickListeners.push(fn),
        remove: vi.fn(),
      },
      canvas: document.createElement("canvas"),
    };
    return {
      app: app as unknown as Application,
      render: app.render,
      tick: () => tickListeners.forEach((fn) => fn()),
    };
  }

  afterEach(() => {
    usePenToolStore.getState().resetDraft();
    vi.restoreAllMocks();
  });

  it("renders promptly after a penToolStore change (pen-preview must not wait for the safety tick)", () => {
    const now = vi.spyOn(performance, "now");

    now.mockReturnValue(0);
    const { app, render, tick } = makeFakeApp();
    const cleanup = setupRenderScheduler(app);

    // Let the initial trailing window and the safety cadence both settle.
    now.mockReturnValue(5000);
    tick(); // safety render; lastRender = 5000
    render.mockClear();

    // Pen draft cursor moves — this is the only signal while drafting.
    now.mockReturnValue(5100);
    usePenToolStore.getState().setCursorWorld({ x: 10, y: 20 });

    now.mockReturnValue(5116); // next frame, well inside the safety interval
    tick();
    expect(render).toHaveBeenCalled();

    cleanup();
  });

  it("renders promptly after a styleStore change (shared style edits repaint nodes outside sceneStore)", () => {
    const now = vi.spyOn(performance, "now");

    now.mockReturnValue(0);
    const { app, render, tick } = makeFakeApp();
    const cleanup = setupRenderScheduler(app);

    now.mockReturnValue(5000);
    tick();
    render.mockClear();

    now.mockReturnValue(5100);
    useStyleStore.getState().addFillStyle({
      id: "s-test",
      name: "Test",
      paint: { id: "p-test", type: "solid", color: "#ff0000" },
    });

    now.mockReturnValue(5116);
    tick();
    expect(render).toHaveBeenCalledTimes(1);

    // Non-viewport invalidations retain the trailing window for async work.
    now.mockReturnValue(5132);
    tick();
    expect(render).toHaveBeenCalledTimes(2);

    useStyleStore.getState().deleteFillStyle("s-test");
    cleanup();
  });

  it("renders promptly after an editorModeStore change (Play mode/slide-index changes aren't scene mutations)", () => {
    const now = vi.spyOn(performance, "now");

    now.mockReturnValue(0);
    const { app, render, tick } = makeFakeApp();
    const cleanup = setupRenderScheduler(app);

    now.mockReturnValue(5000);
    tick();
    render.mockClear();

    now.mockReturnValue(5100);
    useEditorModeStore.setState({ mode: "present", presentFrameIds: ["a"], presentIndex: 0 });

    now.mockReturnValue(5116);
    tick();
    expect(render).toHaveBeenCalledTimes(1);

    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    cleanup();
  });

  it("renders promptly after a devModeStore change (inspect overlay toggle isn't a scene mutation)", () => {
    const now = vi.spyOn(performance, "now");

    now.mockReturnValue(0);
    const { app, render, tick } = makeFakeApp();
    const cleanup = setupRenderScheduler(app);

    now.mockReturnValue(5000);
    tick();
    render.mockClear();

    now.mockReturnValue(5100);
    useDevModeStore.getState().toggle();

    now.mockReturnValue(5116);
    tick();
    expect(render).toHaveBeenCalledTimes(1);

    useDevModeStore.getState().setActive(false);
    cleanup();
  });

  it("renders promptly after a measurementsStore change (persistent measurement overlay isn't a scene mutation)", () => {
    const now = vi.spyOn(performance, "now");

    now.mockReturnValue(0);
    const { app, render, tick } = makeFakeApp();
    const cleanup = setupRenderScheduler(app);

    now.mockReturnValue(5000);
    tick();
    render.mockClear();

    now.mockReturnValue(5100);
    useMeasurementsStore.getState().setMeasurements([{ id: "m1", fromId: "a", toId: "b" }]);

    now.mockReturnValue(5116);
    tick();
    expect(render).toHaveBeenCalledTimes(1);

    useMeasurementsStore.getState().setMeasurements([]);
    cleanup();
  });

  it("renders a viewport change once without starting the trailing render window", () => {
    const now = vi.spyOn(performance, "now");

    now.mockReturnValue(0);
    const { app, render, tick } = makeFakeApp();
    const cleanup = setupRenderScheduler(app);

    now.mockReturnValue(5000);
    tick();
    render.mockClear();

    now.mockReturnValue(5100);
    useViewportStore.getState().setPosition(20, 30);

    now.mockReturnValue(5116);
    tick();
    expect(render).toHaveBeenCalledTimes(1);

    now.mockReturnValue(5132);
    tick();
    expect(render).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
