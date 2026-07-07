import type {
  BlurEffect,
  FlatSceneNode,
  GradientFill,
  LineCapShape,
  PerCornerRadius,
  ShadowEffect,
} from "@/types/scene";
import { applyOpacity } from "@/utils/colorUtils";
import { getRenderableEffects, getRenderableFills } from "@/utils/fillUtils";
import { hasPerCornerRadius } from "@/utils/renderUtils";
import { buildSquircleRectPath, type PathSegment } from "@/lib/shapePath/squircleCorner";
import { buildCapPrimitive } from "@/utils/lineCapUtils";

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
      ctx.warnings.push(
        `Image fill on node "${nodeLabel(node)}" is not supported in SVG export and was skipped.`,
      );
    }
  }
  return layers;
}

function gradientToSvgDef(g: GradientFill, id: string): string {
  const stops = [...g.stops]
    .sort((a, b) => a.position - b.position)
    .map(
      (s) =>
        `<stop offset="${s.position}" stop-color="${s.color}"${
          s.opacity != null && s.opacity !== 1 ? ` stop-opacity="${s.opacity}"` : ""
        }/>`,
    )
    .join("");
  if (g.type === "radial") {
    const r = g.endRadius ?? (Math.hypot(g.endX - g.startX, g.endY - g.startY) || 0.5);
    return `<radialGradient id="${id}" cx="${g.startX}" cy="${g.startY}" r="${r}">${stops}</radialGradient>`;
  }
  return `<linearGradient id="${id}" x1="${g.startX}" y1="${g.startY}" x2="${g.endX}" y2="${g.endY}">${stops}</linearGradient>`;
}

/** Render a stack of fill layers onto repeated copies of the same shape element. */
export function fillLayersMarkup(
  tag: string,
  baseAttrs: string,
  layers: FillLayer[],
  strokeAttr: string,
): string {
  if (layers.length === 0) {
    return `<${tag} ${baseAttrs} fill="none"${strokeAttr}/>`;
  }
  return layers
    .map((l, i) => {
      const opacityAttr = l.opacity != null && l.opacity !== 1 ? ` fill-opacity="${l.opacity}"` : "";
      const stroke = i === layers.length - 1 ? strokeAttr : "";
      return `<${tag} ${baseAttrs} fill="${l.fill}"${opacityAttr}${stroke}/>`;
    })
    .join("");
}

/**
 * Build a `stroke`/`stroke-width` attribute string for a node.
 * SVG only has a single uniform stroke width per shape; a per-side stroke is
 * approximated with the widest side (documented simplification), and no
 * attribute is emitted for zero-width/absent strokes.
 */
export function buildStrokeAttr(node: FlatSceneNode, ctx: SvgConversionContext): string {
  if (node.strokeWidthPerSide) {
    const sides = node.strokeWidthPerSide;
    const maxSide = Math.max(sides.top ?? 0, sides.right ?? 0, sides.bottom ?? 0, sides.left ?? 0);
    if (maxSide > 0 && node.stroke) {
      ctx.warnings.push(
        `Per-side stroke on node "${nodeLabel(node)}" is approximated with a uniform stroke in SVG export.`,
      );
      return ` stroke="${applyOpacity(node.stroke, node.strokeOpacity)}" stroke-width="${maxSide}"`;
    }
    return "";
  }
  if (!node.stroke || !node.strokeWidth) return "";
  return ` stroke="${applyOpacity(node.stroke, node.strokeOpacity)}" stroke-width="${node.strokeWidth}"`;
}

/**
 * SVG strokes always paint centered on the shape's path. Approximate Figma's
 * "inside"/"outside" stroke alignment on rect/ellipse primitives by insetting
 * (inside) or expanding (outside) the geometry by half the stroke width, so a
 * center stroke on the adjusted geometry lands on the intended edge.
 * Returns 0 for `"center"`/unset (no adjustment needed).
 */
export function strokeAlignInset(node: FlatSceneNode): number {
  if (!node.stroke || !node.strokeWidth || node.strokeWidthPerSide) return 0;
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

interface CapMarkerBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function capPrimitiveBounds(
  primitive: NonNullable<ReturnType<typeof buildCapPrimitive>>,
): CapMarkerBounds {
  const xs = [0];
  const ys = [0];
  if (primitive.kind === "lines") {
    for (const [x1, y1, x2, y2] of primitive.segments) {
      xs.push(x1, x2);
      ys.push(y1, y2);
    }
  } else if (primitive.kind === "polygon") {
    for (let i = 0; i < primitive.points.length; i += 2) {
      xs.push(primitive.points[i]);
      ys.push(primitive.points[i + 1]);
    }
  } else {
    xs.push(primitive.cx - primitive.radius, primitive.cx + primitive.radius);
    ys.push(primitive.cy - primitive.radius, primitive.cy + primitive.radius);
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Register a `<marker>` def for one line endpoint's cap shape and return its
 * id (or `null` for `'none'`). Uses `markerUnits="userSpaceOnUse"` with a
 * viewBox matching the primitive's own bounding box (already sized by
 * `strokeWidth` — see `@/utils/lineCapUtils`), so no extra scaling math is
 * needed; `orient` lets SVG auto-rotate the shape to the path direction
 * (`"auto"` for an end marker, `"auto-start-reverse"` for a start marker).
 */
export function buildCapMarker(
  shape: LineCapShape,
  strokeWidth: number,
  color: string,
  orient: "auto" | "auto-start-reverse",
  ctx: SvgConversionContext,
): string | null {
  const primitive = buildCapPrimitive(shape, strokeWidth);
  if (!primitive) return null;

  const bounds = capPrimitiveBounds(primitive);
  const id = nextSvgId("marker");
  const inner =
    primitive.kind === "lines"
      ? primitive.segments
          .map(
            ([x1, y1, x2, y2]) =>
              `<path d="M${x1},${y1} L${x2},${y2}" stroke="${color}" stroke-width="${strokeWidth}" fill="none"/>`,
          )
          .join("")
      : primitive.kind === "polygon"
        ? `<polygon points="${polylinePointsAttr(primitive.points)}" fill="${color}"/>`
        : `<circle cx="${primitive.cx}" cy="${primitive.cy}" r="${primitive.radius}" fill="${color}"/>`;

  ctx.defs.push(
    `<marker id="${id}" markerWidth="${bounds.width}" markerHeight="${bounds.height}" refX="${-bounds.minX}" refY="${-bounds.minY}" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" markerUnits="userSpaceOnUse" orient="${orient}">${inner}</marker>`,
  );
  return id;
}

function polylinePointsAttr(points: number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i < points.length; i += 2) {
    pairs.push(`${points[i]},${points[i + 1]}`);
  }
  return pairs.join(" ");
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
