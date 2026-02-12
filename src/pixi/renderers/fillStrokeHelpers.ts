import { Graphics, FillGradient } from "pixi.js";
import type { FlatSceneNode, GradientFill, PerSideStroke } from "@/types/scene";
import { hasPerSideStroke } from "@/components/nodes/renderUtils";
import { getResolvedFill, getResolvedStroke, parseColor, parseAlpha } from "./colorHelpers";

export function drawPerSideStroke(
  gfx: Graphics,
  width: number,
  height: number,
  strokeColor: string,
  perSide: PerSideStroke,
): void {
  const color = parseColor(strokeColor);
  const alpha = parseAlpha(strokeColor);
  const { top = 0, right = 0, bottom = 0, left = 0 } = perSide;

  // Top border
  if (top > 0) {
    gfx.moveTo(0, top / 2);
    gfx.lineTo(width, top / 2);
    gfx.stroke({ color, alpha, width: top });
  }

  // Right border
  if (right > 0) {
    gfx.moveTo(width - right / 2, 0);
    gfx.lineTo(width - right / 2, height);
    gfx.stroke({ color, alpha, width: right });
  }

  // Bottom border
  if (bottom > 0) {
    gfx.moveTo(width, height - bottom / 2);
    gfx.lineTo(0, height - bottom / 2);
    gfx.stroke({ color, alpha, width: bottom });
  }

  // Left border
  if (left > 0) {
    gfx.moveTo(left / 2, height);
    gfx.lineTo(left / 2, 0);
    gfx.stroke({ color, alpha, width: left });
  }
}

export function buildPixiGradient(
  gradient: GradientFill,
  width: number,
  height: number,
): FillGradient {
  const sorted = [...gradient.stops].sort((a, b) => a.position - b.position);

  if (gradient.type === "linear") {
    const x0 = gradient.startX * width;
    const y0 = gradient.startY * height;
    const x1 = gradient.endX * width;
    const y1 = gradient.endY * height;

    const g = new FillGradient({
      type: "linear",
      start: { x: x0, y: y0 },
      end: { x: x1, y: y1 },
      colorStops: sorted.map((s) => ({
        offset: s.position,
        color: s.color,
      })),
    });
    return g;
  }

  // Radial - approximate with linear for now (PixiJS v8 FillGradient has limited radial support)
  const g = new FillGradient({
    type: "linear",
    start: { x: gradient.startX * width, y: gradient.startY * height },
    end: { x: gradient.endX * width, y: gradient.endY * height },
    colorStops: sorted.map((s) => ({
      offset: s.position,
      color: s.color,
    })),
  });
  return g;
}

/** Fill the current path using node solid/gradient fill settings. */
export function applyFill(gfx: Graphics, node: FlatSceneNode, width: number, height: number): void {
  if (node.gradientFill) {
    const gradient = buildPixiGradient(node.gradientFill, width, height);
    gfx.fill(gradient);
  } else {
    const fillColor = getResolvedFill(node);
    if (fillColor) {
      gfx.fill({ color: parseColor(fillColor), alpha: parseAlpha(fillColor) });
    }
  }
}

/** Apply stroke (per-side or unified) after shape is drawn. */
export function applyStroke(
  gfx: Graphics,
  node: FlatSceneNode,
  width: number,
  height: number,
  cornerRadius?: number,
): void {
  const strokeColor = getResolvedStroke(node);
  if (!strokeColor) return;

  const perSide = (node as any).strokeWidthPerSide as PerSideStroke | undefined;
  if (hasPerSideStroke(perSide) && perSide) {
    if (!cornerRadius) {
      drawPerSideStroke(gfx, width, height, strokeColor, perSide);
    } else {
      const maxWidth = Math.max(
        perSide.top ?? 0,
        perSide.right ?? 0,
        perSide.bottom ?? 0,
        perSide.left ?? 0,
      );
      if (maxWidth > 0) {
        gfx.stroke({
          color: parseColor(strokeColor),
          alpha: parseAlpha(strokeColor),
          width: maxWidth,
        });
      }
    }
  } else if (node.strokeWidth) {
    gfx.stroke({
      color: parseColor(strokeColor),
      alpha: parseAlpha(strokeColor),
      width: node.strokeWidth,
    });
  }
}
