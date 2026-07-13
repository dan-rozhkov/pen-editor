/**
 * Pure scene-tree → IR builder for the PPTX exporter. No Pixi/DOM — all
 * store/render access is injected via `BuildDeps` so this stays unit-testable
 * with plain object fixtures (mirrors `assemblePdf.ts`'s pure/orchestrator
 * split, see `src/utils/exportPptxUtils.ts` for the real wiring).
 */
import type {
  SceneNode,
  FrameNode,
  GroupNode,
  RectNode,
  EllipseNode,
  TextNode,
  LineNode,
  RefNode,
  Paint,
  SolidPaint,
  GradientPaint,
  Effect,
  ShadowEffect,
  PerCornerRadius,
  ColorBinding,
} from "@/types/scene";

import { parseHexColor } from "./xml";
import type {
  PptxDocInput,
  ShapeInput,
  SlideShapes,
  PptxRect,
  FillInput,
  StrokeInput,
  ShadowInput,
  GradientStopInput,
  RectShapeInput,
  EllipseShapeInput,
  TextShapeInput,
  LineShapeInput,
  ParagraphInput,
  TextFontInput,
  LineCap,
} from "./types";

/** What to resolve a color/binding pair against (a solid paint, node.stroke, a shadow color, ...). */
export interface ColorLookup {
  color?: string;
  binding?: ColorBinding;
}

export interface BuildDeps {
  /** Auto-layout-resolved children of a frame (identity for non-auto-layout). Wire to layoutStore.calculateLayoutForFrame. */
  layoutChildren: (frame: FrameNode) => SceneNode[];
  /** Resolve a ref instance to its expanded tree, or null. Wire to instanceRuntime.resolveRefToTree. */
  resolveRef: (ref: RefNode) => SceneNode | null;
  /** Visible paint stack with legacy fallback + style/variable resolution. Wire to fillUtils.getFills + resolveFillStylePaint. */
  getNodeFills: (node: SceneNode) => Paint[];
  /** Visible effect stack. Wire to fillUtils.getEffects + resolveEffectStack. */
  getNodeEffects: (node: SceneNode) => Effect[];
  /** Resolve a possibly-variable-bound color to a literal hex string, e.g. via a variableId binding. */
  resolveColor: (lookup: ColorLookup, node: SceneNode) => string | undefined;
  /** Rasterize a node subtree at the given px size; null on failure (node is then skipped). */
  rasterizeNode: (nodeId: string, widthPx: number, heightPx: number, scale: number) => Uint8Array | null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Decides whether a node must be rasterized instead of mapped to an editable
 * shape. See the plan's "v1 fidelity decisions" for the exact trigger list.
 */
export function needsRaster(node: SceneNode, fills: Paint[], effects: Effect[]): boolean {
  if (node.type === "path" || node.type === "polygon" || node.type === "embed") return true;
  if (node.shader) return true;

  const visibleFills = fills.filter((p) => p.visible !== false);
  const visibleEffects = effects.filter((e) => e.visible !== false);

  if (visibleEffects.some((e) => e.type === "blur" || e.type === "background-blur")) return true;
  if (visibleFills.some((p) => p.type === "image" || p.type === "pattern" || p.type === "video")) return true;
  if (visibleFills.length > 1) return true;
  if (visibleFills.some((p) => p.blendMode && p.blendMode !== "normal")) return true;

  if (node.type === "ellipse") {
    const ellipse = node as EllipseNode;
    if (ellipse.sweepAngle !== undefined && Math.abs(ellipse.sweepAngle) !== 360) return true;
    if ((ellipse.innerRadiusRatio ?? 0) > 0) return true;
  }

  if (node.type === "frame" || node.type === "group") {
    if (node.rotation) return true;
    const children = (node as FrameNode | GroupNode).children ?? [];
    if (children.some((c) => c.isMask)) return true;
  }

  return false;
}

/** A `clip: true` frame whose (layout-resolved) children overflow its bounds must be rasterized whole. */
function frameChildrenOverflow(frame: FrameNode, children: SceneNode[]): boolean {
  return children.some((c) => {
    const right = c.x + c.width;
    const bottom = c.y + c.height;
    return c.x < 0 || c.y < 0 || right > frame.width || bottom > frame.height;
  });
}

interface WalkCtx {
  deps: BuildDeps;
  shapes: ShapeInput[];
  fitScale: number;
  offsetX: number;
  offsetY: number;
}

function toSlideRect(absX: number, absY: number, width: number, height: number, ctx: WalkCtx): PptxRect {
  return {
    x: absX * ctx.fitScale + ctx.offsetX,
    y: absY * ctx.fitScale + ctx.offsetY,
    width: width * ctx.fitScale,
    height: height * ctx.fitScale,
  };
}

function resolvedColorOf(lookup: ColorLookup, node: SceneNode, ctx: WalkCtx): string | undefined {
  return ctx.deps.resolveColor(lookup, node) ?? lookup.color;
}

function topVectorFill(fills: Paint[], node: SceneNode, ctx: WalkCtx): FillInput | undefined {
  const paint = fills.find((p) => p.visible !== false);
  if (!paint) return undefined;
  const nodeOpacity = node.opacity ?? 1;
  const nodeFillOpacity = (node as { fillOpacity?: number }).fillOpacity ?? 1;

  if (paint.type === "solid") {
    const solid = paint as SolidPaint;
    const rawColor = resolvedColorOf({ color: solid.color, binding: solid.colorBinding }, node, ctx);
    const { rgb, alpha: hexAlpha } = parseHexColor(rawColor ?? "#000000");
    const alpha = clamp01(hexAlpha * (solid.opacity ?? 1) * nodeOpacity * nodeFillOpacity);
    return { kind: "solid", rgb, alpha };
  }

  if (paint.type === "gradient") {
    const gradient = (paint as GradientPaint).gradient;
    const stops: GradientStopInput[] = [...gradient.stops]
      .sort((a, b) => a.position - b.position)
      .map((stop) => {
        const { rgb, alpha: hexAlpha } = parseHexColor(stop.color);
        const alpha = clamp01(hexAlpha * (stop.opacity ?? 1) * (paint.opacity ?? 1) * nodeOpacity);
        return { rgb, alpha, position: stop.position };
      });
    const angleDeg =
      gradient.type === "linear"
        ? (Math.atan2(gradient.endY - gradient.startY, gradient.endX - gradient.startX) * 180) / Math.PI
        : 0;
    return { kind: "gradient", gradientType: gradient.type, stops, angleDeg };
  }

  // image/pattern/video paints are always routed to raster fallback by needsRaster().
  return undefined;
}

function strokeOf(node: SceneNode, ctx: WalkCtx): StrokeInput | undefined {
  const perSide = node.strokeWidthPerSide;
  const widthPx = perSide
    ? Math.max(perSide.top ?? 0, perSide.right ?? 0, perSide.bottom ?? 0, perSide.left ?? 0)
    : (node.strokeWidth ?? 0);
  if (widthPx <= 0 || !node.stroke) return undefined;

  const rawColor = resolvedColorOf({ color: node.stroke, binding: node.strokeBinding }, node, ctx);
  const { rgb, alpha: hexAlpha } = parseHexColor(rawColor ?? "#000000");
  const alpha = clamp01(hexAlpha * (node.strokeOpacity ?? 1) * (node.opacity ?? 1));
  return { rgb, alpha, widthPx };
}

function shadowsOf(node: SceneNode, effects: Effect[], ctx: WalkCtx): ShadowInput[] | undefined {
  const shadows = effects.filter((e): e is ShadowEffect => e.type === "shadow" && e.visible !== false);
  if (shadows.length === 0) return undefined;
  return shadows.map((s) => {
    const rawColor = resolvedColorOf({ color: s.color, binding: s.colorBinding }, node, ctx);
    const { rgb, alpha: hexAlpha } = parseHexColor(rawColor ?? "#000000");
    const alpha = clamp01(hexAlpha * (node.opacity ?? 1));
    return {
      variant: s.shadowType === "inner" ? "inner" : "outer",
      rgb,
      alpha,
      offsetX: s.offset?.x ?? 0,
      offsetY: s.offset?.y ?? 0,
      blurPx: s.blur ?? 0,
    };
  });
}

function cornerRadiiOf(node: {
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
}): [number, number, number, number] | undefined {
  const per = node.cornerRadiusPerCorner;
  const uniform = node.cornerRadius ?? 0;
  const tl = per?.topLeft ?? uniform;
  const tr = per?.topRight ?? uniform;
  const br = per?.bottomRight ?? uniform;
  const bl = per?.bottomLeft ?? uniform;
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) return undefined;
  return [tl, tr, br, bl];
}

function applyTextTransform(text: string, transform: TextNode["textTransform"]): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default:
      return text;
  }
}

function textShape(node: TextNode, fills: Paint[], absX: number, absY: number, ctx: WalkCtx): TextShapeInput {
  const transformed = applyTextTransform(node.text ?? "", node.textTransform);
  const align: ParagraphInput["align"] =
    node.textAlign === "center" ? "ctr" : node.textAlign === "right" ? "r" : "l";
  const paragraphs: ParagraphInput[] = transformed.split("\n").map((text) => ({ text, align }));
  const anchor: TextShapeInput["anchor"] =
    node.textAlignVertical === "middle" ? "ctr" : node.textAlignVertical === "bottom" ? "b" : "t";

  const solidFill = fills.find((p) => p.visible !== false && p.type === "solid") as SolidPaint | undefined;
  let rgb = "000000";
  let alpha = 1;
  if (solidFill) {
    const rawColor = resolvedColorOf({ color: solidFill.color, binding: solidFill.colorBinding }, node, ctx);
    const parsed = parseHexColor(rawColor ?? "#000000");
    rgb = parsed.rgb;
    alpha = clamp01(parsed.alpha * (solidFill.opacity ?? 1) * (node.opacity ?? 1));
  }

  const weight = node.fontWeight;
  const numericWeight = weight !== undefined ? Number(weight) : NaN;
  const bold = weight === "bold" || (!Number.isNaN(numericWeight) && numericWeight >= 600);

  const font: TextFontInput = {
    family: node.fontFamily ?? "Inter",
    sizePx: node.fontSize ?? 16,
    bold,
    italic: node.fontStyle === "italic",
    underline: !!node.underline,
    strike: !!node.strikethrough,
    rgb,
    alpha,
    lineHeight: node.lineHeight,
    letterSpacingPx: node.letterSpacing,
    paragraphSpacingPx: node.paragraphSpacing,
  };

  return {
    kind: "text",
    name: node.name,
    rect: toSlideRect(absX, absY, node.width, node.height, ctx),
    rotationDeg: node.rotation || undefined,
    paragraphs,
    font,
    anchor,
  };
}

function lineShape(node: LineNode, absX: number, absY: number, ctx: WalkCtx): LineShapeInput {
  const pts = node.points ?? [0, 0, node.width, 0];
  const toPoint = (dx: number, dy: number) => ({
    x: (absX + dx) * ctx.fitScale + ctx.offsetX,
    y: (absY + dy) * ctx.fitScale + ctx.offsetY,
  });
  const p1 = toPoint(pts[0] ?? 0, pts[1] ?? 0);
  const p2 = toPoint(pts[2] ?? node.width, pts[3] ?? 0);

  const rawColor = resolvedColorOf({ color: node.stroke, binding: node.strokeBinding }, node, ctx);
  const { rgb, alpha: hexAlpha } = parseHexColor(rawColor ?? "#000000");
  const widthPx = node.strokeWidth ?? 1;
  const stroke: StrokeInput = {
    rgb,
    alpha: clamp01(hexAlpha * (node.strokeOpacity ?? 1) * (node.opacity ?? 1)),
    widthPx,
  };

  return {
    kind: "line",
    name: node.name,
    x1: p1.x,
    y1: p1.y,
    x2: p2.x,
    y2: p2.y,
    stroke,
    startCap: node.startCap as LineCap | undefined,
    endCap: node.endCap as LineCap | undefined,
  };
}

function rectShape(
  node: RectNode,
  fills: Paint[],
  effects: Effect[],
  absX: number,
  absY: number,
  ctx: WalkCtx,
): RectShapeInput {
  return {
    kind: "rect",
    name: node.name,
    rect: toSlideRect(absX, absY, node.width, node.height, ctx),
    rotationDeg: node.rotation || undefined,
    cornerRadii: cornerRadiiOf(node),
    fill: topVectorFill(fills, node, ctx),
    stroke: strokeOf(node, ctx),
    shadows: shadowsOf(node, effects, ctx),
  };
}

function ellipseShape(
  node: EllipseNode,
  fills: Paint[],
  effects: Effect[],
  absX: number,
  absY: number,
  ctx: WalkCtx,
): EllipseShapeInput {
  return {
    kind: "ellipse",
    name: node.name,
    rect: toSlideRect(absX, absY, node.width, node.height, ctx),
    rotationDeg: node.rotation || undefined,
    fill: topVectorFill(fills, node, ctx),
    stroke: strokeOf(node, ctx),
    shadows: shadowsOf(node, effects, ctx),
  };
}

function rasterize(node: SceneNode, absX: number, absY: number, ctx: WalkCtx): void {
  const rect = toSlideRect(absX, absY, node.width, node.height, ctx);
  if (rect.width <= 0 || rect.height <= 0) return;
  const scale = Math.min(3, Math.max(1, 2 * ctx.fitScale));
  const bytes = ctx.deps.rasterizeNode(node.id, rect.width, rect.height, scale);
  if (!bytes) return;
  ctx.shapes.push({ kind: "picture", name: node.name, rect, media: { bytes, mime: "image/png" } });
}

function emitFrameBackground(frame: FrameNode, fills: Paint[], effects: Effect[], rect: PptxRect, ctx: WalkCtx): void {
  const fill = topVectorFill(fills, frame, ctx);
  const stroke = strokeOf(frame, ctx);
  const shadows = shadowsOf(frame, effects, ctx);
  if (!fill && !stroke && (!shadows || shadows.length === 0)) return;
  ctx.shapes.push({
    kind: "rect",
    name: frame.name,
    rect,
    cornerRadii: cornerRadiiOf(frame),
    fill,
    stroke,
    shadows,
  });
}

function isSkipped(node: SceneNode): boolean {
  return node.visible === false || node.enabled === false || node.opacity === 0 || node.type === "connector";
}

function walkNode(node: SceneNode, parentAbsX: number, parentAbsY: number, ctx: WalkCtx): void {
  if (isSkipped(node)) return;

  if (node.type === "ref") {
    const resolved = ctx.deps.resolveRef(node);
    if (!resolved) return;
    walkNode(resolved, parentAbsX, parentAbsY, ctx);
    return;
  }

  const absX = parentAbsX + node.x;
  const absY = parentAbsY + node.y;
  const fills = ctx.deps.getNodeFills(node);
  const effects = ctx.deps.getNodeEffects(node);

  if (node.type === "group") {
    const children = (node as GroupNode).children ?? [];
    if (needsRaster(node, fills, effects)) {
      rasterize(node, absX, absY, ctx);
      return;
    }
    for (const child of children) walkNode(child, absX, absY, ctx);
    return;
  }

  if (node.type === "frame") {
    const frame = node as FrameNode;
    const children = ctx.deps.layoutChildren(frame);
    const overflow = frame.clip === true && frameChildrenOverflow(frame, children);
    if (needsRaster(node, fills, effects) || overflow) {
      rasterize(node, absX, absY, ctx);
      return;
    }
    const rect = toSlideRect(absX, absY, frame.width, frame.height, ctx);
    emitFrameBackground(frame, fills, effects, rect, ctx);
    for (const child of children) walkNode(child, absX, absY, ctx);
    return;
  }

  if (needsRaster(node, fills, effects)) {
    rasterize(node, absX, absY, ctx);
    return;
  }

  switch (node.type) {
    case "rect":
      ctx.shapes.push(rectShape(node as RectNode, fills, effects, absX, absY, ctx));
      return;
    case "ellipse":
      ctx.shapes.push(ellipseShape(node as EllipseNode, fills, effects, absX, absY, ctx));
      return;
    case "text":
      ctx.shapes.push(textShape(node as TextNode, fills, absX, absY, ctx));
      return;
    case "line":
      ctx.shapes.push(lineShape(node as LineNode, absX, absY, ctx));
      return;
    default:
      // path / polygon / embed are always routed through needsRaster() above.
      return;
  }
}

function walkFrameAsSlide(frame: FrameNode, ctx: WalkCtx): void {
  const fills = ctx.deps.getNodeFills(frame);
  const effects = ctx.deps.getNodeEffects(frame);
  const children = ctx.deps.layoutChildren(frame);

  // The slide frame gets the same raster fallback as any other container
  // (see walkNode's frame branch): if its own background can't map to a
  // vector slide background — an image/pattern/video fill, a shader, a
  // blur, multiple fills, a masked child, rotation, or clipped overflow —
  // rasterize the whole slide rather than silently dropping the background.
  const overflow = frame.clip === true && frameChildrenOverflow(frame, children);
  if (needsRaster(frame, fills, effects) || overflow) {
    rasterize(frame, 0, 0, ctx);
    return;
  }

  const rect = toSlideRect(0, 0, frame.width, frame.height, ctx);
  emitFrameBackground(frame, fills, effects, rect, ctx);
  for (const child of children) walkNode(child, 0, 0, ctx);
}

export function buildSlidesInput(frames: FrameNode[], deps: BuildDeps): PptxDocInput {
  if (frames.length === 0) return { widthPx: 960, heightPx: 540, slides: [] };

  const widthPx = frames[0].width;
  const heightPx = frames[0].height;

  const slides: SlideShapes[] = frames.map((frame) => {
    const fitScale = Math.min(widthPx / frame.width, heightPx / frame.height);
    const offsetX = (widthPx - frame.width * fitScale) / 2;
    const offsetY = (heightPx - frame.height * fitScale) / 2;
    const ctx: WalkCtx = { deps, shapes: [], fitScale, offsetX, offsetY };
    walkFrameAsSlide(frame, ctx);
    return { shapes: ctx.shapes };
  });

  return { widthPx, heightPx, slides };
}
