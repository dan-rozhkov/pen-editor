import { describe, it, expect, beforeEach } from "vitest";
import { createMeasurementController } from "../measurementController";
import { useSelectionStore } from "@/store/selectionStore";
import { useMeasureStore } from "@/store/measureStore";
import { useDevModeStore } from "@/store/devModeStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { InteractionContext } from "../types";

// Minimal stub — the measurement controller never touches `context` directly.
const context = {} as InteractionContext;

describe("measurementController — dev mode gate", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    useMeasureStore.setState({ lines: [], modifierHeld: false });
    useDevModeStore.setState({ active: false, units: "px", remBase: 16 });
    // Select rect1, hover its sibling text1 (both children of frame1).
    useSelectionStore.setState({ selectedIds: ["rect1"] });
  });

  it("stays empty with dev mode off and Alt not held", () => {
    const controller = createMeasurementController(context);
    controller.handlePointerMove(
      new PointerEvent("pointermove"),
      { x: 0, y: 0 },
      "text1",
    );
    expect(useMeasureStore.getState().lines).toHaveLength(0);
  });

  it("produces lines with dev mode active and Alt not held", () => {
    useDevModeStore.getState().setActive(true);
    const controller = createMeasurementController(context);
    controller.handlePointerMove(
      new PointerEvent("pointermove"),
      { x: 0, y: 0 },
      "text1",
    );
    expect(useMeasureStore.getState().lines.length).toBeGreaterThan(0);
  });

  it("keeps plain px labels for Alt+hover in normal (non-dev) mode", () => {
    useMeasureStore.getState().setModifierHeld(true);
    const controller = createMeasurementController(context);
    controller.handlePointerMove(
      new PointerEvent("pointermove"),
      { x: 0, y: 0 },
      "text1",
    );
    const lines = useMeasureStore.getState().lines;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.label).not.toMatch(/px|rem/);
    }
  });

  it("formats labels via units/remBase in dev mode", () => {
    useDevModeStore.getState().setActive(true);
    useDevModeStore.getState().setUnits("rem");
    const controller = createMeasurementController(context);
    controller.handlePointerMove(
      new PointerEvent("pointermove"),
      { x: 0, y: 0 },
      "text1",
    );
    const lines = useMeasureStore.getState().lines;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.label).toMatch(/rem$/);
    }
  });
});
