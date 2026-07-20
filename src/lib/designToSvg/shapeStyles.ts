import type {
  BlurEffect,
  FlatSceneNode,
  LineCapShape,
  PerCornerRadius,
  ShadowEffect,
} from "@/types/scene";
import { applyOpacity } from "@/utils/colorUtils";
import { getRenderableEffects, getRenderableFills, getRenderableStrokes } from "@/utils/fillUtils";
import { hasPerCornerRadius } from "@/utils/renderUtils";
import { buildSquircleRectPath, type PathSegment } from "@/lib/shapePath/squircleCorner";
import { buildCapMarkerDef } from "@/utils/lineCapUtils";
import { gradientToSvgDef } from "@/lib/svgGradientDef";

/** Mutable state threaded through the recursive SVG conversion. */
export interface SvgConversionContext {
  nodesById: Record<string, FlatSceneNode>;
  childrenById: Record<string, string[]>;
  /** Markup collected for the shared top-level `<defs>` block (gradients, filters, clip-paths). */
  defs: string[];
  /** Human-readable notices about content that could not be faithfully exported. */
  warnings: string[];
}

let uidCounter = 0;

/** Generate a unique id for a `<defs>` entry (gradient/filter/clip-path). */
export function nextSvgId(prefix: string): string {
  return `pen-svg-${prefix}-${++uidCounter}`;
}

function nodeLabel(node: FlatSceneNode): string {
  return node.name ?? node.id;
}

/** One resolved fill layer, bottom-to-top, ready to stamp onto a shape element. */
export interface FillLayer {
  fill: string;
  opacity?: number;
}

/**
 * Resolve a node's paint stack into SVG fill values, registering any gradient
 * `<defs>` on the shared context. Image paints are not representable as a flat
 * SVG fill and are skipped with a warning (matches designToHtml/svgGeneration).
 */
export function buildFillLayers(node: FlatSceneNode, ctx: SvgConversionContext): FillLayer[] {
  const paints = getRenderableFills(node);
  const layers: FillLayer[] = [];
  for (const paint of paints) {
    if (paint.type === "solid") {
      layers.push({ fill: applyOpacity(paint.color, paint.opacity) });
    } else if (paint.type === "gradient") {
      const id = nextSvgId("grad");
      ctx.defs.push(gradientToSvgDef(paint.gradient, id));
      layers.push({ fill: `url(#${id})`, opacity: paint.opacity });
    } else {
      const paintLabel = paint.type === "pattern" ? "Pattern fill" : "Image fill";
      ctx.warnings.push(
        `${paintLabel} on node "${nodeLabel(node)}" is not supported in SVG export and was skipped.`,
      );
    }
  }
  return layers;
}

/**
 * Render a node's full fill + stroke paint stack onto repeated copies of the
 * same shape element — fills first (bottom-to-top, `fill="none"` stroke
 * elements after), so multi-paint stroke stacks composite fully instead of
 * being approximated to a single paint (mirrors `buildFillLayers`' own
 * per-layer duplication trick, now applied to strokes too).
 */
export function fillLayersMarkup(
  tag: string,
  baseAttrs: string,
  fillLayers: FillLayer[],
  strokeLayers: StrokeLayer[],
  strokeWidthAttr: string,
): string {
  const fillEls = fillLayers.map((l) => {
    const opacityAttr = l.opacity != null && l.opacity !== 1 ? ` fill-opacity="${l.opacity}"` : "";
    return `<${tag} ${baseAttrs} fill="${l.fill}"${opacityAttr}/>`;
  });
  const strokeEls = strokeLayers.map((l) => {
    const opacityAttr = l.opacity != null && l.opacity !== 1 ? ` stroke-opacity="${l.opacity}"` : "";
    return `<${tag} ${baseAttrs} fill="none" stroke="${l.stroke}"${opacityAttr}${strokeWidthAttr}/>`;
  });
  if (fillEls.length === 0 && strokeEls.length === 0) {
    return `<${tag} ${baseAttrs} fill="none"/>`;
  }
  return fillEls.join("") + strokeEls.join("");
}

/** One resolved stroke layer, bottom-to-top, ready to stamp onto a duplicated shape element. */
export interface StrokeLayer {
  stroke: string;
  opacity?: number;
}

/**
 * Resolve a node's stroke paint stack into SVG stroke values, registering any
 * gradient `<defs>` on the shared context — mirrors `buildFillLayers`. A
 * multi-paint stroke stack is rendered as one duplicated shape element per
 * paint (via `fillLayersMarkup`, same trick already used for `fills`), so
 * full N-layer stroke compositing works, not just the topmost paint.
 * Image/pattern/video paints have no flat SVG stroke representation and are
 * dropped with a warning (matches `buildFillLayers`' image/pattern handling).
 *
 * A gradient stroke's `<linearGradient>`/`<radialGradient>` def deliberately
 * reuses `gradientToSvgDef` unchanged (no px-space conversion, unlike the
 * Pixi renderer's `buildPixiGradient(..., { forStroke: true })`): SVG's
 * default `gradientUnits="objectBoundingBox"` already maps our normalized
 * 0..1 coordinates onto the geometry element's own bounding box, which is
 * exactly Figma's model (gradient reads off the node's bbox, not inflated by
 * stroke width) — so no Pixi-style workaround is needed here.
 */
export function buildStrokeLayers(node: FlatSceneNode, ctx: SvgConversionContext): StrokeLayer[] {
  const strokes = getRenderableStrokes(node);
  const layers: StrokeLayer[] = [];
  for (const paint of strokes) {
    if (paint.type === "solid") {
      layers.push({ stroke: paint.color, opacity: paint.opacity });
    } else if (paint.type === "gradient") {
      const id = nextSvgId("stroke-grad");
      ctx.defs.push(gradientToSvgDef(paint.gradient, id));
      layers.push({ stroke: `url(#${id})`, opacity: paint.opacity });
    } else {
      const paintLabel = paint.type === "pattern" ? "Pattern stroke" : paint.type === "image" ? "Image stroke" : "Video stroke";
      ctx.warnings.push(
        `${paintLabel} on node "${nodeLabel(node)}" is not supported in SVG export and was skipped.`,
      );
    }
  }
  return layers;
}

/**
 * Build the shared `stroke-width` attribute string for a node (no color —
 * that comes per-layer from `buildStrokeLayers`). SVG only has a single
 * uniform stroke width per shape; a per-side stroke is approximated with the
 * widest side (documented simplification), and an empty string is returned
 * for zero-width/absent strokes (geometry stays node-level, shared by every
 * paint in the stack, matching the Figma/editor model).
 */
export function buildStrokeWidthAttr(node: FlatSceneNode, ctx: SvgConversionContext, hasStroke: boolean): string {
  if (node.strokeWidthPerSide) {
    const sides = node.strokeWidthPerSide;
    const maxSide = Math.max(sides.top ?? 0, sides.right ?? 0, sides.bottom ?? 0, sides.left ?? 0);
    if (maxSide > 0 && hasStroke) {
      ctx.warnings.push(
        `Per-side stroke on node "${nodeLabel(node)}" is approximated with a uniform stroke in SVG export.`,
      );
      return ` stroke-width="${maxSide}"`;
    }
    return "";
  }
  if (!hasStroke || !node.strokeWidth) return "";
  return ` stroke-width="${node.strokeWidth}"`;
}

/**
 * SVG strokes always paint centered on the shape's path. Approximate Figma's
 * "inside"/"outside" stroke alignment on rect/ellipse primitives by insetting
 * (inside) or expanding (outside) the geometry by half the stroke width, so a
 * center stroke on the adjusted geometry lands on the intended edge.
 * Returns 0 for `"center"`/unset (no adjustment needed).
 */
export function strokeAlignInset(node: FlatSceneNode): number {
  const hasStroke = node.strokes ? node.strokes.length > 0 : Boolean(node.stroke);
  if (!hasStroke || !node.strokeWidth || node.strokeWidthPerSide) return 0;
  const align = node.strokeAlign ?? "center";
  if (align === "inside") return node.strokeWidth / 2;
  if (align === "outside") return -node.strokeWidth / 2;
  return 0;
}

/** Build a rounded-rect `d` path with independent per-corner radii. */
export function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: { tl: number; tr: number; br: number; bl: number },
  cornerSmoothing?: number,
): string {
  if (cornerSmoothing) {
    return squircleRectPathD(x, y, w, h, r, cornerSmoothing);
  }

  const tl = Math.max(0, Math.min(r.tl, w / 2, h / 2));
  const tr = Math.max(0, Math.min(r.tr, w / 2, h / 2));
  const br = Math.max(0, Math.min(r.br, w / 2, h / 2));
  const bl = Math.max(0, Math.min(r.bl, w / 2, h / 2));
  return [
    `M${x + tl},${y}`,
    `H${x + w - tr}`,
    tr ? `A${tr},${tr} 0 0 1 ${x + w},${y + tr}` : "",
    `V${y + h - br}`,
    br ? `A${br},${br} 0 0 1 ${x + w - br},${y + h}` : "",
    `H${x + bl}`,
    bl ? `A${bl},${bl} 0 0 1 ${x},${y + h - bl}` : "",
    `V${y + tl}`,
    tl ? `A${tl},${tl} 0 0 1 ${x + tl},${y}` : "",
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Squircle-corner variant of `roundedRectPath`, built from the same shared
 * geometry (`@/lib/shapePath/squircleCorner`) the Pixi renderer uses. Only
 * called when `cornerSmoothing > 0` — the plain-arc branch above stays
 * untouched for `cornerSmoothing <= 0` so existing exports don't change.
 */
function squircleRectPathD(
  x: number,
  y: number,
  w: number,
  h: number,
  r: { tl: number; tr: number; br: number; bl: number },
  cornerSmoothing: number,
): string {
  const path = buildSquircleRectPath(
    w,
    h,
    { topLeft: r.tl, topRight: r.tr, bottomRight: r.br, bottomLeft: r.bl },
    cornerSmoothing,
  );

  const commands = [`M${x + path.start.x},${y + path.start.y}`];
  for (const seg of path.segments) {
    commands.push(svgCommandForSegment(seg, x, y));
  }
  commands.push("Z");
  return commands.join(" ");
}

function svgCommandForSegment(seg: PathSegment, x: number, y: number): string {
  if (seg.type === "line") {
    return `L${x + seg.x},${y + seg.y}`;
  }
  if (seg.type === "cubic") {
    return `C${x + seg.cp1x},${y + seg.cp1y} ${x + seg.cp2x},${y + seg.cp2y} ${x + seg.x},${y + seg.y}`;
  }
  // Circular arc: SVG's native `A` command needs the endpoint (not
  // start/end angle), so derive it from the same center/radius/angle.
  const endX = x + seg.cx + seg.radius * Math.cos(seg.endAngle);
  const endY = y + seg.cy + seg.radius * Math.sin(seg.endAngle);
  const sweepFlag = seg.anticlockwise ? 0 : 1;
  return `A${seg.radius},${seg.radius} 0 0 ${sweepFlag} ${endX},${endY}`;
}

export function hasNonUniformCornerRadius(pcr: PerCornerRadius | undefined): boolean {
  return Boolean(pcr && hasPerCornerRadius(pcr));
}

/**
 * Build an SVG `<filter>` for a node's shadow/blur effect stack and register
 * it in `ctx.defs`. Returns the filter id, or null if the node has no
 * renderable effects. Drop shadows use `feDropShadow` (spread is not
 * representable and is dropped — documented simplification, matching the
 * `box-shadow` spread-only-in-CSS behavior in designToHtml). Inner shadows are
 * not supported and are skipped with a warning.
 */
export function buildEffectsFilter(node: FlatSceneNode, ctx: SvgConversionContext): string | null {
  const effects = getRenderableEffects(node);
  if (effects.length === 0) return null;

  const shadows = effects.filter(
    (e): e is ShadowEffect => e.type === "shadow" && e.shadowType !== "inner",
  );
  const hasInnerShadow = effects.some((e) => e.type === "shadow" && e.shadowType === "inner");
  if (hasInnerShadow) {
    ctx.warnings.push(
      `Inner shadow on node "${nodeLabel(node)}" is not supported in SVG export and was skipped.`,
    );
  }
  const blur = effects.find((e): e is BlurEffect => e.type === "blur" && e.radius > 0);

  if (shadows.length === 0 && !blur) return null;

  const primitives: string[] = [];
  let sourceRef = "SourceGraphic";
  if (blur) {
    primitives.push(`<feGaussianBlur in="SourceGraphic" stdDeviation="${blur.radius / 2}" result="blurred"/>`);
    sourceRef = "blurred";
  }
  // Reverse so the first shadow in the stack paints on top (matches the
  // box-shadow convention used in designToHtml/styleGeneration.ts).
  for (const shadow of [...shadows].reverse()) {
    primitives.push(
      `<feDropShadow in="${sourceRef}" dx="${shadow.offset.x}" dy="${shadow.offset.y}" stdDeviation="${shadow.blur / 2}" flood-color="${shadow.color}"/>`,
    );
  }

  const filterId = nextSvgId("filter");
  ctx.defs.push(
    `<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">${primitives.join("")}</filter>`,
  );
  return filterId;
}

/**
 * Register a `<marker>` def for one line endpoint's cap shape and return its
 * id (or `null` for `'none'`). Geometry/markup is built by the shared
 * `buildCapMarkerDef` helper (`@/utils/lineCapUtils`), which both SVG export
 * paths use so the anchor and stroke-padding fixes only live in one place.
 */
export function buildCapMarker(
  shape: LineCapShape,
  strokeWidth: number,
  color: string,
  orient: "auto" | "auto-start-reverse",
  ctx: SvgConversionContext,
): string | null {
  const id = nextSvgId("marker");
  const def = buildCapMarkerDef(id, shape, strokeWidth, color, orient);
  if (!def) return null;
  ctx.defs.push(def);
  return id;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
