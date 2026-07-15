import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDevModeStore } from "@/store/devModeStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useMeasureStore } from "@/store/measureStore";
import { useMeasurementsStore } from "@/store/measurementsStore";

const UNITS_KEY = "dev-mode-units";
const REM_BASE_KEY = "dev-mode-rem-base";

describe("devModeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useDevModeStore.setState({ active: false, units: "px", remBase: 16 });
    useDrawModeStore.setState({ activeTool: null });
    useMeasureStore.setState({ lines: [] });
  });

  it("starts inactive with px units and remBase 16 when localStorage has nothing", () => {
    expect(useDevModeStore.getState().active).toBe(false);
    expect(useDevModeStore.getState().units).toBe("px");
    expect(useDevModeStore.getState().remBase).toBe(16);
  });

  it("toggle flips active", () => {
    useDevModeStore.getState().toggle();
    expect(useDevModeStore.getState().active).toBe(true);
    useDevModeStore.getState().toggle();
    expect(useDevModeStore.getState().active).toBe(false);
  });

  it("setActive sets active directly", () => {
    useDevModeStore.getState().setActive(true);
    expect(useDevModeStore.getState().active).toBe(true);
    useDevModeStore.getState().setActive(false);
    expect(useDevModeStore.getState().active).toBe(false);
  });

  it("setUnits('rem') persists to localStorage", () => {
    useDevModeStore.getState().setUnits("rem");
    expect(useDevModeStore.getState().units).toBe("rem");
    expect(localStorage.getItem(UNITS_KEY)).toBe("rem");
  });

  it("setRemBase(10) persists to localStorage", () => {
    useDevModeStore.getState().setRemBase(10);
    expect(useDevModeStore.getState().remBase).toBe(10);
    expect(localStorage.getItem(REM_BASE_KEY)).toBe("10");
  });

  it("active does not persist across a fresh module load", async () => {
    useDevModeStore.getState().setActive(true);

    vi.resetModules();
    const { useDevModeStore: freshStore } = await import("@/store/devModeStore");

    expect(freshStore.getState().active).toBe(false);
  });

  it("units/remBase persist across a fresh module load (seeded localStorage)", async () => {
    localStorage.setItem(UNITS_KEY, "rem");
    localStorage.setItem(REM_BASE_KEY, "10");

    vi.resetModules();
    const { useDevModeStore: freshStore } = await import("@/store/devModeStore");

    expect(freshStore.getState().units).toBe("rem");
    expect(freshStore.getState().remBase).toBe(10);
  });

  it("entering dev mode force-exits any active draw tool", () => {
    useDrawModeStore.setState({ activeTool: "rect" });
    useDevModeStore.getState().setActive(true);
    expect(useDrawModeStore.getState().activeTool).toBeNull();
  });

  it("toggle-on force-exits any active draw tool", () => {
    useDrawModeStore.setState({ activeTool: "ellipse" });
    useDevModeStore.getState().toggle();
    expect(useDrawModeStore.getState().activeTool).toBeNull();
  });

  it("exiting dev mode clears ephemeral measure lines", () => {
    useDevModeStore.getState().setActive(true);
    useMeasureStore.setState({
      lines: [{ orientation: "horizontal", x: 0, y: 0, length: 10, label: "10" }],
    });

    useDevModeStore.getState().setActive(false);
    expect(useMeasureStore.getState().lines).toEqual([]);
  });

  it("exiting dev mode clears the selected pinned measurement", () => {
    useDevModeStore.getState().setActive(true);
    useMeasurementsStore.setState({ selectedMeasurementId: "m1" });

    useDevModeStore.getState().setActive(false);
    expect(useMeasurementsStore.getState().selectedMeasurementId).toBeNull();
  });
});
