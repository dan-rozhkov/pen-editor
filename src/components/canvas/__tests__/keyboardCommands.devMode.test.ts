import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KeyDownHandlerDeps } from "../keyboardCommands";
import { useDevModeStore } from "@/store/devModeStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { appendInput, key, keyFrom, seedSelectedFrame, setupKeyDownHandler } from "./keyboardCommandFixtures";

describe("keyboardCommands — dev mode gating", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    // Dev mode is orthogonal to editorModeStore — `mode` stays "edit".
    ({ deps, handler } = setupKeyDownHandler());
    seedSelectedFrame();
    useDevModeStore.getState().setActive(true);
  });

  afterEach(() => {
    useDevModeStore.getState().setActive(false);
  });

  it("does not delete on Delete/Backspace in dev mode", () => {
    handler(key("Delete"));
    handler(key("Backspace"));
    expect(deps.deleteNode).not.toHaveBeenCalled();
  });

  it("does not nudge with arrow keys in dev mode", () => {
    handler(key("ArrowLeft"));
    handler(key("ArrowRight"));
    expect(deps.moveNode).not.toHaveBeenCalled();
    expect(deps.updateNode).not.toHaveBeenCalled();
  });

  it("does not activate a draw tool via a plain tool key in dev mode", () => {
    handler(key("KeyR"));
    expect(deps.toggleTool).not.toHaveBeenCalled();
  });

  it("does not group or cut in dev mode", () => {
    handler(key("KeyG", { metaKey: true }));
    handler(key("KeyX", { metaKey: true }));
    expect(deps.groupNodes).not.toHaveBeenCalled();
    expect(deps.cutSelection).not.toHaveBeenCalled();
  });

  it("still allows copy and fit-to-content in dev mode", () => {
    handler(key("KeyC", { metaKey: true }));
    handler(key("Digit0", { metaKey: true }));
    expect(deps.copySelection).toHaveBeenCalledTimes(1);
    expect(deps.fitToContent).toHaveBeenCalledTimes(1);
  });

  it("still allows undo (Cmd+Z) and redo (Cmd+Shift+Z) in dev mode", () => {
    handler(key("KeyZ", { metaKey: true }));
    expect(deps.undo).toHaveBeenCalledTimes(1);

    handler(key("KeyZ", { metaKey: true, shiftKey: true }));
    expect(deps.redo).toHaveBeenCalledTimes(1);
  });

  it("Shift+D toggles dev mode off", () => {
    expect(useDevModeStore.getState().active).toBe(true);
    handler(key("KeyD", { shiftKey: true }));
    expect(useDevModeStore.getState().active).toBe(false);
  });

  it("Shift+D toggles dev mode back on from normal edit mode", () => {
    useDevModeStore.getState().setActive(false);
    handler(key("KeyD", { shiftKey: true }));
    expect(useDevModeStore.getState().active).toBe(true);
  });

  it("Shift+D while typing in an input does nothing", () => {
    const input = appendInput();
    try {
      handler(keyFrom(input, "KeyD", { key: "D", shiftKey: true }));
      expect(useDevModeStore.getState().active).toBe(true);
    } finally {
      document.body.removeChild(input);
    }
  });

  it("Escape in dev mode clears selection instead of a no-op exitToEdit", () => {
    handler(key("Escape"));
    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("Escape in dev mode also clears any stale selected measurement", () => {
    useMeasurementsStore.setState({ selectedMeasurementId: "m1" });
    handler(key("Escape"));
    expect(useMeasurementsStore.getState().selectedMeasurementId).toBeNull();
  });

  it("in normal edit mode (dev mode off), Delete still deletes", () => {
    useDevModeStore.getState().setActive(false);
    handler(key("Delete"));
    expect(deps.deleteNode).toHaveBeenCalledWith("F");
  });
});
