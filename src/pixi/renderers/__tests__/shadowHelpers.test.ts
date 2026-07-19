import { describe, it, expect } from "vitest";
import { Container, Graphics, BlurFilter } from "pixi.js";
import { applyShadows } from "../shadowHelpers";
import type { ShadowEffect } from "@/types/scene";

function outerShadow(extra: Partial<ShadowEffect> = {}): ShadowEffect {
  return {
    type: "shadow",
    shadowType: "outer",
    color: "#00000040",
    offset: { x: 0, y: 4 },
    blur: 8,
    spread: 0,
    ...extra,
  };
}

function innerShadow(extra: Partial<ShadowEffect> = {}): ShadowEffect {
  return {
    type: "shadow",
    shadowType: "inner",
    color: "#00000080",
    offset: { x: 2, y: 2 },
    blur: 6,
    spread: 0,
    ...extra,
  };
}

describe("applyShadows", () => {
  it("renders an inner shadow as a layer on top of the node's own content", () => {
    const container = new Container();
    const bg = new Graphics();
    bg.label = "rect-bg";
    container.addChild(bg);

    applyShadows(container, [innerShadow()], 100, 80);

    const layer = container.getChildByLabel("inner-shadow-layer");
    expect(layer).toBeTruthy();
    expect(container.getChildIndex(layer!)).toBeGreaterThan(container.getChildIndex(bg));
  });

  it("clips the inner shadow layer to the node's own shape via a mask", () => {
    const container = new Container();
    applyShadows(container, [innerShadow()], 100, 80);
    const layer = container.getChildByLabel("inner-shadow-layer");
    expect(layer?.mask).toBeTruthy();
  });

  it("applies a blur filter when blur > 0", () => {
    const container = new Container();
    applyShadows(container, [innerShadow({ blur: 10 })], 100, 80);
    const layer = container.getChildByLabel("inner-shadow-layer");
    expect(layer?.filters).toBeTruthy();
    const filters = Array.isArray(layer?.filters) ? layer!.filters : [layer!.filters];
    expect(filters.some((f) => f instanceof BlurFilter)).toBe(true);
  });

  it("does not apply a blur filter when blur is 0", () => {
    const container = new Container();
    applyShadows(container, [innerShadow({ blur: 0 })], 100, 80);
    const layer = container.getChildByLabel("inner-shadow-layer");
    const filters = layer?.filters;
    const list = Array.isArray(filters) ? filters : filters ? [filters] : [];
    expect(list.length).toBe(0);
  });

  it("supports multiple inner shadow instances stacked", () => {
    const container = new Container();
    applyShadows(container, [innerShadow(), innerShadow({ offset: { x: -2, y: -2 } })], 100, 80);
    const layers = container.children.filter((c) => c.label === "inner-shadow-layer");
    expect(layers).toHaveLength(2);
  });

  it("renders both an outer (drop) shadow and an inner shadow together", () => {
    const container = new Container();
    const bg = new Graphics();
    bg.label = "rect-bg";
    container.addChild(bg);

    applyShadows(container, [outerShadow(), innerShadow()], 100, 80);

    const outerLayer = container.getChildByLabel("shadow-layer");
    const innerLayer = container.getChildByLabel("inner-shadow-layer");
    expect(outerLayer).toBeTruthy();
    expect(innerLayer).toBeTruthy();
    // outer stays behind the node content, inner sits above it
    expect(container.getChildIndex(outerLayer!)).toBeLessThan(container.getChildIndex(bg));
    expect(container.getChildIndex(innerLayer!)).toBeGreaterThan(container.getChildIndex(bg));
  });

  it("re-applying shadows removes stale inner shadow layers instead of accumulating them", () => {
    const container = new Container();
    applyShadows(container, [innerShadow()], 100, 80);
    applyShadows(container, [innerShadow(), innerShadow()], 100, 80);
    const layers = container.children.filter((c) => c.label === "inner-shadow-layer");
    expect(layers).toHaveLength(2);
  });

  it("ignores non-visible (filtered-out) effects passed in as already-renderable list — no inner layer for empty list", () => {
    const container = new Container();
    applyShadows(container, [], 100, 80);
    expect(container.getChildByLabel("inner-shadow-layer")).toBeNull();
  });

  // bug-19 mechanism 2: the blur filter's own padding must cover the full
  // blur radius so the blurred edge always has room to render (Pixi's
  // BlurFilter already auto-computes padding = 2 * strength, but this pins
  // the invariant explicitly rather than relying on that internal default).
  it("an outer shadow's blur filter padding covers the full blur radius", () => {
    const container = new Container();
    applyShadows(container, [outerShadow({ blur: 24 })], 100, 80);
    const layer = container.getChildByLabel("shadow-layer");
    const filters = Array.isArray(layer?.filters) ? layer!.filters : [layer!.filters];
    const blurFilter = filters.find((f) => f instanceof BlurFilter) as BlurFilter;
    expect(blurFilter.padding).toBeGreaterThanOrEqual(24);
  });

  it("an inner shadow's blur filter padding covers the full blur radius", () => {
    const container = new Container();
    applyShadows(container, [innerShadow({ blur: 18 })], 100, 80);
    const layer = container.getChildByLabel("inner-shadow-layer");
    const filters = Array.isArray(layer?.filters) ? layer!.filters : [layer!.filters];
    const blurFilter = filters.find((f) => f instanceof BlurFilter) as BlurFilter;
    expect(blurFilter.padding).toBeGreaterThanOrEqual(18);
  });
});
