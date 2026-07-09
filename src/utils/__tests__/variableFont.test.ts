import { describe, it, expect } from "vitest";
import {
  parseFvarAxes,
  getVariableFontAxes,
  isVariableFont,
  clampToAxis,
  toFontVariationSettingsCss,
  resolveEffectiveFontWeight,
  hasItalicVariant,
  type FontAxis,
} from "../variableFont";

/** Write a 16.16 fixed-point number (whole values only, sufficient for these tests). */
function writeFixed(view: DataView, offset: number, value: number): void {
  view.setInt16(offset, value, false);
  view.setUint16(offset + 2, 0, false);
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) {
    view.setUint8(offset + i, tag.charCodeAt(i));
  }
}

/** Build a minimal single-table sfnt binary containing only an `fvar` table. */
function buildFvarFontBinary(
  axes: { tag: string; min: number; default: number; max: number }[],
): ArrayBuffer {
  const tableDirStart = 12;
  const fvarOffset = tableDirStart + 1 * 16; // one table record
  const fvarHeaderSize = 16;
  const axisSize = 20;
  const totalSize = fvarOffset + fvarHeaderSize + axes.length * axisSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // sfnt header
  view.setUint32(0, 0x00010000, false); // TTF version
  view.setUint16(4, 1, false); // numTables
  view.setUint16(6, 0, false);
  view.setUint16(8, 0, false);
  view.setUint16(10, 0, false);

  // table directory record for 'fvar'
  writeTag(view, tableDirStart, "fvar");
  view.setUint32(tableDirStart + 4, 0, false); // checksum (unused)
  view.setUint32(tableDirStart + 8, fvarOffset, false); // offset
  view.setUint32(tableDirStart + 12, fvarHeaderSize + axes.length * axisSize, false); // length

  // fvar header
  view.setUint16(fvarOffset + 0, 1, false); // majorVersion
  view.setUint16(fvarOffset + 2, 0, false); // minorVersion
  view.setUint16(fvarOffset + 4, fvarHeaderSize, false); // axesArrayOffset (relative to fvar table start)
  view.setUint16(fvarOffset + 6, 2, false); // reserved
  view.setUint16(fvarOffset + 8, axes.length, false); // axisCount
  view.setUint16(fvarOffset + 10, axisSize, false); // axisSize
  view.setUint16(fvarOffset + 12, 0, false); // instanceCount
  view.setUint16(fvarOffset + 14, 4, false); // instanceSize

  // axes array
  const axesArrayStart = fvarOffset + fvarHeaderSize;
  axes.forEach((axis, i) => {
    const axisOffset = axesArrayStart + i * axisSize;
    writeTag(view, axisOffset, axis.tag);
    writeFixed(view, axisOffset + 4, axis.min);
    writeFixed(view, axisOffset + 8, axis.default);
    writeFixed(view, axisOffset + 12, axis.max);
    view.setUint16(axisOffset + 16, 0, false); // flags
    view.setUint16(axisOffset + 18, 256, false); // axisNameID
  });

  return buffer;
}

describe("parseFvarAxes", () => {
  it("parses a single-axis fvar table (wght)", () => {
    const buffer = buildFvarFontBinary([{ tag: "wght", min: 100, default: 400, max: 900 }]);
    const axes = parseFvarAxes(buffer);
    expect(axes).toEqual([
      { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 },
    ]);
  });

  it("parses a multi-axis fvar table in declared order", () => {
    const buffer = buildFvarFontBinary([
      { tag: "wght", min: 100, default: 400, max: 1000 },
      { tag: "wdth", min: 25, default: 100, max: 151 },
      { tag: "opsz", min: 8, default: 14, max: 144 },
    ]);
    const axes = parseFvarAxes(buffer);
    expect(axes.map((a) => a.tag)).toEqual(["wght", "wdth", "opsz"]);
    expect(axes[1]).toMatchObject({ min: 25, default: 100, max: 151 });
  });

  it("returns [] for a static font with no fvar table", () => {
    // sfnt header + directory with an unrelated 'name' table only.
    const buffer = new ArrayBuffer(28);
    const view = new DataView(buffer);
    view.setUint32(0, 0x00010000, false);
    view.setUint16(4, 1, false);
    writeTag(view, 12, "name");
    view.setUint32(16, 0, false);
    view.setUint32(20, 28, false);
    view.setUint32(24, 0, false);
    expect(parseFvarAxes(buffer)).toEqual([]);
  });

  it("returns [] for a non-sfnt / garbage buffer", () => {
    expect(parseFvarAxes(new ArrayBuffer(4))).toEqual([]);
    expect(parseFvarAxes(new ArrayBuffer(0))).toEqual([]);
  });
});

describe("getVariableFontAxes / isVariableFont", () => {
  it("returns known axes for a registered variable font", () => {
    const axes = getVariableFontAxes("Inter");
    expect(axes).toBeDefined();
    expect(axes?.[0]).toMatchObject({ tag: "wght" });
  });

  it("resolves a CSS-style font-family list to its primary family", () => {
    expect(isVariableFont('"Inter", sans-serif')).toBe(true);
  });

  it("returns undefined for a non-variable / unknown font", () => {
    expect(getVariableFontAxes("Arial")).toBeUndefined();
    expect(isVariableFont("Arial")).toBe(false);
  });

  it("returns undefined when family is undefined", () => {
    expect(getVariableFontAxes(undefined)).toBeUndefined();
  });
});

describe("clampToAxis", () => {
  const axis: FontAxis = { tag: "wght", min: 100, default: 400, max: 900 };
  it("passes through in-range values", () => {
    expect(clampToAxis(axis, 530)).toBe(530);
  });
  it("clamps below min and above max", () => {
    expect(clampToAxis(axis, 0)).toBe(100);
    expect(clampToAxis(axis, 2000)).toBe(900);
  });
});

describe("toFontVariationSettingsCss", () => {
  it("returns undefined for undefined/empty input", () => {
    expect(toFontVariationSettingsCss(undefined)).toBeUndefined();
    expect(toFontVariationSettingsCss({})).toBeUndefined();
  });

  it("formats a single axis", () => {
    expect(toFontVariationSettingsCss({ wght: 530 })).toBe('"wght" 530');
  });

  it("formats multiple axes joined by commas", () => {
    expect(toFontVariationSettingsCss({ wght: 700, wdth: 87 })).toBe('"wght" 700, "wdth" 87');
  });
});

describe("resolveEffectiveFontWeight", () => {
  it("uses the wght axis over the static weight when set", () => {
    expect(resolveEffectiveFontWeight({ wght: 530 }, "normal")).toBe("530");
    expect(resolveEffectiveFontWeight({ wght: 450.6 }, 700)).toBe("451");
  });

  it("clamps wght into the valid CSS [1, 1000] range", () => {
    expect(resolveEffectiveFontWeight({ wght: 0 }, "normal")).toBe("1");
    expect(resolveEffectiveFontWeight({ wght: -50 }, "normal")).toBe("1");
    expect(resolveEffectiveFontWeight({ wght: 5000 }, "normal")).toBe("1000");
  });

  it("ignores non-finite wght and falls back to the static weight", () => {
    expect(resolveEffectiveFontWeight({ wght: NaN }, 600)).toBe("600");
    expect(resolveEffectiveFontWeight({ wght: Infinity }, "bold")).toBe("bold");
  });

  it("falls back to 'normal' when neither is provided", () => {
    expect(resolveEffectiveFontWeight(undefined, undefined)).toBe("normal");
    expect(resolveEffectiveFontWeight({}, undefined)).toBe("normal");
  });
});

describe("hasItalicVariant", () => {
  it("is true for known italic-capable variable families", () => {
    expect(hasItalicVariant("Inter")).toBe(true);
    expect(hasItalicVariant("Source Serif 4")).toBe(true);
    expect(hasItalicVariant('"Inter Tight", sans-serif')).toBe(true);
  });

  it("is false for slnt-only families and unknown/undefined families", () => {
    expect(hasItalicVariant("Roboto Flex")).toBe(false);
    expect(hasItalicVariant("Recursive")).toBe(false);
    expect(hasItalicVariant("Arial")).toBe(false);
    expect(hasItalicVariant(undefined)).toBe(false);
  });
});
