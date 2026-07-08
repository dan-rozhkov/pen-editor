import type { ImageAdjustments } from "@/types/scene";

/** Slider range shared by every adjustment (Figma-style -100..100, 0 = no-op). */
export const ADJUSTMENT_MIN = -100;
export const ADJUSTMENT_MAX = 100;

/** All-zero adjustments: visually a no-op, equivalent to `adjustments` being absent. */
export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
};

/** Clamp a single slider value into `[-100, 100]`; non-finite input becomes `0`. */
export function clampAdjustmentValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(ADJUSTMENT_MAX, Math.max(ADJUSTMENT_MIN, value));
}

/**
 * Normalize a (possibly partial/undefined) adjustments object: missing
 * fields fall back to the default (no-op), and every present field is
 * clamped to the valid range. Always returns a fully-populated object so
 * callers never have to null-check individual fields.
 */
export function clampAdjustments(
  adjustments: Partial<ImageAdjustments> | undefined,
): ImageAdjustments {
  return {
    brightness: clampAdjustmentValue(adjustments?.brightness ?? DEFAULT_ADJUSTMENTS.brightness),
    contrast: clampAdjustmentValue(adjustments?.contrast ?? DEFAULT_ADJUSTMENTS.contrast),
    saturation: clampAdjustmentValue(adjustments?.saturation ?? DEFAULT_ADJUSTMENTS.saturation),
    temperature: clampAdjustmentValue(adjustments?.temperature ?? DEFAULT_ADJUSTMENTS.temperature),
    tint: clampAdjustmentValue(adjustments?.tint ?? DEFAULT_ADJUSTMENTS.tint),
  };
}

/** True when `adjustments` is absent or every field is `0` (no visual effect). */
export function isDefaultAdjustments(adjustments: ImageAdjustments | undefined): boolean {
  if (!adjustments) return true;
  return (
    adjustments.brightness === 0 &&
    adjustments.contrast === 0 &&
    adjustments.saturation === 0 &&
    adjustments.temperature === 0 &&
    adjustments.tint === 0
  );
}

/**
 * A PixiJS `ColorMatrixFilter`-compatible matrix: 4 rows (R,G,B,A out) x 5
 * columns (R,G,B,A in, plus an additive offset), flattened row-major into a
 * 20-length array. See `ColorMatrixFilter.matrix` in pixi.js.
 */
export type ColorMatrix = number[];

const IDENTITY_MATRIX: ColorMatrix = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/**
 * Compose two 4x5 affine color matrices into one: applies `b` first, then
 * `a` (i.e. `result(x) = a(b(x))`). Both matrices leave alpha untouched
 * (row/col 3 stay identity for every matrix this module builds), so alpha is
 * not explicitly composed here — it always passes through as `[0,0,0,1,0]`.
 */
function composeColorMatrices(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const result: number[] = new Array(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[row * 5 + k] * b[k * 5 + col];
      }
      result[row * 5 + col] = sum;
    }
    let offset = a[row * 5 + 4];
    for (let k = 0; k < 4; k++) {
      offset += a[row * 5 + k] * b[k * 5 + 4];
    }
    result[row * 5 + 4] = offset;
  }
  return result;
}

/** Exposure-style additive brightness shift: `+100` pushes R/G/B toward white. */
function brightnessMatrix(brightness: number): ColorMatrix {
  const offset = brightness / 100;
  return [
    1, 0, 0, 0, offset,
    0, 1, 0, 0, offset,
    0, 0, 1, 0, offset,
    0, 0, 0, 1, 0,
  ];
}

/** Scale around mid-gray (0.5): `-100` flattens to a solid mid-gray, `+100` doubles contrast. */
function contrastMatrix(contrast: number): ColorMatrix {
  const factor = (100 + contrast) / 100;
  const offset = 0.5 * (1 - factor);
  return [
    factor, 0, 0, 0, offset,
    0, factor, 0, 0, offset,
    0, 0, factor, 0, offset,
    0, 0, 0, 1, 0,
  ];
}

// Rec. 601 luma weights (matches PixiJS's own ColorMatrixFilter#saturate).
const LUMA_R = 0.3086;
const LUMA_G = 0.6094;
const LUMA_B = 0.082;

/** Blend toward the luma-weighted grayscale of the pixel: `-100` = grayscale, `+100` doubles saturation. */
function saturationMatrix(saturation: number): ColorMatrix {
  const s = (100 + saturation) / 100;
  const sr = (1 - s) * LUMA_R;
  const sg = (1 - s) * LUMA_G;
  const sb = (1 - s) * LUMA_B;
  return [
    sr + s, sg, sb, 0, 0,
    sr, sg + s, sb, 0, 0,
    sr, sg, sb + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

// Max additive shift (in normalized 0-1 channel space) at the slider extremes.
const TEMPERATURE_SHIFT = 0.3;
const TINT_SHIFT = 0.3;

/**
 * Simple RGB-offset approximation of a white-balance move (not a physical
 * Kelvin model — matches Figma's slider *direction*, not its exact math):
 * positive temperature warms (more red, less blue); positive tint shifts
 * toward magenta (less green).
 */
function temperatureTintMatrix(temperature: number, tint: number): ColorMatrix {
  const t = (temperature / 100) * TEMPERATURE_SHIFT;
  const ti = (tint / 100) * TINT_SHIFT;
  return [
    1, 0, 0, 0, t,
    0, 1, 0, 0, -ti,
    0, 0, 1, 0, -t,
    0, 0, 0, 1, 0,
  ];
}

/**
 * Approximate `adjustments` as a CSS `filter` value for non-canvas previews
 * (e.g. the properties-panel fill thumbnail). `brightness()`/`contrast()`/
 * `saturate()` map cleanly onto the same factors used by
 * {@link buildAdjustmentColorMatrix}'s brightness/contrast/saturation
 * matrices; `temperature`/`tint` have no direct CSS filter equivalent and are
 * intentionally left out — a documented simplification (exact shader match
 * is not the goal, just a faithful-enough preview). Returns `undefined` for
 * default (no-op) adjustments so callers can omit the `filter` property.
 */
export function adjustmentsToCssFilter(adjustments: ImageAdjustments | undefined): string | undefined {
  if (isDefaultAdjustments(adjustments)) return undefined;
  const a = clampAdjustments(adjustments);
  const brightness = 1 + a.brightness / 100;
  const contrast = (100 + a.contrast) / 100;
  const saturate = (100 + a.saturation) / 100;
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`;
}

/**
 * Build a single 4x5 `ColorMatrixFilter`-compatible matrix from a full set
 * of adjustment sliders. Pure and WebGL-free so it's directly unit-testable;
 * the filter itself (`applyImageAdjustments` in
 * `pixi/renderers/imageFillHelpers.ts`) just assigns the returned array to
 * a `ColorMatrixFilter.matrix`.
 *
 * Composition order (innermost first): saturation -> contrast -> brightness
 * -> temperature/tint, so brightness/contrast operate on the desaturated
 * result and the white-balance shift is applied last.
 */
export function buildAdjustmentColorMatrix(adjustments: ImageAdjustments): ColorMatrix {
  if (isDefaultAdjustments(adjustments)) return IDENTITY_MATRIX;
  let matrix = saturationMatrix(adjustments.saturation);
  matrix = composeColorMatrices(contrastMatrix(adjustments.contrast), matrix);
  matrix = composeColorMatrices(brightnessMatrix(adjustments.brightness), matrix);
  matrix = composeColorMatrices(temperatureTintMatrix(adjustments.temperature, adjustments.tint), matrix);
  return matrix;
}
