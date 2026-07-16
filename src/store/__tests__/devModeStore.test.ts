import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDevModeStore } from "@/store/devModeStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useMeasureStore } from "@/store/measureStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { useDevExportStore } from "@/store/devExportStore";

const UNITS_KEY = "dev-mode-units";
const REM_BASE_KEY = "dev-mode-rem-base";
const CODEGEN_FORMAT_KEY = "dev-mode-codegen-format";
const CODEGEN_REACT_STYLE_KEY = "dev-mode-codegen-react-style";

describe("devModeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useDevModeStore.setState({
      active: false,
      units: "px",
      remBase: 16,
      codegenFormat: "css",
      codegenReactStyle: "inline",
    });
    useDrawModeStore.setState({ activeTool: null });
    useMeasureStore.setState({ lines: [] });
    useDevExportStore.setState({ overrides: {} });
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

  it("exiting dev mode clears ephemeral export-setting overrides (dev-03)", () => {
    useDevModeStore.getState().setActive(true);
    useDevExportStore.setState({ overrides: { n1: [{ id: "a", format: "png", scale: 2 }] } });

    useDevModeStore.getState().setActive(false);
    expect(useDevExportStore.getState().overrides).toEqual({});
  });

  it("exiting dev mode clears the selected pinned measurement", () => {
    useDevModeStore.getState().setActive(true);
    useMeasurementsStore.setState({ selectedMeasurementId: "m1" });

    useDevModeStore.getState().setActive(false);
    expect(useMeasurementsStore.getState().selectedMeasurementId).toBeNull();
  });

  it("starts with codegenFormat 'css' and codegenReactStyle 'inline' when localStorage has nothing", () => {
    expect(useDevModeStore.getState().codegenFormat).toBe("css");
    expect(useDevModeStore.getState().codegenReactStyle).toBe("inline");
  });

  it("setCodegenFormat('react') persists to localStorage", () => {
    useDevModeStore.getState().setCodegenFormat("react");
    expect(useDevModeStore.getState().codegenFormat).toBe("react");
    expect(localStorage.getItem(CODEGEN_FORMAT_KEY)).toBe("react");
  });

  it("setCodegenReactStyle('tailwind') persists to localStorage", () => {
    useDevModeStore.getState().setCodegenReactStyle("tailwind");
    expect(useDevModeStore.getState().codegenReactStyle).toBe("tailwind");
    expect(localStorage.getItem(CODEGEN_REACT_STYLE_KEY)).toBe("tailwind");
  });

  it("codegenFormat/codegenReactStyle persist across a fresh module load (seeded localStorage)", async () => {
    localStorage.setItem(CODEGEN_FORMAT_KEY, "tailwind");
    localStorage.setItem(CODEGEN_REACT_STYLE_KEY, "tailwind");

    vi.resetModules();
    const { useDevModeStore: freshStore } = await import("@/store/devModeStore");

    expect(freshStore.getState().codegenFormat).toBe("tailwind");
    expect(freshStore.getState().codegenReactStyle).toBe("tailwind");
  });

  it("falls back to defaults when localStorage has an invalid codegen value", async () => {
    localStorage.setItem(CODEGEN_FORMAT_KEY, "bogus");
    localStorage.setItem(CODEGEN_REACT_STYLE_KEY, "bogus");

    vi.resetModules();
    const { useDevModeStore: freshStore } = await import("@/store/devModeStore");

    expect(freshStore.getState().codegenFormat).toBe("css");
    expect(freshStore.getState().codegenReactStyle).toBe("inline");
  });
});
