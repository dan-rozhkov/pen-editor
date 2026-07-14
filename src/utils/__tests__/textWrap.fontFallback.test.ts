import { describe, it, expect } from "vitest";
import { buildFontString } from "../textWrap";

describe("buildFontString fontFallback", () => {
  it("appends the generic fallback and quotes the primary family", () => {
    const font = buildFontString({
      fontFamily: "Plus Jakarta Sans",
      fontFallback: "sans-serif",
      fontSize: 32,
    });
    expect(font).toContain('"Plus Jakarta Sans", sans-serif');
  });

  it("omits the fallback when unset", () => {
    const font = buildFontString({ fontFamily: "Inter", fontSize: 16 });
    expect(font.endsWith('"Inter"')).toBe(true);
  });
});
