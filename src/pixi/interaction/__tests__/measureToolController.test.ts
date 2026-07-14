import { describe, it, expect, beforeEach } from "vitest";
import { createMeasureToolController } from "../measureToolController";
import type { MeasureRect } from "../measureToolController";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { useMeasureStore } from "@/store/measureStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { InteractionContext } from "../types";

// Minimal stub — the controller never touches `context` directly.
const context = {} as InteractionContext;

// Rects for the fixture scene (see src/test/fixtures.ts):
//   frame1 (100,100 400x300) > rect1 (10,20 100x50 → abs 110,120), text1 (10,90 80x20 → abs 110,190)
//   rect2 (600,100 200x100), floating (root)
const RECTS: Record<string, MeasureRect> = {
  frame1: { x: 100, y: 100, width: 400, height: 300 },
  rect1: { x: 110, y: 120, width: 100, height: 50 },
  text1: { x: 110, y: 190, width: 80, height: 20 },
  rect2: { x: 600, y: 100, width: 200, height: 100 },
};

function fakeHitTest(nodeAtPoint: Record<string, string>) {
  return (worldX: number, worldY: number): string | null => {
    const key = `${worldX},${worldY}`;
    return nodeAtPoint[key] ?? null;
  };
}

function fakeGetRect(nodeId: string): MeasureRect | null {
  return RECTS[nodeId] ?? null;
}

describe("measureToolController", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    useDrawModeStore.setState({ activeTool: "measure" });
    useMeasureStore.setState({ lines: [], modifierHeld: false });
  });

  it("pins a measurement on pointerDown node A + pointerUp node B", () => {
    const hitTest = fakeHitTest({ "0,0": "rect1", "1000,0": "rect2" });
    const controller = createMeasureToolController(context, { hitTest, getRect: fakeGetRect });

    const down = controller.handlePointerDown(new PointerEvent("pointerdown", { button: 0 }), { x: 0, y: 0 });
    expect(down).toBe(true);
    expect(controller.isActive()).toBe(true);

    const up = controller.handlePointerUp(new PointerEvent("pointerup"), { x: 1000, y: 0 });
    expect(up).toBe(true);

    const { measurements } = useMeasurementsStore.getState();
    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toMatchObject({ fromId: "rect1", toId: "rect2" });
    expect(controller.isActive()).toBe(false);
  });

  it("does not pin a measurement on pointerUp over empty canvas", () => {
    const hitTest = fakeHitTest({ "0,0": "rect1" });
    const controller = createMeasureToolController(context, { hitTest, getRect: fakeGetRect });

    controller.handlePointerDown(new PointerEvent("pointerdown", { button: 0 }), { x: 0, y: 0 });
    controller.handlePointerUp(new PointerEvent("pointerup"), { x: 9999, y: 9999 });

    expect(useMeasurementsStore.getState().measurements).toHaveLength(0);
  });

  it("does nothing when pointerUp lands back on the same node", () => {
    const hitTest = fakeHitTest({ "0,0": "rect1" });
    const controller = createMeasureToolController(context, { hitTest, getRect: fakeGetRect });

    controller.handlePointerDown(new PointerEvent("pointerdown", { button: 0 }), { x: 0, y: 0 });
    controller.handlePointerUp(new PointerEvent("pointerup"), { x: 0, y: 0 });

    expect(useMeasurementsStore.getState().measurements).toHaveLength(0);
  });

  it("selects an existing measurement when clicking near its line", () => {
    useSceneStore.getState(); // ensure store initialized
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");
    const measurementId = useMeasurementsStore.getState().measurements[0].id;

    // rect1 (110,120 100x50) and rect2 (600,100 200x100) are horizontally
    // separated — the sibling gap line runs along y = overlap midpoint.
    // rect1 right edge = 210, rect2 left edge = 600, vertical overlap is
    // [120,170] ∩ [100,200] = [120,170], midpoint y = 145.
    const hitTest = fakeHitTest({}); // no node hit — forces segment hit-test path
    const controller = createMeasureToolController(context, { hitTest, getRect: fakeGetRect });

    const down = controller.handlePointerDown(new PointerEvent("pointerdown", { button: 0 }), {
      x: 400,
      y: 145,
    });
    expect(down).toBe(true);
    expect(useMeasurementsStore.getState().selectedMeasurementId).toBe(measurementId);
  });

  it("clears selection when clicking far from any measurement line", () => {
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");
    useMeasurementsStore.getState().setSelectedMeasurement(useMeasurementsStore.getState().measurements[0].id);

    const hitTest = fakeHitTest({});
    const controller = createMeasureToolController(context, { hitTest, getRect: fakeGetRect });

    controller.handlePointerDown(new PointerEvent("pointerdown", { button: 0 }), { x: 9999, y: 9999 });
    expect(useMeasurementsStore.getState().selectedMeasurementId).toBeNull();
  });

  it("is a no-op when the measure tool is not active", () => {
    useDrawModeStore.setState({ activeTool: "cursor" });
    const hitTest = fakeHitTest({ "0,0": "rect1" });
    const controller = createMeasureToolController(context, { hitTest, getRect: fakeGetRect });

    const down = controller.handlePointerDown(new PointerEvent("pointerdown", { button: 0 }), { x: 0, y: 0 });
    expect(down).toBe(false);
    expect(controller.isActive()).toBe(false);
  });

  it("writes a live preview line into useMeasureStore while dragging", () => {
    const hitTest = fakeHitTest({ "0,0": "rect1", "1000,0": "rect2" });
    const controller = createMeasureToolController(context, { hitTest, getRect: fakeGetRect });

    controller.handlePointerDown(new PointerEvent("pointerdown", { button: 0 }), { x: 0, y: 0 });
    controller.handlePointerMove(new PointerEvent("pointermove"), { x: 1000, y: 0 });

    expect(useMeasureStore.getState().lines.length).toBeGreaterThan(0);
  });

  it("Delete key path: removeMeasurement drops the pinned measurement from the store", () => {
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");
    const id = useMeasurementsStore.getState().measurements[0].id;
    useMeasurementsStore.getState().setSelectedMeasurement(id);

    useMeasurementsStore.getState().removeMeasurement(id);

    expect(useMeasurementsStore.getState().measurements).toHaveLength(0);
    expect(useMeasurementsStore.getState().selectedMeasurementId).toBeNull();
  });
});
