import { Container, Graphics, BlurFilter } from "pixi.js";
import type { Effect, ShadowEffect, PerCornerRadius } from "@/types/scene";
import { parseHexAlpha } from "@/utils/shadowUtils";
import { parseColor } from "./colorHelpers";
import { hasPerCornerRadius, drawPerCornerRoundRect } from "./fillStrokeHelpers";

export type ShadowShape = "rect" | "ellipse";

/**
 * Render an effect stack (currently shadows) behind a node.
 *
 * All visible shadows are rendered, ordered bottom-to-top like `fills`: the
 * first effect is drawn first (furthest back) and later effects are inserted
 * above it but still behind the node's own content. Inner shadows are not yet
 * supported and are skipped (matches the legacy single-shadow behaviour).
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
    if (child.label === "shadow-layer") {
      container.removeChildAt(i);
      child.destroy({ children: true });
    }
  }

  const shadows = effects.filter(
    (e): e is ShadowEffect => e.type === "shadow" && e.shadowType !== "inner",
  );
  if (shadows.length === 0) return;

  // Insert each shadow at index 0 in REVERSE order so the first effect ends up
  // furthest back (bottom-to-top stacking, all behind the node content).
  for (let i = shadows.length - 1; i >= 0; i--) {
    const layer = buildShadowLayer(shadows[i], width, height, cornerRadius, shape, cornerRadiusPerCorner);
    container.addChildAt(layer, 0);
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
  if (shape === "ellipse") {
    shadowGfx.ellipse(width / 2, height / 2, width / 2, height / 2);
  } else if (hasPerCornerRadius(cornerRadiusPerCorner)) {
    drawPerCornerRoundRect(shadowGfx, 0, 0, width, height, cornerRadiusPerCorner!);
  } else {
    const radius = Math.max(0, Math.min(cornerRadius ?? 0, width / 2, height / 2));
    if (radius > 0) {
      shadowGfx.roundRect(0, 0, width, height, radius);
    } else {
      shadowGfx.rect(0, 0, width, height);
    }
  }
  shadowGfx.fill({ color: parseColor(hexColor), alpha: opacity });
  shadowContainer.addChild(shadowGfx);

  if (effect.blur > 0) {
    shadowContainer.filters = [new BlurFilter({ strength: effect.blur / 2, quality: 3 })];
  }

  return shadowContainer;
}
