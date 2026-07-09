import { describe, expect, it } from "vitest";
import {
  createExportSetting,
  buildExportFilename,
  computeExportSize,
  addExportSetting,
  removeExportSetting,
  updateExportSetting,
  sanitizeExportBaseName,
  sanitizeExportSuffix,
  getExportSettingExtension,
  getExportSettingMimeType,
  isRasterExportFormat,
  formatScaleLabel,
} from "@/utils/exportSettingsUtils";
import type { ExportSetting } from "@/types/scene";

describe("createExportSetting", () => {
  it("defaults to png/1x with a fresh id", () => {
    const setting = createExportSetting();
    expect(setting.format).toBe("png");
    expect(setting.scale).toBe(1);
    expect(setting.suffix).toBeUndefined();
    expect(setting.quality).toBeUndefined();
    expect(typeof setting.id).toBe("string");
    expect(setting.id.length).toBeGreaterThan(0);
  });

  it("applies overrides and gives each call a unique id", () => {
    const a = createExportSetting({ format: "jpg", scale: 2, suffix: "@2x", quality: 0.8 });
    const b = createExportSetting({ format: "jpg", scale: 2, suffix: "@2x", quality: 0.8 });
    expect(a).toMatchObject({ format: "jpg", scale: 2, suffix: "@2x", quality: 0.8 });
    expect(a.id).not.toBe(b.id);
  });
});

describe("sanitizeExportBaseName", () => {
  it("strips unsafe characters and falls back to 'canvas'", () => {
    expect(sanitizeExportBaseName("My Icon / v2")).toBe("My_Icon___v2");
    expect(sanitizeExportBaseName("")).toBe("canvas");
    expect(sanitizeExportBaseName("!!!")).toBe("___");
  });
});

describe("sanitizeExportSuffix", () => {
  it("keeps @, alphanumerics, underscore and hyphen", () => {
    expect(sanitizeExportSuffix("@2x")).toBe("@2x");
    expect(sanitizeExportSuffix("_dark")).toBe("_dark");
    expect(sanitizeExportSuffix("-v2")).toBe("-v2");
  });

  it("neutralizes path separators and traversal sequences", () => {
    expect(sanitizeExportSuffix("../../etc/passwd")).toBe("______etc_passwd");
    expect(sanitizeExportSuffix("a/b\\c")).toBe("a_b_c");
    expect(sanitizeExportSuffix("with space")).toBe("with_space");
    // No path separator survives sanitization.
    expect(sanitizeExportSuffix("../../etc/passwd")).not.toContain("/");
  });
});

describe("formatScaleLabel", () => {
  it("drops trailing zeros", () => {
    expect(formatScaleLabel(2)).toBe("2");
    expect(formatScaleLabel(1.5)).toBe("1.5");
    expect(formatScaleLabel(0.5)).toBe("0.5");
  });
});

describe("buildExportFilename", () => {
  it("builds a plain filename at 1x with no suffix", () => {
    const setting: ExportSetting = { id: "1", format: "png", scale: 1 };
    expect(buildExportFilename("Icon", setting)).toBe("Icon.png");
  });

  it("appends the suffix verbatim", () => {
    const setting: ExportSetting = { id: "1", format: "png", scale: 1, suffix: "_dark" };
    expect(buildExportFilename("Icon", setting)).toBe("Icon_dark.png");
  });

  it("appends an auto scale label when scale isn't 1x", () => {
    const setting: ExportSetting = { id: "1", format: "png", scale: 2 };
    expect(buildExportFilename("Icon", setting)).toBe("Icon@2x.png");
  });

  it("combines suffix + scale label, suffix first", () => {
    const setting: ExportSetting = { id: "1", format: "jpg", scale: 3, suffix: "_dark" };
    expect(buildExportFilename("Icon", setting)).toBe("Icon_dark@3x.jpg");
  });

  it("sanitizes the base name and uses the format's extension", () => {
    const setting: ExportSetting = { id: "1", format: "webp", scale: 0.5 };
    expect(buildExportFilename("My Icon!", setting)).toBe("My_Icon_@0.5x.webp");
  });

  it("uses .svg/.pdf extensions", () => {
    expect(buildExportFilename("Icon", { format: "svg", scale: 1 })).toBe("Icon.svg");
    expect(buildExportFilename("Icon", { format: "pdf", scale: 1 })).toBe("Icon.pdf");
  });

  it("sanitizes a hostile suffix so it cannot inject a path", () => {
    const filename = buildExportFilename("Icon", {
      format: "png",
      scale: 1,
      suffix: "../../etc/passwd",
    });
    expect(filename).toBe("Icon______etc_passwd.png");
    expect(filename).not.toContain("/");
    expect(filename).not.toContain("\\");
  });
});

describe("computeExportSize", () => {
  it("multiplies width/height by scale", () => {
    expect(computeExportSize(100, 50, 2)).toEqual({ width: 200, height: 100 });
    expect(computeExportSize(100, 50, 0.5)).toEqual({ width: 50, height: 25 });
    expect(computeExportSize(100, 50, 1)).toEqual({ width: 100, height: 50 });
  });
});

describe("getExportSettingExtension / getExportSettingMimeType", () => {
  it("maps every format to an extension and mime type", () => {
    expect(getExportSettingExtension("jpg")).toBe("jpg");
    expect(getExportSettingMimeType("jpg")).toBe("image/jpeg");
    expect(getExportSettingMimeType("webp")).toBe("image/webp");
    expect(getExportSettingMimeType("svg")).toBe("image/svg+xml");
    expect(getExportSettingMimeType("pdf")).toBe("application/pdf");
    expect(getExportSettingMimeType("png")).toBe("image/png");
  });
});

describe("isRasterExportFormat", () => {
  it("is true only for png/jpg/webp", () => {
    expect(isRasterExportFormat("png")).toBe(true);
    expect(isRasterExportFormat("jpg")).toBe(true);
    expect(isRasterExportFormat("webp")).toBe(true);
    expect(isRasterExportFormat("svg")).toBe(false);
    expect(isRasterExportFormat("pdf")).toBe(false);
  });
});

describe("export setting list helpers (add/remove/update)", () => {
  it("addExportSetting appends without mutating the input array", () => {
    const original: ExportSetting[] = [{ id: "1", format: "png", scale: 1 }];
    const added = createExportSetting({ format: "svg" });
    const next = addExportSetting(original, added);

    expect(next).toHaveLength(2);
    expect(original).toHaveLength(1);
    expect(next[1]).toBe(added);
  });

  it("addExportSetting handles an undefined existing list", () => {
    const setting = createExportSetting();
    expect(addExportSetting(undefined, setting)).toEqual([setting]);
  });

  it("removeExportSetting filters by id without mutating the input", () => {
    const original: ExportSetting[] = [
      { id: "1", format: "png", scale: 1 },
      { id: "2", format: "svg", scale: 1 },
    ];
    const next = removeExportSetting(original, "1");
    expect(next).toEqual([{ id: "2", format: "svg", scale: 1 }]);
    expect(original).toHaveLength(2);
  });

  it("updateExportSetting patches only the matching entry", () => {
    const original: ExportSetting[] = [
      { id: "1", format: "png", scale: 1 },
      { id: "2", format: "svg", scale: 1 },
    ];
    const next = updateExportSetting(original, "1", { scale: 3, suffix: "@3x" });
    expect(next[0]).toEqual({ id: "1", format: "png", scale: 3, suffix: "@3x" });
    expect(next[1]).toEqual(original[1]);
    expect(original[0].scale).toBe(1);
  });
});
