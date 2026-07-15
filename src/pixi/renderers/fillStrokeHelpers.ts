import { Container, Graphics, FillGradient } from "pixi.js";
import type { BLEND_MODES } from "pixi.js";
import type {
  FlatSceneNode,
  GradientFill,
  Paint,
  PaintBlendMode,
  PerSideStroke,
  PerCornerRadius,
  SolidPaint,
} from "@/types/scene";
import { hasPerSideStroke, hasPerCornerRadius } from "@/utils/renderUtils";
import { buildSquircleRectPath } from "@/lib/shapePath/squircleCorner";
import {
  getResolvedSolidPaint,
  getResolvedRenderableFills,
  getResolvedRenderableStrokes,
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

/**
 * Build a Pixi `FillGradient` from our normalized `GradientFill`.
 *
 * `forStroke` fixes a Pixi v8 divergence from Figma: `generateTextureFillMatrix`
 * pads a *stroked* shape's bounds by the stroke width before mapping the
 * gradient's normalized 0..1 space onto them (`scene/graphics/shared/utils/
 * generateTextureFillMatrix.mjs` — `if (style.width) bounds.pad(style.width)`),
 * so a `FillGradient` built with `textureSpace: "local"` reads ~`strokeWidth`
 * px "inward" of where Figma places it (measured: 130/260/390 vs Figma's
 * 160/260/360 on a 400x200 node with a 60px stroke — see task spec p1-22).
 * Figma instead maps the gradient onto the node's own bbox regardless of
 * stroke width, with no expansion and hard clamping past 0..1.
 *
 * The fix (verified by pixel measurement on the linear case, see spec):
 * `textureSpace: "global"` skips that bounds-based normalization entirely —
 * `FillGradient`'s own `buildLinearGradient`/`buildRadialGradient` then treat
 * `start`/`end`/`center`/radii as literal local-space (px) coordinates rather
 * than a 0..1 fraction of the (padded) shape bounds. So for `forStroke` we
 * pre-multiply our normalized bbox-relative coordinates by the node's own
 * width/height to get the same px position Figma would read off the bbox.
 *
 * Verified from source (no headless-GPU pixel test available in this repo)
 * that this is safe under a node transform (position/rotation/scale) and
 * viewport zoom: Graphics geometry — and therefore this gradient — is always
 * built in the Graphics object's own LOCAL, untransformed coordinate space
 * (`gfx.rect(0, 0, width, height)` etc.); the container's world transform is
 * applied by Pixi's scene graph as an entirely separate step downstream, the
 * same way it already is for the existing "local" fill-gradient path.
 *
 * Radial gradients need one more correction on top of the px-space fix: a
 * scalar `radius * width` (matching the x-axis basis used for `center`/
 * `outerCenter`) draws a true circle, not Figma's bbox-aspect-stretched
 * ellipse, on a non-square node — the fill path gets this for free because
 * `generateTextureFillMatrix`'s `"local"` branch (`scene/graphics/shared/
 * utils/generateTextureFillMatrix.mjs`) scales x by `1/bounds.width` and y by
 * `1/bounds.height` *independently*, which is exactly what stretches a
 * circular gradient into a bbox-aspect ellipse for fills — but `"global"`
 * mode (required for the px-space fix above) scales by the gradient's own
 * (square, `textureSize`) texture dimensions instead, so no such stretch
 * happens automatically. `FillGradient.buildRadialGradient` (`scene/graphics/
 * shared/fill/FillGradient.mjs`) exposes exactly this as its own `scale`
 * option: before rasterizing the gradient to its backing canvas texture it
 * does `context.translate(cx, cy); context.rotate(this.rotation);
 * context.scale(1, this.scale); context.translate(-cx, -cy)` — i.e. `scale`
 * stretches the *baked-in* circle along the texture's local y-axis before the
 * (uniform) `transform` matrix maps the texture back onto world space, so the
 * resulting world-space y-radius is `outerRadius * this.scale` while the
 * x-radius is unaffected. Since `outerRadius` here is already `radius *
 * width` (the x-axis basis), setting `scale: height / width` makes the
 * world-space y-radius come out to `radius * width * (height / width) =
 * radius * height` — the y-axis basis, matching `center`/`outerCenter`'s own
 * `startY * height`/`endY * height` and reproducing the fill path's bbox-
 * aspect ellipse. (`center`/`outerCenter` positions are unaffected by `scale`
 * — `buildRadialGradient`'s internal `ox`/`oy` canvas-anchor terms use the
 * same radius basis on both subtraction and re-addition, so the world-space
 * center always comes out to exactly the `center`/`outerCenter` values
 * passed in, regardless of aspect.) This is a from-source derivation, not an
 * independent pixel measurement (no headless-GPU harness available here) —
 * flag for a follow-up visual check against a real Figma radial stroke
 * gradient on a non-square node.
 */
export function buildPixiGradient(
  gradient: GradientFill,
  width: number,
  height: number,
  options?: { forStroke?: boolean },
): FillGradient {
  const sorted = [...gradient.stops].sort((a, b) => a.position - b.position);
  const colorStops = sorted.map((s) => ({
    offset: s.position,
    color: applyStopOpacity(s.color, s.opacity),
  }));
  const forStroke = options?.forStroke ?? false;
  const textureSpace = forStroke ? "global" : "local";

  if (gradient.type === "linear") {
    return new FillGradient({
      type: "linear",
      start: forStroke
        ? { x: gradient.startX * width, y: gradient.startY * height }
        : { x: gradient.startX, y: gradient.startY },
      end: forStroke
        ? { x: gradient.endX * width, y: gradient.endY * height }
        : { x: gradient.endX, y: gradient.endY },
      textureSpace,
      colorStops,
    });
  }

  // Radial gradient. Radii are normalized against `width` (matching the
  // x-axis basis used for `center`/`outerCenter`); for `forStroke` the
  // `scale: height / width` below stretches that x-basis radius into the
  // node's bbox-aspect ellipse (see the doc comment above for the from-source
  // derivation of why this exactly reproduces `radius * height` on the
  // y-axis, matching the fill path's own bbox-aspect stretch).
  const aspectScale = forStroke && width !== 0 ? height / width : 1;
  return new FillGradient({
    type: "radial",
    center: forStroke
      ? { x: gradient.startX * width, y: gradient.startY * height }
      : { x: gradient.startX, y: gradient.startY },
    innerRadius: forStroke ? (gradient.startRadius ?? 0) * width : (gradient.startRadius ?? 0),
    outerCenter: forStroke
      ? { x: gradient.endX * width, y: gradient.endY * height }
      : { x: gradient.endX, y: gradient.endY },
    outerRadius: forStroke ? (gradient.endRadius ?? 0.5) * width : (gradient.endRadius ?? 0.5),
    scale: aspectScale,
    textureSpace,
    colorStops,
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
    node.fills !== prev.fills ||
    node.strokes !== prev.strokes
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

/**
 * A paint stack (fill or stroke) whose per-layer blend mode is non-'normal'
 * needs its own sibling `Graphics` so Pixi's compositor can apply that blend
 * mode in isolation — a single `Graphics` object only has one `blendMode`.
 * Both `applyFills` and `applyStroke` create these layers; they're
 * distinguished by label/flag so clearing one never touches the other's
 * layers (both run back-to-back on the same `gfx`/container per node render).
 */
type BlendLayerKind = "fill" | "stroke";

const BLEND_LAYER_LABEL: Record<BlendLayerKind, string> = {
  fill: "fill-blend-layer",
  stroke: "stroke-blend-layer",
};

/** Container carrying markers for previously created fill/stroke blend layers. */
type ContainerWithBlendFlags = Container & {
  _hasBlendFillLayers?: boolean;
  _hasBlendStrokeLayers?: boolean;
};

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
  const container = baseGfx.parent as ContainerWithBlendFlags | null;

  const fills = getResolvedRenderableFills(node);
  const needsBlend = fills.some(
    (p) => p.type !== "image" && p.type !== "pattern" && p.type !== "video" && paintNeedsOwnLayer(p.blendMode),
  );

  // Rebuild blend layers from scratch — but only scan the children (O(n) for
  // frames) when blend layers exist or are about to. The typical no-blend case
  // skips both the scan and the `getChildIndex` lookup entirely.
  if (container && (container._hasBlendFillLayers || needsBlend)) {
    clearBlendLayers(container, "fill");
    container._hasBlendFillLayers = needsBlend;
  }

  // Insertion index for blend layers, advancing so later blend layers stack
  // above earlier ones (bottom-to-top order preserved).
  let blendInsertIndex =
    needsBlend && container ? container.getChildIndex(baseGfx) + 1 : 0;

  let pathOnBase = false;
  for (const paint of fills) {
    if (paint.type === "image" || paint.type === "pattern" || paint.type === "video") continue; // handled by sprite layer

    let target = baseGfx;
    if (paintNeedsOwnLayer(paint.blendMode) && container) {
      target = createBlendLayer(
        container,
        resolvePaintBlendMode(paint.blendMode),
        blendInsertIndex,
        "fill",
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

function createBlendLayer(
  container: Container,
  blendMode: BLEND_MODES,
  index: number,
  kind: BlendLayerKind,
): Graphics {
  const layer = new Graphics();
  layer.label = BLEND_LAYER_LABEL[kind];
  layer.blendMode = blendMode;
  container.addChildAt(layer, Math.min(index, container.children.length));
  return layer;
}

/** Remove all previously created blend layers of the given kind for this container. */
function clearBlendLayers(container: Container, kind: BlendLayerKind): void {
  const label = BLEND_LAYER_LABEL[kind];
  for (let i = container.children.length - 1; i >= 0; i--) {
    const child = container.children[i];
    if (child.label === label) {
      container.removeChildAt(i);
      child.destroy();
    }
  }
}

/**
 * Insertion index for a new stroke blend layer: directly above `baseGfx` and
 * any existing fill-blend-layers (`applyFills` always runs immediately before
 * `applyStroke` on the same `gfx`/container, see the four renderer call
 * sites), so strokes composite above the fully-resolved fill — matching where
 * a plain `.stroke()` call already visually lands today (drawn onto `baseGfx`
 * after its fill) — and below any later-added content (image/video fill
 * sprites, child nodes), which is only appended to the container after
 * `drawShape`'s caller returns.
 */
function findStrokeBlendInsertIndex(container: Container, baseGfx: Graphics): number {
  let idx = container.getChildIndex(baseGfx) + 1;
  while (idx < container.children.length && container.children[idx].label === BLEND_LAYER_LABEL.fill) {
    idx++;
  }
  return idx;
}

/** Resolve a single stroke paint's solid color to a Pixi `stroke()` color+alpha pair. */
function strokePaintColor(paint: SolidPaint): string | undefined {
  return getResolvedSolidPaint(paint);
}

/** A stroke paint resolved to something drawable, built BEFORE any `drawShape`
 *  call so an unresolvable solid color never leaves a redrawn path unconsumed
 *  (see `applyStroke`'s doc comment). */
type DrawableStroke =
  | { kind: 'gradient'; paint: Extract<Paint, { type: 'gradient' }> }
  | { kind: 'solid'; paint: SolidPaint; color: string };

/**
 * Apply the stroke paint stack (per-side or unified) after the shape is drawn.
 *
 * Geometry (weight/align/per-side) is one setting per node (Figma parity —
 * see `BaseNode.strokes` doc comment); `strokes`/legacy stroke fields only
 * vary color/gradient/opacity/blendMode, composited bottom-to-top in that
 * SAME geometry (later paints drawn on top of earlier ones, not offset
 * outward — mirrors `applyFills`). A paint whose blend mode is non-'normal'
 * draws into its own sibling Graphics (mirroring `applyFills`'s blend-layer
 * mechanism), so the per-paint blend-mode control in `StrokeSection` actually
 * takes effect on the canvas.
 *
 * Pixi v8 consumes the current path on every `.stroke()` (like `.fill()`), so
 * each additional paint layer drawn onto `gfx` needs the shape path redrawn
 * via `drawShape` (a blend layer is a distinct Graphics and always needs its
 * own fresh `drawShape` call, since it never inherits `gfx`'s path). The
 * first layer targeting `gfx` may reuse an already-fresh path left by the
 * last fill (`pathReady`), skipping one redundant redraw — same optimization
 * `applyFills`'s caller-facing `pathReady` return enables today. Paints are
 * resolved to a `DrawableStroke` (color looked up, unresolvable solids
 * dropped) BEFORE this loop runs, so a paint that fails to resolve never
 * triggers a `drawShape` redraw that no `.stroke()` call consumes — that
 * would leave two superimposed shape paths on `gfx` for the next iteration to
 * stroke together.
 *
 * Per-side stroke + gradient has no single bbox to map four independent
 * segments onto consistently with Figma, so the UI (`StrokeSection`) blocks
 * switching to per-side mode when the stroke stack contains a gradient paint
 * and vice versa. That guard only covers hand-editing, though — Figma paste
 * (`applyStrokePaints` in `figmaToScene/base.ts`) can still produce the
 * combination when a node has both `borderStrokeWeightsIndependent` and a
 * gradient stroke. This function's per-side branch first tries the topmost
 * visible SOLID paint's color (unchanged, still ignores any gradient paints
 * mixed into an otherwise-solid stack); only when the stack has NO solid
 * paint at all (i.e. gradient-only) does it fall through to the uniform
 * branch below, which renders the full stack (including the gradient) mapped
 * to the node's own bbox at the node's uniform `strokeWidth` — ignoring the
 * per-side widths but preserving the gradient's actual appearance. Judged to
 * lose less than either flattening the gradient to a per-side solid color or
 * rendering nothing.
 */
export function applyStroke(
  gfx: Graphics,
  node: FlatSceneNode,
  width: number,
  height: number,
  drawShape: ShapeDrawer,
  pathReady = false,
): void {
  const container = gfx.parent as ContainerWithBlendFlags | null;
  // Ensures stale blend layers from a previous render never linger past an
  // early return below (e.g. the stroke was removed, or downgraded to a
  // combination this render doesn't need a blend layer for).
  const syncBlendLayers = (needsBlend: boolean): void => {
    if (container && (container._hasBlendStrokeLayers || needsBlend)) {
      clearBlendLayers(container, "stroke");
      container._hasBlendStrokeLayers = needsBlend;
    }
  };

  const strokes = getResolvedRenderableStrokes(node);
  if (strokes.length === 0) {
    syncBlendLayers(false);
    return;
  }

  const align = node.strokeAlign ?? 'center';
  const perSide = node.strokeWidthPerSide;

  if (hasPerSideStroke(perSide) && perSide) {
    const solid = [...strokes].reverse().find((p): p is SolidPaint => p.type === 'solid');
    const strokeColor = solid ? strokePaintColor(solid) : undefined;
    if (strokeColor) {
      drawPerSideStroke(gfx, width, height, strokeColor, perSide, align);
      syncBlendLayers(false);
      return;
    }
    // No solid paint to key the per-side render off of (gradient-only stack)
    // — fall through to the uniform branch below (see doc comment).
  }

  const strokeWidth = node.strokeWidth;
  if (!strokeWidth) {
    syncBlendLayers(false);
    return;
  }

  const alignment = align === 'inside' ? 1 : align === 'outside' ? 0 : 0.5;

  // Solid + gradient only — image/pattern/video stroke paints are out of
  // scope (task spec: "Video/shader-пейнты на обводке" explicitly excluded;
  // image/pattern strokes were never part of the DoD either). Both those and
  // an unresolvable solid color are dropped here, before any `drawShape`
  // call, so neither consumes a redraw without a matching `.stroke()`.
  const renderable: DrawableStroke[] = [];
  for (const paint of strokes) {
    if (paint.type === 'gradient') {
      renderable.push({ kind: 'gradient', paint });
    } else if (paint.type === 'solid') {
      const color = strokePaintColor(paint);
      if (color) renderable.push({ kind: 'solid', paint, color });
    }
  }

  if (renderable.length === 0) {
    syncBlendLayers(false);
    return;
  }

  const needsBlend = renderable.some((entry) => paintNeedsOwnLayer(entry.paint.blendMode));
  syncBlendLayers(needsBlend);

  let blendInsertIndex = needsBlend && container ? findStrokeBlendInsertIndex(container, gfx) : 0;
  let basePathReady = pathReady;

  for (const entry of renderable) {
    let target = gfx;
    if (paintNeedsOwnLayer(entry.paint.blendMode) && container) {
      target = createBlendLayer(container, resolvePaintBlendMode(entry.paint.blendMode), blendInsertIndex, "stroke");
      blendInsertIndex++;
      drawShape(target);
    } else {
      if (!basePathReady) drawShape(gfx);
      basePathReady = false;
    }

    if (entry.kind === 'gradient') {
      const gradient = buildPixiGradient(entry.paint.gradient, width, height, { forStroke: true });
      target.stroke({ fill: gradient, alpha: entry.paint.opacity ?? 1, width: strokeWidth, alignment });
    } else {
      target.stroke({
        color: parseColor(entry.color),
        alpha: parseAlpha(entry.color),
        width: strokeWidth,
        alignment,
      });
    }
  }
}
