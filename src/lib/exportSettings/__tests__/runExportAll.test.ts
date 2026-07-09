import { describe, expect, it, vi } from "vitest";
import { runExportSettingsForNode, type ExportRunners } from "@/lib/exportSettings/runExportAll";
import type { ExportSetting } from "@/types/scene";

function makeRunners(overrides: Partial<ExportRunners> = {}): ExportRunners {
  return {
    exportSvg: vi.fn().mockResolvedValue({ warnings: [] }),
    exportRaster: vi.fn().mockResolvedValue(true),
    exportPdf: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("runExportSettingsForNode", () => {
  it("returns an empty result list for no settings", async () => {
    const runners = makeRunners();
    const results = await runExportSettingsForNode("n1", "Icon", [], null, runners);
    expect(results).toEqual([]);
    expect(runners.exportSvg).not.toHaveBeenCalled();
  });

  it("dispatches svg settings to exportSvg with the computed filename", async () => {
    const runners = makeRunners();
    const settings: ExportSetting[] = [{ id: "s1", format: "svg", scale: 1, suffix: "_dark" }];

    const results = await runExportSettingsForNode("n1", "Icon", settings, null, runners);

    expect(runners.exportSvg).toHaveBeenCalledWith("n1", "Icon", "Icon_dark.svg");
    expect(results).toEqual([
      { settingId: "s1", format: "svg", filename: "Icon_dark.svg", success: true, warnings: [] },
    ]);
  });

  it("dispatches raster settings (png/jpg/webp) to exportRaster with scale/quality", async () => {
    const runners = makeRunners();
    const settings: ExportSetting[] = [
      { id: "s1", format: "png", scale: 2 },
      { id: "s2", format: "jpg", scale: 1, quality: 0.8, suffix: "@1x" },
      { id: "s3", format: "webp", scale: 0.5 },
    ];

    const results = await runExportSettingsForNode("n1", "Icon", settings, {} as never, runners);

    expect(runners.exportRaster).toHaveBeenNthCalledWith(1, {}, "n1", "png", 2, "Icon@2x.png", undefined);
    expect(runners.exportRaster).toHaveBeenNthCalledWith(2, {}, "n1", "jpg", 1, "Icon@1x.jpg", 0.8);
    expect(runners.exportRaster).toHaveBeenNthCalledWith(3, {}, "n1", "webp", 0.5, "Icon@0.5x.webp", undefined);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("dispatches pdf settings to exportPdf", async () => {
    const runners = makeRunners();
    const settings: ExportSetting[] = [{ id: "s1", format: "pdf", scale: 1 }];

    const results = await runExportSettingsForNode("n1", "Screen", settings, {} as never, runners);

    expect(runners.exportPdf).toHaveBeenCalledWith({}, "n1", "Screen", 1, "Screen.pdf");
    expect(results[0]).toEqual({ settingId: "s1", format: "pdf", filename: "Screen.pdf", success: true });
  });

  it("continues after a failed setting and reports success:false for it", async () => {
    const runners = makeRunners({
      exportRaster: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    });
    const settings: ExportSetting[] = [
      { id: "s1", format: "png", scale: 1 },
      { id: "s2", format: "png", scale: 2 },
    ];

    const results = await runExportSettingsForNode("n1", "Icon", settings, {} as never, runners);

    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(true);
  });

  it("captures a thrown error as a failed result instead of throwing", async () => {
    const runners = makeRunners({
      exportRaster: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const settings: ExportSetting[] = [{ id: "s1", format: "png", scale: 1 }];

    const results = await runExportSettingsForNode("n1", "Icon", settings, {} as never, runners);

    expect(results).toEqual([
      { settingId: "s1", format: "png", filename: "Icon.png", success: false, error: "boom" },
    ]);
  });

  it("falls back to nodeId as the base filename when nodeName is undefined", async () => {
    const runners = makeRunners();
    const settings: ExportSetting[] = [{ id: "s1", format: "png", scale: 1 }];

    await runExportSettingsForNode("node-42", undefined, settings, {} as never, runners);

    expect(runners.exportRaster).toHaveBeenCalledWith({}, "node-42", "png", 1, "node-42.png", undefined);
  });
});
