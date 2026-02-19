import { Graphics, FillGradient } from "pixi.js";
import type { FlatSceneNode, GradientFill, PerSideStroke } from "@/types/scene";
import { hasPerSideStroke } from "@/utils/renderUtils";
import { getResolvedFill, getResolvedStroke, parseColor, parseAlpha } from "./colorHelpers";

function perSideOffset(strokeWidth: number, align: 'center' | 'inside' | 'outside'): number {
  switch (align) {
    case 'inside': return strokeWidth / 2;
    case 'outside': return -strokeWidth / 2;
    default: return 0;
  }
}

export function drawPerSideStroke(
  gfx: Graphics,
  width: number,
  height: number,
  strokeColor: string,
  perSide: PerSideStroke,
  align: 'center' | 'inside' | 'outside' = 'center',
): void {
  const color = parseColor(strokeColor);
  const alpha = parseAlpha(strokeColor);
  const { top = 0, right = 0, bottom = 0, left = 0 } = perSide;

  const topOff = perSideOffset(top, align);
  const rightOff = perSideOffset(right, align);
  const bottomOff = perSideOffset(bottom, align);
  const leftOff = perSideOffset(left, align);

  // Top border
  if (top > 0) {
    gfx.moveTo(0, top / 2 + topOff);
    gfx.lineTo(width, top / 2 + topOff);
    gfx.stroke({ color, alpha, width: top });
  }

  // Right border
  if (right > 0) {
    gfx.moveTo(width - right / 2 - rightOff, 0);
    gfx.lineTo(width - right / 2 - rightOff, height);
    gfx.stroke({ color, alpha, width: right });
  }

  // Bottom border
  if (bottom > 0) {
    gfx.moveTo(width, height - bottom / 2 - bottomOff);
    gfx.lineTo(0, height - bottom / 2 - bottomOff);
    gfx.stroke({ color, alpha, width: bottom });
  }

  // Left border
  if (left > 0) {
    gfx.moveTo(left / 2 + leftOff, height);
    gfx.lineTo(left / 2 + leftOff, 0);
    gfx.stroke({ color, alpha, width: left });
  }
}

function applyStopOpacity(color: string, opacity?: number): string {
  if (opacity === undefined || opacity >= 1) return color;
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function buildPixiGradient(
  gradient: GradientFill,
  _width: number,
  _height: number,
): FillGradient {
  const sorted = [...gradient.stops].sort((a, b) => a.position - b.position);

  if (gradient.type === "linear") {
    return new FillGradient({
      type: "linear",
      start: { x: gradient.startX, y: gradient.startY },
      end: { x: gradient.endX, y: gradient.endY },
      textureSpace: "local",
      colorStops: sorted.map((s) => ({
        offset: s.position,
        color: applyStopOpacity(s.color, s.opacity),
      })),
    });
  }

  // Radial gradient
  return new FillGradient({
    type: "radial",
    center: { x: gradient.startX, y: gradient.startY },
    innerRadius: gradient.startRadius ?? 0,
    outerCenter: { x: gradient.endX, y: gradient.endY },
    outerRadius: gradient.endRadius ?? 0.5,
    textureSpace: "local",
    colorStops: sorted.map((s) => ({
      offset: s.position,
      color: applyStopOpacity(s.color, s.opacity),
    })),
  });
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

  const align = node.strokeAlign ?? 'center';

  const perSide = (node as any).strokeWidthPerSide as PerSideStroke | undefined;
  if (hasPerSideStroke(perSide) && perSide) {
    if (!cornerRadius) {
      drawPerSideStroke(gfx, width, height, strokeColor, perSide, align);
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
    const alignment = align === 'inside' ? 1 : align === 'outside' ? 0 : 0.5;
    gfx.stroke({
      color: parseColor(strokeColor),
      alpha: parseAlpha(strokeColor),
      width: node.strokeWidth,
      alignment,
    });
  }
}
