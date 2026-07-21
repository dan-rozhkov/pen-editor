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
    // src/index.css but was never added to THEME_CSS_VARS). Matches both the
    // `--color-*` family and the app's un-prefixed `--primary`/`--secondary`/
    // `--input` tokens (`.pen-button-primary`/`.pen-input`/`.pen-select` key
    // off those directly, see bootstrap.ts's THEME_CSS_VARS comment).
    const used = new Set(
      [...PLUGIN_UI_KIT_STYLES.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) {
      expect(THEME_CSS_VARS as readonly string[]).toContain(name);
    }
  });

  it("declares background/border-color on the primary button's own hover rule (specificity guard)", () => {
    // Regression guard for the critical bug where `.pen-button:hover`'s
    // background/border-color (same tie-broken specificity as a bare
    // `.pen-button-primary:hover`) beat the primary variant's, turning it
    // grey. The compound `.pen-button.pen-button-primary:hover` selector
    // must outrank it and re-declare both properties itself.
    const match = PLUGIN_UI_KIT_STYLES.match(
      /\.pen-button\.pen-button-primary:hover:not\(:disabled\)\s*{([^}]*)}/,
    );
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).toMatch(/background:/);
    expect(body).toMatch(/border-color:/);
  });
});
