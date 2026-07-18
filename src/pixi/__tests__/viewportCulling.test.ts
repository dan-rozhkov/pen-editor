import { BlurFilter, Container, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";
import { applyOverviewEffectVisibility } from "../viewportCulling";

describe("applyOverviewEffectVisibility", () => {
  it("temporarily disables renderer-owned effects and restores them after overview", () => {
    const container = new Container();
    const shadow = new Container({ label: "shadow-layer" });
    const backdrop = new Sprite({ label: "background-blur-fill" });
    const blur = new BlurFilter() as BlurFilter & { __layerBlur?: true };
    blur.__layerBlur = true;
    container.addChild(shadow, backdrop);
    container.filters = [blur];

    applyOverviewEffectVisibility(container, true);
    expect(shadow.renderable).toBe(false);
    expect(backdrop.renderable).toBe(false);
    expect(blur.enabled).toBe(false);

    applyOverviewEffectVisibility(container, false);
    expect(shadow.renderable).toBe(true);
    expect(backdrop.renderable).toBe(true);
    expect(blur.enabled).toBe(true);
  });
});
