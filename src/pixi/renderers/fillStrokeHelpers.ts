import { Container, Graphics, FillGradient } from "pixi.js";
import type { BLEND_MODES } from "pixi.js";
import type {
  FlatSceneNode,
  GradientFill,
  PaintBlendMode,
  PerSideStroke,
  PerCornerRadius,
  SolidPaint,
} from "@/types/scene";
import { hasPerSideStroke, hasPerCornerRadius } from "@/utils/renderUtils";
import { getRenderableFills } from "@/utils/fillUtils";
import { buildSquircleRectPath } from "@/lib/shapePath/squircleCorner";
import {
  getResolvedSolidPaint,
  getResolvedStroke,
  parseColor,
  parseAlpha,
} from "./colorHelpers";

export { hasPerCornerRadius } from "@/utils/renderUtils";

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

/**
 * Draw a squircle-cornered rounded rectangle (`cornerSmoothing > 0`) using the
 * shared path math from `@/lib/shapePath/squircleCorner`. Only called when
 * smoothing is strictly positive — the plain-arc `arcTo` path above is kept
 * untouched for `cornerSmoothing <= 0` so existing renders stay bit-identical.
 */
function drawSquircleRoundRect(
  gfx: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: PerCornerRadius,
  cornerSmoothing: number,
): void {
  const path = buildSquircleRectPath(
    w,
    h,
    {
      topLeft: radii.topLeft ?? 0,
      topRight: radii.topRight ?? 0,
      bottomRight: radii.bottomRight ?? 0,
      bottomLeft: radii.bottomLeft ?? 0,
    },
    cornerSmoothing,
  );

  gfx.moveTo(x + path.start.x, y + path.start.y);
  for (const seg of path.segments) {
    if (seg.type === "line") {
      gfx.lineTo(x + seg.x, y + seg.y);
    } else if (seg.type === "cubic") {
      gfx.bezierCurveTo(
        x + seg.cp1x,
        y + seg.cp1y,
        x + seg.cp2x,
        y + seg.cp2y,
        x + seg.x,
        y + seg.y,
      );
    } else {
      gfx.arc(x + seg.cx, y + seg.cy, seg.radius, seg.startAngle, seg.endAngle, seg.anticlockwise);
    }
  }
  gfx.closePath();
}

/** Draw a rounded rectangle with independent corner radii using arcTo */
export function drawPerCornerRoundRect(
  gfx: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  if (cornerSmoothing) {
    drawSquircleRoundRect(gfx, x, y, w, h, radii, cornerSmoothing);
    return;
  }

  const tl = Math.min(radii.topLeft ?? 0, w / 2, h / 2);
  const tr = Math.min(radii.topRight ?? 0, w / 2, h / 2);
  const br = Math.min(radii.bottomRight ?? 0, w / 2, h / 2);
  const bl = Math.min(radii.bottomLeft ?? 0, w / 2, h / 2);

  gfx.moveTo(x + tl, y);
  gfx.lineTo(x + w - tr, y);
  gfx.arcTo(x + w, y, x + w, y + tr, tr);
  gfx.lineTo(x + w, y + h - br);
  gfx.arcTo(x + w, y + h, x + w - br, y + h, br);
  gfx.lineTo(x + bl, y + h);
  gfx.arcTo(x, y + h, x, y + h - bl, bl);
  gfx.lineTo(x, y + tl);
  gfx.arcTo(x, y, x + tl, y, tl);
  gfx.closePath();
}

/** Draw a rounded rectangle shape (unified or per-corner) */
export function drawRoundedShape(
  gfx: Graphics,
  width: number,
  height: number,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  if (cornerSmoothing && (hasPerCornerRadius(cornerRadiusPerCorner) || cornerRadius)) {
    const radii: PerCornerRadius = hasPerCornerRadius(cornerRadiusPerCorner)
      ? cornerRadiusPerCorner!
      : {
          topLeft: cornerRadius,
          topRight: cornerRadius,
          bottomRight: cornerRadius,
          bottomLeft: cornerRadius,
        };
    drawSquircleRoundRect(gfx, 0, 0, width, height, radii, cornerSmoothing);
    return;
  }

  if (hasPerCornerRadius(cornerRadiusPerCorner)) {
    drawPerCornerRoundRect(gfx, 0, 0, width, height, cornerRadiusPerCorner!);
  } else if (
    cornerRadius !== undefined &&
    width === height &&
    cornerRadius >= width / 2
  ) {
    gfx.circle(width / 2, height / 2, width / 2);
  } else if (cornerRadius) {
    gfx.roundRect(0, 0, width, height, cornerRadius);
  } else {
    gfx.rect(0, 0, width, height);
  }
}

/**
 * Check if any visual properties affecting the vector shape (fill, stroke,
 * size, cornerRadius) changed.
 *
 * Deliberately EXCLUDES `effect`/`effects` (shadows are rebuilt by their own
 * branch in `renderers/index.ts` → `applyShadows`) and `imageFill` (image
 * sprites are rebuilt by the renderers' image-fill branch, see
 * `hasFillSourceChanged`) so e.g. dragging a shadow-blur slider doesn't
 * re-tessellate the vector shape on every tick.
 */
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
    (node as { cornerRadiusPerCorner?: PerCornerRadius }).cornerRadiusPerCorner !==
      (prev as { cornerRadiusPerCorner?: PerCornerRadius }).cornerRadiusPerCorner ||
    (node as { cornerSmoothing?: number }).cornerSmoothing !==
      (prev as { cornerSmoothing?: number }).cornerSmoothing ||
    node.gradientFill !== prev.gradientFill ||
    node.fills !== prev.fills
  );
}

/**
 * Check if the node's fill *source* changed, i.e. anything that can alter the
 * derived paint stack (`getFills`): the explicit `fills` array or any legacy
 * single-fill field. Used by the renderers' image-fill update branches.
 * `fillBinding`/`fillOpacity` are intentionally omitted: they only affect the
 * legacy *solid* paint, never the image paint derived from `imageFill`.
 */
export function hasFillSourceChanged(
  node: FlatSceneNode,
  prev: FlatSceneNode,
): boolean {
  return (
    node.fills !== prev.fills ||
    node.fill !== prev.fill ||
    node.gradientFill !== prev.gradientFill ||
    node.imageFill !== prev.imageFill
  );
}

/**
 * Pixi 8 natively supports only this subset of blend modes for a `Container`
 * without registering the advanced blend-mode pipeline (we intentionally do not
 * import `pixi.js/advanced-blend-modes`). Any other mode renders as 'normal'.
 */
const NATIVE_BLEND_MODES: ReadonlySet<PaintBlendMode> = new Set([
  "normal",
  "multiply",
  "screen",
  "darken",
  "lighten",
]);

/** Map a paint blend mode to a Pixi blend mode, falling back to 'normal'. */
export function resolvePaintBlendMode(mode: PaintBlendMode | undefined): BLEND_MODES {
  if (mode && NATIVE_BLEND_MODES.has(mode)) return mode as BLEND_MODES;
  return "normal";
}

/** True when a paint requires its own blended layer (non-default blend mode). */
function paintNeedsOwnLayer(mode: PaintBlendMode | undefined): boolean {
  return resolvePaintBlendMode(mode) !== "normal";
}

/** Fill the current path with a resolved solid paint, honoring per-layer alpha. */
export function fillSolidPaint(gfx: Graphics, paint: SolidPaint): void {
  const color = getResolvedSolidPaint(paint);
  if (!color) return;
  // `getResolvedSolidPaint` already folds the paint opacity into the color
  // (rgba / 8-digit hex); `parseAlpha` extracts it back for Pixi.
  gfx.fill({ color: parseColor(color), alpha: parseAlpha(color) });
}

/**
 * Draws the node's shape geometry onto the given Graphics WITHOUT filling.
 * `applyFills` invokes this once per paint layer because Pixi v8 consumes the
 * current path on every `.fill()`, so each layer needs its path rebuilt — and
 * blend layers (separate Graphics objects) need the path drawn onto themselves.
 */
export type ShapeDrawer = (target: Graphics) => void;

const BLEND_FILL_LAYER_LABEL = "fill-blend-layer";

/** Container carrying a marker for previously created blend fill layers. */
type ContainerWithBlendFlag = Container & { _hasBlendFillLayers?: boolean };

/**
 * Render the node's paint stack (bottom-to-top) onto `container`.
 *
 * Solid and gradient layers normally draw into the primary background Graphics
 * (`baseGfx`), each re-running `drawShape` because Pixi v8 consumes the current
 * path on every `.fill()`. A paint whose blend mode is non-'normal' instead
 * draws into its own sibling Graphics with `blendMode` set, inserted directly
 * above the background so later normal layers still stack correctly.
 *
 * Image paints are NOT handled here — they are sprites placed by
 * `applyImageFills` (see imageFillHelpers). Image sprites render above the
 * Graphics-based fills while preserving their mutual order and per-layer alpha.
 *
 * @returns true when the last vector fill drew into `baseGfx`, leaving its path
 * reusable by an immediately following `.stroke()` (see `applyStroke`); false
 * when no vector fill ran or the last one landed on a separate blend layer.
 */
export function applyFills(
  baseGfx: Graphics,
  node: FlatSceneNode,
  width: number,
  height: number,
  drawShape: ShapeDrawer,
): boolean {
  const container = baseGfx.parent as ContainerWithBlendFlag | null;

  const fills = getRenderableFills(node);
  const needsBlend = fills.some(
    (p) => p.type !== "image" && paintNeedsOwnLayer(p.blendMode),
  );

  // Rebuild blend layers from scratch — but only scan the children (O(n) for
  // frames) when blend layers exist or are about to. The typical no-blend case
  // skips both the scan and the `getChildIndex` lookup entirely.
  if (container && (container._hasBlendFillLayers || needsBlend)) {
    clearBlendFillLayers(container);
    container._hasBlendFillLayers = needsBlend;
  }

  // Insertion index for blend layers, advancing so later blend layers stack
  // above earlier ones (bottom-to-top order preserved).
  let blendInsertIndex =
    needsBlend && container ? container.getChildIndex(baseGfx) + 1 : 0;

  let pathOnBase = false;
  for (const paint of fills) {
    if (paint.type === "image") continue; // handled by image sprite layer

    let target = baseGfx;
    if (paintNeedsOwnLayer(paint.blendMode) && container) {
      target = createBlendFillLayer(
        container,
        resolvePaintBlendMode(paint.blendMode),
        blendInsertIndex,
      );
      blendInsertIndex++;
    }

    drawShape(target);

    if (paint.type === "gradient") {
      const gradient = buildPixiGradient(paint.gradient, width, height);
      target.fill({ fill: gradient, alpha: paint.opacity ?? 1 });
    } else {
      fillSolidPaint(target, paint);
    }

    pathOnBase = target === baseGfx;
  }

  return pathOnBase;
}

function createBlendFillLayer(
  container: Container,
  blendMode: BLEND_MODES,
  index: number,
): Graphics {
  const layer = new Graphics();
  layer.label = BLEND_FILL_LAYER_LABEL;
  layer.blendMode = blendMode;
  container.addChildAt(layer, Math.min(index, container.children.length));
  return layer;
}

/** Remove all blend fill layers previously created for this container. */
function clearBlendFillLayers(container: Container): void {
  for (let i = container.children.length - 1; i >= 0; i--) {
    const child = container.children[i];
    if (child.label === BLEND_FILL_LAYER_LABEL) {
      container.removeChildAt(i);
      child.destroy();
    }
  }
}

/**
 * Apply stroke (per-side or unified) after shape is drawn.
 *
 * The unified branch strokes the current path. In Pixi v8 a `.stroke()` issued
 * immediately after a `.fill()` reuses the fill's path, so this works when a
 * fill was the last thing drawn on `gfx`. When `drawShape` is provided it is
 * re-run first so the stroke has a fresh path even if the last fill landed on a
 * separate blend layer (or there were no fills at all).
 */
export function applyStroke(
  gfx: Graphics,
  node: FlatSceneNode,
  width: number,
  height: number,
  drawShape?: ShapeDrawer,
): void {
  const strokeColor = getResolvedStroke(node);
  if (!strokeColor) return;

  const align = node.strokeAlign ?? 'center';

  const perSide = node.strokeWidthPerSide;
  if (hasPerSideStroke(perSide) && perSide) {
    drawPerSideStroke(gfx, width, height, strokeColor, perSide, align);
  } else if (node.strokeWidth) {
    if (drawShape) drawShape(gfx);
    const alignment = align === 'inside' ? 1 : align === 'outside' ? 0 : 0.5;
    gfx.stroke({
      color: parseColor(strokeColor),
      alpha: parseAlpha(strokeColor),
      width: node.strokeWidth,
      alignment,
    });
  }
}
