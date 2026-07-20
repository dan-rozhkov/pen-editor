import { describe, it, expect } from "vitest";
import { pickNoiseEffects, noiseParamsKey, type NoiseMaskShape } from "../noiseEffectHelpers";
import { createNoiseEffect, createShadowEffect } from "@/utils/fillUtils";
import type { Effect, NoiseEffect } from "@/types/scene";

const RECT_SHAPE: NoiseMaskShape = { ellipse: false, cornerRadius: 0 };

describe("pickNoiseEffects", () => {
  it("returns an empty array for an empty stack", () => {
    expect(pickNoiseEffects([])).toEqual([]);
  });

  it("returns an empty array for a shadow/blur-only stack", () => {
    const effects: Effect[] = [createShadowEffect(), { type: "blur", radius: 4 }];
    expect(pickNoiseEffects(effects)).toEqual([]);
  });

  it("picks a single visible noise effect", () => {
    const noise = createNoiseEffect();
    const effects: Effect[] = [createShadowEffect(), noise];
    expect(pickNoiseEffects(effects)).toEqual([noise]);
  });

  it("picks at most the first two visible noise effects, preserving stack order", () => {
    const n1 = createNoiseEffect({ noiseSize: 1 });
    const n2 = createNoiseEffect({ noiseSize: 2 });
    const n3 = createNoiseEffect({ noiseSize: 3 });
    const effects: Effect[] = [n1, n2, n3];
    expect(pickNoiseEffects(effects)).toEqual([n1, n2]);
  });

  it("skips a noise effect with visible: false", () => {
    const hidden = createNoiseEffect({ visible: false });
    const visible = createNoiseEffect({ noiseSize: 2 });
    const effects: Effect[] = [hidden, visible];
    expect(pickNoiseEffects(effects)).toEqual([visible]);
  });

  it("skips a noise effect with density 0", () => {
    const zero = createNoiseEffect({ density: 0 });
    const nonZero = createNoiseEffect({ noiseSize: 2, density: 0.3 });
    const effects: Effect[] = [zero, nonZero];
    expect(pickNoiseEffects(effects)).toEqual([nonZero]);
  });
});

describe("noiseParamsKey", () => {
  it("is stable for the same effects, size and shape", () => {
    const effects: NoiseEffect[] = [createNoiseEffect()];
    expect(noiseParamsKey(effects, 100, 50, RECT_SHAPE)).toBe(noiseParamsKey(effects, 100, 50, RECT_SHAPE));
  });

  it("changes when width changes", () => {
    const effects: NoiseEffect[] = [createNoiseEffect()];
    expect(noiseParamsKey(effects, 100, 50, RECT_SHAPE)).not.toBe(noiseParamsKey(effects, 200, 50, RECT_SHAPE));
  });

  it("changes when height changes", () => {
    const effects: NoiseEffect[] = [createNoiseEffect()];
    expect(noiseParamsKey(effects, 100, 50, RECT_SHAPE)).not.toBe(noiseParamsKey(effects, 100, 75, RECT_SHAPE));
  });

  it("changes when a noise param changes (color)", () => {
    const a: NoiseEffect[] = [createNoiseEffect({ color: "#00000080" })];
    const b: NoiseEffect[] = [createNoiseEffect({ color: "#ffffff80" })];
    expect(noiseParamsKey(a, 100, 50, RECT_SHAPE)).not.toBe(noiseParamsKey(b, 100, 50, RECT_SHAPE));
  });

  it("changes when a noise param changes (density)", () => {
    const a: NoiseEffect[] = [createNoiseEffect({ density: 0.2 })];
    const b: NoiseEffect[] = [createNoiseEffect({ density: 0.8 })];
    expect(noiseParamsKey(a, 100, 50, RECT_SHAPE)).not.toBe(noiseParamsKey(b, 100, 50, RECT_SHAPE));
  });

  it("changes when the number of effects changes", () => {
    const one: NoiseEffect[] = [createNoiseEffect()];
    const two: NoiseEffect[] = [createNoiseEffect(), createNoiseEffect({ noiseSize: 3 })];
    expect(noiseParamsKey(one, 100, 50, RECT_SHAPE)).not.toBe(noiseParamsKey(two, 100, 50, RECT_SHAPE));
  });

  it("is stable regardless of the ids assigned by createNoiseEffect (ignores id)", () => {
    const a: NoiseEffect[] = [createNoiseEffect({ color: "#00000080", noiseSize: 2, density: 0.5 })];
    const b: NoiseEffect[] = [createNoiseEffect({ color: "#00000080", noiseSize: 2, density: 0.5 })];
    expect(noiseParamsKey(a, 100, 50, RECT_SHAPE)).toBe(noiseParamsKey(b, 100, 50, RECT_SHAPE));
  });

  it("changes when cornerRadius changes", () => {
    const effects: NoiseEffect[] = [createNoiseEffect()];
    const a: NoiseMaskShape = { ellipse: false, cornerRadius: 0 };
    const b: NoiseMaskShape = { ellipse: false, cornerRadius: 8 };
    expect(noiseParamsKey(effects, 100, 50, a)).not.toBe(noiseParamsKey(effects, 100, 50, b));
  });

  it("is stable when shape is unchanged", () => {
    const effects: NoiseEffect[] = [createNoiseEffect()];
    const a: NoiseMaskShape = { ellipse: false, cornerRadius: 8, cornerSmoothing: 0.5 };
    const b: NoiseMaskShape = { ellipse: false, cornerRadius: 8, cornerSmoothing: 0.5 };
    expect(noiseParamsKey(effects, 100, 50, a)).toBe(noiseParamsKey(effects, 100, 50, b));
  });

  it("is stable for a sub-cell size change that doesn't cross a cell boundary (quantized key)", () => {
    // noiseSize 10 → at width 100 that's exactly 10 cells; nudging width by
    // less than one cell (99 vs 100, both ceil to 10 cells) keeps the key equal.
    const effects: NoiseEffect[] = [createNoiseEffect({ noiseSize: 10 })];
    expect(noiseParamsKey(effects, 100, 50, RECT_SHAPE)).toBe(noiseParamsKey(effects, 99, 50, RECT_SHAPE));
  });

  it("changes when a size change crosses a cell boundary", () => {
    const effects: NoiseEffect[] = [createNoiseEffect({ noiseSize: 10 })];
    expect(noiseParamsKey(effects, 100, 50, RECT_SHAPE)).not.toBe(noiseParamsKey(effects, 101, 50, RECT_SHAPE));
  });
});
