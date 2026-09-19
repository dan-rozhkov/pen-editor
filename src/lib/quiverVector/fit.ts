/**
 * Shared uniform-fit math for `generate_vector`'s live preview and its final
 * commit.
 *
 * Both the raster preview (`pixi/aiSvgPreviewLayer.ts`) and the committed
 * scene nodes (`lib/tools/generateVector/index.ts`, via `scaleAndOffsetNode`)
 * place the same artwork into the same target box, and must agree on how:
 * uniformly scaled (never stretched to fill non-square boxes) and anchored
 * at the box's top-left corner. Before this helper existed the preview
 * stretched non-uniformly while the commit path fit uniformly, so a
 * non-square `width`/`height` request showed a visibly squashed drawing for
 * the whole ~30-90s generation that then snapped into an unstretched box the
 * instant real nodes committed — exactly the jump `fit` exists to prevent.
 * Factoring this into one function means the two paths cannot drift apart
 * again.
 */

export interface FitBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FitResult {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The uniform scale factor applied to the intrinsic size. */
  scale: number;
}

/**
 * Uniformly fit an `intrinsicWidth`x`intrinsicHeight` drawing into `bounds`,
 * anchored at `bounds`'s top-left corner. Falls back to `scale: 1` (no
 * resize) when the intrinsic size is degenerate (zero/negative), matching
 * `generateVector`'s pre-existing fallback for a malformed SVG viewBox.
 */
export function computeUniformFit(
  intrinsicWidth: number,
  intrinsicHeight: number,
  bounds: FitBounds,
): FitResult {
  const scale =
    intrinsicWidth > 0 && intrinsicHeight > 0
      ? Math.min(bounds.width / intrinsicWidth, bounds.height / intrinsicHeight)
      : 1;

  return {
    x: bounds.x,
    y: bounds.y,
    width: intrinsicWidth * scale,
    height: intrinsicHeight * scale,
    scale,
  };
}
