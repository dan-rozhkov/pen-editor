import { Container, Graphics, BlurFilter } from "pixi.js";
import type { Effect, ShadowEffect, PerCornerRadius } from "@/types/scene";
import { parseHexAlpha } from "@/utils/shadowUtils";
import { parseColor } from "./colorHelpers";
import { hasPerCornerRadius, drawPerCornerRoundRect } from "./fillStrokeHelpers";

export type ShadowShape = "rect" | "ellipse";

/**
 * Render an effect stack (currently shadows) on a node.
 *
 * All visible shadows are rendered, ordered bottom-to-top like `fills`.
 * Outer (drop) shadows are drawn behind the node's own content: the first
 * effect is drawn first (furthest back) and later effects are inserted above
 * it but still behind the node content. Inner shadows are drawn above the
 * node's own content (they need to occlude the fill to read as "cast inward")
 * and are clipped to the node's own shape with a mask, so they never bleed
 * past its bounds; children added after this call (e.g. a frame's own
 * children container, already present by the time this runs) still land
 * above the inner-shadow layer since it is appended last.
 */
export function applyShadows(
  container: Container,
  effects: Effect[],
  width: number,
  height: number,
  cornerRadius?: number,
  shape: ShadowShape = "rect",
  cornerRadiusPerCorner?: PerCornerRadius,
): void {
  // Remove existing shadow layers
  for (let i = container.children.length - 1; i >= 0; i--) {
    const child = container.children[i];
    if (child.label === "shadow-layer" || child.label === "inner-shadow-layer") {
      container.removeChildAt(i);
      child.destroy({ children: true });
    }
  }

  const outerShadows = effects.filter(
    (e): e is ShadowEffect => e.type === "shadow" && e.shadowType !== "inner",
  );
  // Insert each shadow at index 0 in REVERSE order so the first effect ends up
  // furthest back (bottom-to-top stacking, all behind the node content).
  for (let i = outerShadows.length - 1; i >= 0; i--) {
    const layer = buildShadowLayer(outerShadows[i], width, height, cornerRadius, shape, cornerRadiusPerCorner);
    container.addChildAt(layer, 0);
  }

  const innerShadows = effects.filter(
    (e): e is ShadowEffect => e.type === "shadow" && e.shadowType === "inner",
  );
  // Appended in stack order (bottom-to-top), on top of existing content.
  for (const effect of innerShadows) {
    const layer = buildInnerShadowLayer(effect, width, height, cornerRadius, shape, cornerRadiusPerCorner);
    container.addChild(layer);
  }
}

function buildShadowLayer(
  effect: ShadowEffect,
  width: number,
  height: number,
  cornerRadius: number | undefined,
  shape: ShadowShape,
  cornerRadiusPerCorner: PerCornerRadius | undefined,
): Container {
  const { color: hexColor, opacity } = parseHexAlpha(effect.color);

  const shadowContainer = new Container();
  shadowContainer.label = "shadow-layer";
  shadowContainer.position.set(effect.offset.x, effect.offset.y);

  const shadowGfx = new Graphics();
  drawShadowShape(shadowGfx, shape, width, height, cornerRadius, cornerRadiusPerCorner);
  shadowGfx.fill({ color: parseColor(hexColor), alpha: opacity });
  shadowContainer.addChild(shadowGfx);

  if (effect.blur > 0) {
    shadowContainer.filters = [new BlurFilter({ strength: effect.blur / 2, quality: 3 })];
  }

  return shadowContainer;
}

/** Trace the node's own shape (rect/round-rect/per-corner/ellipse) into `gfx` at the given offset+size, without filling. */
function drawShadowShape(
  gfx: Graphics,
  shape: ShadowShape,
  width: number,
  height: number,
  cornerRadius: number | undefined,
  cornerRadiusPerCorner: PerCornerRadius | undefined,
  x = 0,
  y = 0,
): void {
  if (shape === "ellipse") {
    gfx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2);
  } else if (hasPerCornerRadius(cornerRadiusPerCorner)) {
    drawPerCornerRoundRect(gfx, x, y, width, height, cornerRadiusPerCorner!);
  } else {
    const radius = Math.max(0, Math.min(cornerRadius ?? 0, width / 2, height / 2));
    if (radius > 0) {
      gfx.roundRect(x, y, width, height, radius);
    } else {
      gfx.rect(x, y, width, height);
    }
  }
}

/**
 * Build a rendered inner shadow layer for one shadow effect.
 *
 * Inner shadow has no dedicated pixi-filters primitive (only outer/drop
 * shadow does), so it is composed by hand: a large rect the size of the node
 * plus a safety margin is filled with the shadow color, then a cutout of the
 * node's own shape — offset by the effect's x/y and deflated by its spread —
 * is subtracted from it (`GraphicsContext#cut`), leaving a "frame" shape that
 * is solid everywhere except a shape-sized hole positioned at the shadow
 * offset. Blurring that frame and clipping the whole thing to the node's own
 * (un-offset) shape via a mask produces a shadow that reads as cast inward
 * from the edges, matching CSS `box-shadow: inset`.
 */
function buildInnerShadowLayer(
  effect: ShadowEffect,
  width: number,
  height: number,
  cornerRadius: number | undefined,
  shape: ShadowShape,
  cornerRadiusPerCorner: PerCornerRadius | undefined,
): Container {
  const { color: hexColor, opacity } = parseHexAlpha(effect.color);

  const shadowContainer = new Container();
  shadowContainer.label = "inner-shadow-layer";

  // Margin large enough that the blurred edge of the cutout never clips at
  // the padded rect's own border.
  const padding =
    Math.max(effect.blur, Math.abs(effect.offset.x), Math.abs(effect.offset.y), 0) + 8;

  const gfx = new Graphics();
  gfx.rect(-padding, -padding, width + padding * 2, height + padding * 2);
  gfx.fill({ color: parseColor(hexColor), alpha: opacity });

  // The cutout: node shape shrunk by `spread` on each side (positive spread
  // grows the shadow inward, same convention as CSS inset spread) and offset
  // by the shadow's x/y.
  const holeWidth = Math.max(0, width - effect.spread * 2);
  const holeHeight = Math.max(0, height - effect.spread * 2);
  const holeX = effect.offset.x + effect.spread;
  const holeY = effect.offset.y + effect.spread;
  drawShadowShape(gfx, shape, holeWidth, holeHeight, cornerRadius, cornerRadiusPerCorner, holeX, holeY);
  gfx.cut();
  shadowContainer.addChild(gfx);

  if (effect.blur > 0) {
    shadowContainer.filters = [new BlurFilter({ strength: effect.blur / 2, quality: 3 })];
  }

  // Clip to the node's own shape so the shadow never bleeds past its bounds.
  const maskGfx = new Graphics();
  drawShadowShape(maskGfx, shape, width, height, cornerRadius, cornerRadiusPerCorner);
  maskGfx.fill(0xffffff);
  shadowContainer.addChild(maskGfx);
  shadowContainer.mask = maskGfx;

  return shadowContainer;
}
