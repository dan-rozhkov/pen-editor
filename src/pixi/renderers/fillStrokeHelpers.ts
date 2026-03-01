import { Graphics, FillGradient } from "pixi.js";
import type { FlatSceneNode, GradientFill, PerSideStroke } from "@/types/scene";
import { hasPerSideStroke } from "@/utils/renderUtils";
import { getResolvedFill, getResolvedStroke, parseColor, parseAlpha } from "./colorHelpers";

function getSidePosition(
  side: 'top' | 'right' | 'bottom' | 'left',
  strokeWidth: number,
  width: number,
  height: number,
  align: 'center' | 'inside' | 'outside',
): number {
  const half = strokeWidth / 2;

  switch (side) {
    case 'top':
      if (align === 'inside') return half;
      if (align === 'outside') return -half;
      return 0;
    case 'right':
      if (align === 'inside') return width - half;
      if (align === 'outside') return width + half;
      return width;
    case 'bottom':
      if (align === 'inside') return height - half;
      if (align === 'outside') return height + half;
      return height;
    case 'left':
      if (align === 'inside') return half;
      if (align === 'outside') return -half;
      return 0;
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

  // Top border
  if (top > 0) {
    const y = getSidePosition('top', top, width, height, align);
    gfx.beginPath();
    gfx.moveTo(0, y);
    gfx.lineTo(width, y);
    gfx.stroke({ color, alpha, width: top });
  }

  // Right border
  if (right > 0) {
    const x = getSidePosition('right', right, width, height, align);
    gfx.beginPath();
    gfx.moveTo(x, 0);
    gfx.lineTo(x, height);
    gfx.stroke({ color, alpha, width: right });
  }

  // Bottom border
  if (bottom > 0) {
    const y = getSidePosition('bottom', bottom, width, height, align);
    gfx.beginPath();
    gfx.moveTo(width, y);
    gfx.lineTo(0, y);
    gfx.stroke({ color, alpha, width: bottom });
  }

  // Left border
  if (left > 0) {
    const x = getSidePosition('left', left, width, height, align);
    gfx.beginPath();
    gfx.moveTo(x, height);
    gfx.lineTo(x, 0);
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

/** Check if any shared visual properties (fill, stroke, size, cornerRadius) changed. */
export function hasVisualPropsChanged(
  node: FlatSceneNode,
  prev: FlatSceneNode,
): boolean {
  return (
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.fill !== prev.fill ||
    node.fillBinding !== prev.fillBinding ||
    node.fillOpacity !== prev.fillOpacity ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth ||
    node.strokeAlign !== prev.strokeAlign ||
    node.strokeWidthPerSide !== prev.strokeWidthPerSide ||
    (node as { cornerRadius?: number }).cornerRadius !==
      (prev as { cornerRadius?: number }).cornerRadius ||
    node.gradientFill !== prev.gradientFill
  );
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
): void {
  const strokeColor = getResolvedStroke(node);
  if (!strokeColor) return;

  const align = node.strokeAlign ?? 'center';

  const perSide = (node as any).strokeWidthPerSide as PerSideStroke | undefined;
  if (hasPerSideStroke(perSide) && perSide) {
    drawPerSideStroke(gfx, width, height, strokeColor, perSide, align);
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
