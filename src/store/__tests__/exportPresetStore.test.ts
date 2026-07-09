import { describe, expect, it, beforeEach, vi } from "vitest";
import { useExportPresetStore } from "@/store/exportPresetStore";

const STORAGE_KEY = "export-presets";

beforeEach(() => {
  localStorage.clear();
  useExportPresetStore.setState({ presets: [] });
});

describe("useExportPresetStore", () => {
  it("starts empty when localStorage has nothing", () => {
    expect(useExportPresetStore.getState().presets).toEqual([]);
  });

  it("addPreset appends a preset with a generated id and persists to localStorage", () => {
    const created = useExportPresetStore.getState().addPreset({
      name: "Web icon",
      format: "png",
      scale: 2,
      suffix: "@2x",
    });

    expect(created.name).toBe("Web icon");
    expect(typeof created.id).toBe("string");
    expect(useExportPresetStore.getState().presets).toEqual([created]);

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted).toEqual([created]);
  });

  it("removePreset removes by id and persists", () => {
    const p1 = useExportPresetStore.getState().addPreset({ name: "A", format: "png", scale: 1 });
    const p2 = useExportPresetStore.getState().addPreset({ name: "B", format: "svg", scale: 1 });

    useExportPresetStore.getState().removePreset(p1.id);

    expect(useExportPresetStore.getState().presets).toEqual([p2]);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted).toEqual([p2]);
  });

  it("updatePreset patches fields by id and persists", () => {
    const p1 = useExportPresetStore.getState().addPreset({ name: "A", format: "png", scale: 1 });

    useExportPresetStore.getState().updatePreset(p1.id, { scale: 3, suffix: "@3x" });

    const updated = useExportPresetStore.getState().presets[0];
    expect(updated).toEqual({ ...p1, scale: 3, suffix: "@3x" });
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted).toEqual([updated]);
  });

  it("toExportSetting builds a fresh ExportSetting (new id, no name) from a preset", () => {
    const preset = useExportPresetStore.getState().addPreset({
      name: "Web icon",
      format: "jpg",
      scale: 2,
      suffix: "@2x",
      quality: 0.9,
    });

    const setting = useExportPresetStore.getState().toExportSetting(preset.id);

    expect(setting).toMatchObject({ format: "jpg", scale: 2, suffix: "@2x", quality: 0.9 });
    expect(setting!.id).not.toBe(preset.id);
    expect((setting as unknown as { name?: string }).name).toBeUndefined();
  });

  it("toExportSetting returns null for an unknown preset id", () => {
    expect(useExportPresetStore.getState().toExportSetting("nope")).toBeNull();
  });

  it("a fresh module load rehydrates presets already in localStorage", async () => {
    const preset = useExportPresetStore.getState().addPreset({ name: "A", format: "png", scale: 1 });

    vi.resetModules();
    const { useExportPresetStore: freshStore } = await import("@/store/exportPresetStore");

    expect(freshStore.getState().presets).toEqual([preset]);
  });

  it("a fresh module load ignores malformed entries instead of throwing", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: "bad" }, // missing name/format/scale
        { id: "1", name: "ok", format: "not-a-format", scale: 1 }, // invalid format
        { id: "2", name: "Good", format: "png", scale: 2, suffix: "@2x" },
      ]),
    );

    vi.resetModules();
    const { useExportPresetStore: freshStore } = await import("@/store/exportPresetStore");

    expect(freshStore.getState().presets).toEqual([
      { id: "2", name: "Good", format: "png", scale: 2, suffix: "@2x" },
    ]);
  });
});
