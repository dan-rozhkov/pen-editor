import { describe, it, expect } from "vitest";
import { PLUGIN_UI_KIT_STYLES } from "../uiKitStyles";
import { THEME_CSS_VARS } from "../bootstrap";

describe("PLUGIN_UI_KIT_STYLES", () => {
  it("defines the documented .pen-* classes", () => {
    for (const cls of [
      ".pen-button",
      ".pen-button-primary",
      ".pen-input",
      ".pen-textarea",
      ".pen-select",
      ".pen-label",
      ".pen-checkbox",
      ".pen-row",
      ".pen-stack",
    ]) {
      expect(PLUGIN_UI_KIT_STYLES).toContain(cls);
    }
  });

  it("only references CSS custom properties that bootstrap.ts actually mirrors into the iframe", () => {
    // Guards against a future class referencing a token that themechange
    // never delivers (e.g. a typo'd var name, or a token that exists in
    // src/index.css but was never added to THEME_CSS_VARS).
    const used = new Set(
      [...PLUGIN_UI_KIT_STYLES.matchAll(/var\((--color-[a-z0-9-]+)/g)].map((m) => m[1]),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) {
      expect(THEME_CSS_VARS as readonly string[]).toContain(name);
    }
  });
});
