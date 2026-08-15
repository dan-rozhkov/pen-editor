import { describe, expect, it } from "vitest";
import type { BackgroundBlurEffect, Effect, GlassEffect } from "@/types/scene";
import {
  createGlassEffect,
  createSolidPaint,
  hasOpaqueEffectiveFill,
  normalizeGlassEffect,
  pickMaterialEffect,
} from "@/utils/fillUtils";

/** A GlassEffect with the given overrides, bypassing the factory's clamping. */
function glass(overrides: Partial<GlassEffect> = {}): GlassEffect {
  return { ...createGlassEffect(), ...overrides };
}

const backgroundBlur: BackgroundBlurEffect = { type: "background-blur", radius: 12, id: "bb" };

describe("createGlassEffect", () => {
  it("produces defaults inside the documented ranges", () => {
    const effect = createGlassEffect();
    expect(effect.type).toBe("glass");
    expect(effect.id).toBeTruthy();
    expect(effect.lightAngle).toBeGreaterThanOrEqual(0);
    expect(effect.lightAngle).toBeLessThan(360);
    for (const key of ["lightIntensity", "refraction", "dispersion", "splay"] as const) {
      expect(effect[key]).toBeGreaterThanOrEqual(0);
      expect(effect[key]).toBeLessThanOrEqual(1);
    }
    expect(effect.depth).toBeGreaterThanOrEqual(1);
    expect(effect.frost).toBeGreaterThanOrEqual(0);
  });

  it("gives every instance its own id", () => {
    expect(createGlassEffect().id).not.toBe(createGlassEffect().id);
  });

  it("lets init override any field", () => {
    expect(createGlassEffect({ refraction: 0.9, id: "fixed" })).toMatchObject({
      refraction: 0.9,
      id: "fixed",
    });
  });
});

describe("normalizeGlassEffect", () => {
  it("leaves an in-range effect untouched", () => {
    const effect = glass({ id: "g1", lightAngle: 90, refraction: 0.5, depth: 20 });
    expect(normalizeGlassEffect(effect)).toEqual(effect);
  });

  it("clamps the 0-1 params from both directions", () => {
    const normalized = normalizeGlassEffect(
      glass({ lightIntensity: 5, refraction: -2, dispersion: 1.5, splay: -0.1 }),
    );
    expect(normalized.lightIntensity).toBe(1);
    expect(normalized.refraction).toBe(0);
    expect(normalized.dispersion).toBe(1);
    expect(normalized.splay).toBe(0);
  });

  it("holds depth at its >= 1 floor and frost at its >= 0 floor", () => {
    const normalized = normalizeGlassEffect(glass({ depth: 0, frost: -8 }));
    expect(normalized.depth).toBe(1);
    expect(normalized.frost).toBe(0);
  });

  it("wraps lightAngle rather than clamping it — an angle is cyclic", () => {
    expect(normalizeGlassEffect(glass({ lightAngle: 405 })).lightAngle).toBe(45);
    expect(normalizeGlassEffect(glass({ lightAngle: -90 })).lightAngle).toBe(270);
    expect(normalizeGlassEffect(glass({ lightAngle: 360 })).lightAngle).toBe(0);
  });

  it("substitutes defaults for NaN/non-finite input instead of disabling the effect", () => {
    const defaults = createGlassEffect();
    const normalized = normalizeGlassEffect(
      glass({
        lightAngle: Number.NaN,
        refraction: Number.NaN,
        depth: Number.POSITIVE_INFINITY,
        frost: Number.NaN,
      }),
    );
    expect(normalized.lightAngle).toBe(defaults.lightAngle);
    expect(normalized.refraction).toBe(defaults.refraction);
    expect(normalized.frost).toBe(defaults.frost);
    // Infinity is treated the same as NaN: non-finite input has no meaningful
    // clamp target, so it falls back to the default rather than to the ceiling.
    expect(normalized.depth).toBe(defaults.depth);
  });

  it("preserves id and visible", () => {
    const normalized = normalizeGlassEffect(glass({ id: "keep", visible: false, depth: -5 }));
    expect(normalized.id).toBe("keep");
    expect(normalized.visible).toBe(false);
  });
});

describe("pickMaterialEffect", () => {
  it("returns undefined for a stack with no material effect", () => {
    const effects: Effect[] = [{ type: "blur", radius: 4 }];
    expect(pickMaterialEffect(effects)).toBeUndefined();
  });

  it("picks the first (lowest) Glass when several are present", () => {
    const first = glass({ id: "first" });
    const second = glass({ id: "second" });
    expect(pickMaterialEffect([first, second])?.id).toBe("first");
  });

  it("gives the material slot to whichever of Glass/background blur is lower in the stack", () => {
    expect(pickMaterialEffect([backgroundBlur, glass({ id: "g" })])?.type).toBe("background-blur");
    expect(pickMaterialEffect([glass({ id: "g" }), backgroundBlur])?.type).toBe("glass");
  });

  it("skips hidden effects", () => {
    const hidden = glass({ id: "hidden", visible: false });
    expect(pickMaterialEffect([hidden, backgroundBlur])?.type).toBe("background-blur");
    expect(pickMaterialEffect([hidden])).toBeUndefined();
  });

  it("normalizes the Glass it returns", () => {
    const picked = pickMaterialEffect([glass({ refraction: 99, lightAngle: 450 })]);
    expect(picked).toMatchObject({ type: "glass", refraction: 1, lightAngle: 90 });
  });

  it("does not normalize a background blur (it has no ranged params of its own)", () => {
    expect(pickMaterialEffect([backgroundBlur])).toBe(backgroundBlur);
  });
});

describe("hasOpaqueEffectiveFill", () => {
  it("is true for a single fully opaque solid fill", () => {
    expect(hasOpaqueEffectiveFill({ fills: [createSolidPaint("#ff0000")] })).toBe(true);
    expect(hasOpaqueEffectiveFill({ fills: [createSolidPaint("#ff0000ff")] })).toBe(true);
  });

  it("is false when the top solid fill carries alpha", () => {
    expect(hasOpaqueEffectiveFill({ fills: [createSolidPaint("#ff000080")] })).toBe(false);
  });

  it("is false when paint opacity is below 1", () => {
    expect(
      hasOpaqueEffectiveFill({ fills: [createSolidPaint("#ff0000", { opacity: 0.5 })] }),
    ).toBe(false);
  });

  it("is false when node opacity is below 1", () => {
    expect(hasOpaqueEffectiveFill({ fills: [createSolidPaint("#ff0000")], opacity: 0.5 })).toBe(
      false,
    );
  });

  it("is false for an empty or fully hidden fill stack", () => {
    expect(hasOpaqueEffectiveFill({ fills: [] })).toBe(false);
    expect(
      hasOpaqueEffectiveFill({ fills: [createSolidPaint("#ff0000", { visible: false })] }),
    ).toBe(false);
  });

  it("stays false for a bound colour — the variable may resolve to a translucent value", () => {
    expect(
      hasOpaqueEffectiveFill({
        fills: [createSolidPaint("#ff0000", { colorBinding: { variableId: "v1" } })],
      }),
    ).toBe(false);
  });

  it("stays false for a non-normal blend mode", () => {
    expect(
      hasOpaqueEffectiveFill({ fills: [createSolidPaint("#ff0000", { blendMode: "multiply" })] }),
    ).toBe(false);
  });

  it("sees an opaque solid painted over a translucent one", () => {
    expect(
      hasOpaqueEffectiveFill({
        fills: [createSolidPaint("#00000010"), createSolidPaint("#ffffff")],
      }),
    ).toBe(true);
  });

  it("reads the legacy single-fill fields too", () => {
    expect(hasOpaqueEffectiveFill({ fill: "#123456" })).toBe(true);
    expect(hasOpaqueEffectiveFill({ fill: "#12345680" })).toBe(false);
  });
});
