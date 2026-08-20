import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Container, Graphics } from "pixi.js";
import * as pathRendererModule from "@/pixi/renderers/pathRenderer";
import { useAiVectorPreviewStore, vectorPreviewKey, type AiVectorPreviewDraft } from "@/store/aiVectorPreviewStore";
import { useViewportStore } from "@/store/viewportStore";
import { createAiVectorPreviewLayer } from "../aiVectorPreviewLayer";

function draft(overrides: Partial<AiVectorPreviewDraft> = {}): AiVectorPreviewDraft {
  return {
    sessionId: "s1",
    toolCallId: "call-1",
    name: "Leaf",
    commandText: "M(10,10)\n",
    phase: "streaming",
    receivedDuringStreaming: true,
    points: [{ x: 10, y: 10 }],
    contours: [{ points: [{ x: 10, y: 10 }], closed: false }],
    geometry: "",
    bounds: { x: 10, y: 10, width: 0, height: 0 },
    closed: false,
    ended: false,
    warnings: [],
    ...overrides,
  };
}

describe("createAiVectorPreviewLayer", () => {
  let rafCallbacks: Array<() => void>;
  let nextRafId: number;
  let cancelledIds: number[];

  beforeEach(() => {
    rafCallbacks = [];
    nextRafId = 1;
    cancelledIds = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCallbacks.push(cb);
      return nextRafId++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelledIds.push(id);
    });
    useAiVectorPreviewStore.getState().reset();
    useViewportStore.setState({ scale: 1 });
  });

  afterEach(() => {
    useAiVectorPreviewStore.getState().reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function runRaf(): void {
    const callbacks = [...rafCallbacks];
    rafCallbacks = [];
    for (const cb of callbacks) cb();
  }

  it("draws an anchor marker but never calls drawPath for a one-anchor draft", () => {
    const drawPathSpy = vi.spyOn(pathRendererModule, "drawPath");
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    const key = vectorPreviewKey("s1", "call-1");
    useAiVectorPreviewStore.getState().upsert(draft());
    runRaf();

    expect(drawPathSpy).not.toHaveBeenCalled();

    const root = overlay.getChildByLabel("ai-vector-previews") as Container;
    expect(root).toBeTruthy();
    const entryContainer = root.children.find((c) => c.label === "ai-vector-preview");
    expect(entryContainer).toBeTruthy();
    const markerGfx = entryContainer!.getChildByLabel("ai-vector-preview-markers") as Graphics;
    expect(markerGfx).toBeTruthy();

    void key;
    cleanup();
  });

  it("passes an undefined fill and the default blue stroke for open geometry", () => {
    const drawPathSpy = vi.spyOn(pathRendererModule, "drawPath");
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
        geometry: "M0,0 L50,0",
        bounds: { x: 0, y: 0, width: 50, height: 10 },
        closed: false,
      }),
    );
    runRaf();

    expect(drawPathSpy).toHaveBeenCalledTimes(1);
    const node = drawPathSpy.mock.calls[0][1];
    expect(node.fill).toBeUndefined();
    expect(node.pathStroke).toEqual({ fill: "#0d99ff", thickness: 1.5, cap: "round", join: "round" });

    cleanup();
  });

  it("leaves closed geometry unfilled when no FILL command streamed yet", () => {
    const drawPathSpy = vi.spyOn(pathRendererModule, "drawPath");
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
        geometry: "M0,0 L50,0 L50,50 Z",
        bounds: { x: 0, y: 0, width: 50, height: 50 },
        closed: true,
      }),
    );
    runRaf();

    expect(drawPathSpy).toHaveBeenCalledTimes(1);
    expect(drawPathSpy.mock.calls[0][1].fill).toBeUndefined();

    cleanup();
  });

  it("applies the streamed fill for a closed draft", () => {
    const drawPathSpy = vi.spyOn(pathRendererModule, "drawPath");
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
        geometry: "M0,0 L50,0 L50,50 Z",
        bounds: { x: 0, y: 0, width: 50, height: 50 },
        closed: true,
        fill: "#65a765",
      }),
    );
    runRaf();

    expect(drawPathSpy).toHaveBeenCalledTimes(1);
    expect(drawPathSpy.mock.calls[0][1].fill).toBe("#65a765");

    cleanup();
  });

  it("applies a streamed FILL to an open (not-yet-CLOSEd) contour too", () => {
    // FILL no longer requires CLOSE — SVG closes an open subpath implicitly
    // for the purposes of filling it, so the preview must not gate fill on
    // `closed` either.
    const drawPathSpy = vi.spyOn(pathRendererModule, "drawPath");
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
        geometry: "M0,0 L50,0 L50,50",
        bounds: { x: 0, y: 0, width: 50, height: 50 },
        closed: false,
        fill: "#65a765",
      }),
    );
    runRaf();

    expect(drawPathSpy).toHaveBeenCalledTimes(1);
    expect(drawPathSpy.mock.calls[0][1].fill).toBe("#65a765");

    cleanup();
  });

  it("passes fillRule through to drawPath for a multi-contour draft and shows every contour's markers", () => {
    const drawPathSpy = vi.spyOn(pathRendererModule, "drawPath");
    const rectSpy = vi.spyOn(Graphics.prototype, "rect");
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 5, y: 5 },
          { x: 15, y: 5 },
          { x: 15, y: 15 },
        ],
        contours: [
          { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }], closed: true },
          { points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }], closed: true },
        ],
        geometry: "M0,0 L20,0 L20,20 Z M5,5 L15,5 L15,15 Z",
        bounds: { x: 0, y: 0, width: 20, height: 20 },
        closed: false,
        fillRule: "evenodd",
        fill: "#3366ff",
      }),
    );
    runRaf();

    expect(drawPathSpy).toHaveBeenCalledTimes(1);
    expect(drawPathSpy.mock.calls[0][1].fillRule).toBe("evenodd");
    expect(drawPathSpy.mock.calls[0][1].fill).toBe("#3366ff");
    // One anchor square per anchor across both contours.
    expect(rectSpy).toHaveBeenCalledTimes(6);

    cleanup();
  });

  it("passes the declared stroke color/width through to drawPath", () => {
    const drawPathSpy = vi.spyOn(pathRendererModule, "drawPath");
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
        geometry: "M0,0 L50,0",
        bounds: { x: 0, y: 0, width: 50, height: 10 },
        stroke: { color: "#112233", width: 2 },
      }),
    );
    runRaf();

    expect(drawPathSpy.mock.calls[0][1].pathStroke).toEqual({
      fill: "#112233",
      thickness: 2,
      cap: "round",
      join: "round",
    });

    cleanup();
  });

  it("renders cubic handle and anchor markers via the marker Graphics", () => {
    const circleSpy = vi.spyOn(Graphics.prototype, "circle");
    const rectSpy = vi.spyOn(Graphics.prototype, "rect");

    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [
          { x: 0, y: 0, handleOut: { x: 10, y: 0 } },
          { x: 50, y: 50, handleIn: { x: 40, y: 50 } },
        ],
        geometry: "M0,0 C10,0 40,50 50,50",
        bounds: { x: 0, y: 0, width: 50, height: 50 },
      }),
    );
    runRaf();

    const root = overlay.getChildByLabel("ai-vector-previews") as Container;
    const entryContainer = root.children.find((c) => c.label === "ai-vector-preview")!;
    const markerGfx = entryContainer.getChildByLabel("ai-vector-preview-markers") as Graphics;
    expect(markerGfx).toBeTruthy();

    // One handle circle for handleOut on the first anchor + one for handleIn
    // on the second anchor, plus one anchor square per anchor (2).
    expect(circleSpy).toHaveBeenCalledTimes(2);
    expect(rectSpy).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("coalesces two synchronous store updates into one RAF and one redraw", () => {
    const drawPathSpy = vi.spyOn(pathRendererModule, "drawPath");
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    const rafCountBefore = rafCallbacks.length;

    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        geometry: "M0,0 L10,0",
        bounds: { x: 0, y: 0, width: 10, height: 1 },
      }),
    );
    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
        geometry: "M0,0 L20,0",
        bounds: { x: 0, y: 0, width: 20, height: 1 },
      }),
    );

    // Exactly one RAF was scheduled for both synchronous updates.
    expect(rafCallbacks.length - rafCountBefore).toBe(1);

    runRaf();

    // Exactly one redraw pass — drawPath sees only the latest geometry.
    expect(drawPathSpy).toHaveBeenCalledTimes(1);
    expect(drawPathSpy.mock.calls[0][1].geometry).toBe("M0,0 L20,0");

    cleanup();
  });

  it("unsubscribes, cancels a pending RAF, and destroys containers on cleanup", () => {
    const overlay = new Container();
    const removeChildSpy = vi.spyOn(overlay, "removeChild");
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(draft());
    expect(rafCallbacks.length).toBe(1);

    cleanup();

    expect(cancelledIds.length).toBe(1);
    expect(removeChildSpy).toHaveBeenCalled();

    // A store update after cleanup must not schedule a new RAF (unsubscribed).
    const rafCountAfterCleanup = rafCallbacks.length;
    useAiVectorPreviewStore.getState().upsert(
      draft({ toolCallId: "call-2" }),
    );
    expect(rafCallbacks.length).toBe(rafCountAfterCleanup);
  });

  it("never lets malformed/empty geometry reach drawPath's rectangle fallback", () => {
    const drawPathSpy = vi.spyOn(pathRendererModule, "drawPath");
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        geometry: "",
        bounds: { x: 0, y: 0, width: 10, height: 1 },
      }),
    );
    runRaf();

    expect(drawPathSpy).not.toHaveBeenCalled();

    cleanup();
  });

  it("removes a draft's container once its key disappears from the store", () => {
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(
      draft({
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        geometry: "M0,0 L10,0",
        bounds: { x: 0, y: 0, width: 10, height: 1 },
      }),
    );
    runRaf();

    const root = overlay.getChildByLabel("ai-vector-previews") as Container;
    expect(root.children.length).toBe(1);

    useAiVectorPreviewStore.getState().clearDraft(vectorPreviewKey("s1", "call-1"));
    runRaf();

    expect(root.children.length).toBe(0);

    cleanup();
  });

  it("redraws markers at the new scale when the viewport changes with no store update", () => {
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(draft());
    runRaf();

    const rafCountBeforeZoom = rafCallbacks.length;
    useViewportStore.setState({ scale: 4 });

    // The viewport change alone must schedule a redraw even though the
    // preview draft itself did not change.
    expect(rafCallbacks.length - rafCountBeforeZoom).toBe(1);

    const rectSpy = vi.spyOn(Graphics.prototype, "rect");
    runRaf();

    // Anchor markers must be re-baked at the new scale (4 / scale shrinks).
    expect(rectSpy).toHaveBeenCalled();

    cleanup();
  });

  it("unsubscribes from the viewport store on cleanup", () => {
    const overlay = new Container();
    const cleanup = createAiVectorPreviewLayer(overlay);

    useAiVectorPreviewStore.getState().upsert(draft());
    runRaf();

    cleanup();

    const rafCountAfterCleanup = rafCallbacks.length;
    useViewportStore.setState({ scale: 8 });
    expect(rafCallbacks.length).toBe(rafCountAfterCleanup);
  });
});
