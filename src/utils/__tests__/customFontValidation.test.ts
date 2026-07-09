import { describe, expect, it } from "vitest";
import {
  deriveFontFamilyName,
  getFontFormatFromFileName,
  isDuplicateFamily,
  validateCustomFontFile,
} from "@/utils/customFontValidation";

describe("getFontFormatFromFileName", () => {
  it("recognizes accepted extensions case-insensitively", () => {
    expect(getFontFormatFromFileName("Brand.ttf")).toBe("ttf");
    expect(getFontFormatFromFileName("Brand.OTF")).toBe("otf");
    expect(getFontFormatFromFileName("brand-Regular.woff")).toBe("woff");
    expect(getFontFormatFromFileName("brand-Regular.WOFF2")).toBe("woff2");
  });

  it("returns null for unsupported extensions", () => {
    expect(getFontFormatFromFileName("brand.pdf")).toBeNull();
    expect(getFontFormatFromFileName("brand.exe")).toBeNull();
    expect(getFontFormatFromFileName("brand")).toBeNull();
  });
});

describe("deriveFontFamilyName", () => {
  it("strips the extension", () => {
    expect(deriveFontFamilyName("MyBrandFont.ttf")).toBe("MyBrandFont");
  });

  it("replaces separators with spaces and collapses whitespace", () => {
    expect(deriveFontFamilyName("my_brand-font__bold.woff2")).toBe("my brand font bold");
  });

  it("falls back to a default name when nothing usable remains", () => {
    expect(deriveFontFamilyName("___.ttf")).toBe("Custom Font");
    expect(deriveFontFamilyName(".otf")).toBe("Custom Font");
  });

  it("strips commas and quotes that would break CSS font-family matching", () => {
    // A comma would later truncate the family (`"Foo, Bar" -> "Foo"`) and
    // quotes are the CSS family delimiters.
    expect(deriveFontFamilyName('Foo, Bar.ttf')).toBe("Foo Bar");
    expect(deriveFontFamilyName('"Quoted".otf')).toBe("Quoted");
  });
});

describe("isDuplicateFamily", () => {
  it("compares case-insensitively", () => {
    expect(isDuplicateFamily("Brand Sans", ["brand sans"])).toBe(true);
    expect(isDuplicateFamily("Brand Sans", ["Other Font"])).toBe(false);
  });
});

describe("validateCustomFontFile", () => {
  it("accepts a valid ttf file and derives its family name", () => {
    const result = validateCustomFontFile({ name: "Brand.ttf", size: 1024 }, []);
    expect(result).toEqual({ ok: true, format: "ttf", family: "Brand" });
  });

  it("rejects unsupported extensions with a clear message", () => {
    const result = validateCustomFontFile({ name: "Brand.pdf", size: 1024 }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unsupported/i);
  });

  it("rejects empty files", () => {
    const result = validateCustomFontFile({ name: "Brand.ttf", size: 0 }, []);
    expect(result.ok).toBe(false);
  });

  it("rejects oversized files", () => {
    const result = validateCustomFontFile({ name: "Brand.ttf", size: 25 * 1024 * 1024 }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/large/i);
  });

  it("rejects a duplicate family name", () => {
    const result = validateCustomFontFile({ name: "Brand.ttf", size: 1024 }, ["Brand"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already uploaded/i);
  });

  it("rejects a name that collides with a reserved built-in font (case-insensitive)", () => {
    const result = validateCustomFontFile({ name: "arial.ttf", size: 1024 }, [], ["Arial", "Inter"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/built-in font/i);
  });

  it("accepts a name that does not collide with reserved fonts", () => {
    const result = validateCustomFontFile({ name: "Brand.ttf", size: 1024 }, [], ["Arial", "Inter"]);
    expect(result.ok).toBe(true);
  });
});
