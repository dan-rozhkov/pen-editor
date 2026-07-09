import { describe, expect, it, vi } from "vitest";
import { mergeCustomFontsIntoList, notifyFontsChanged, registerFontLoadCallback, type SystemFont } from "@/utils/fontUtils";

describe("mergeCustomFontsIntoList", () => {
  const baseFonts: SystemFont[] = [
    { family: "Arial", isSystemFont: false },
    { family: "Roboto", isSystemFont: false, isGoogleFont: true },
  ];

  it("returns the base list unchanged when there are no custom fonts", () => {
    expect(mergeCustomFontsIntoList(baseFonts, [])).toEqual(baseFonts);
  });

  it("prepends custom fonts, flagged, ahead of the base list", () => {
    const result = mergeCustomFontsIntoList(baseFonts, ["Brand Sans"]);
    expect(result[0]).toEqual({ family: "Brand Sans", isSystemFont: false, isCustomFont: true });
    expect(result.slice(1)).toEqual(baseFonts);
  });

  it("de-duplicates a custom font that shadows a base-list family, case-insensitively", () => {
    const result = mergeCustomFontsIntoList(baseFonts, ["arial"]);
    expect(result).toEqual([
      { family: "arial", isSystemFont: false, isCustomFont: true },
      { family: "Roboto", isSystemFont: false, isGoogleFont: true },
    ]);
  });
});

describe("notifyFontsChanged", () => {
  // Runs before any registerFontLoadCallback call in this file so the
  // module-level callback slot is still in its initial (unset) state.
  it("does not throw when no callback is registered yet", () => {
    expect(() => notifyFontsChanged()).not.toThrow();
  });

  it("invokes the callback registered via registerFontLoadCallback", () => {
    const cb = vi.fn();
    registerFontLoadCallback(cb);
    notifyFontsChanged();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
