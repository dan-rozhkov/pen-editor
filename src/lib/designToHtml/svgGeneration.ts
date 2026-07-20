import type {
  ColorBinding,
  GradientFill,
  ImageFill,
  LineCapShape,
  LineNode,
  Paint,
  PathNode,
  PolygonNode,
} from "@/types/scene";
import { applyOpacity } from "@/utils/colorUtils";
import { getRenderableFills, getRenderableStrokes } from "@/utils/fillUtils";
import { buildCapMarkerDef } from "@/utils/lineCapUtils";
import { gradientToSvgDef } from "@/lib/svgGradientDef";

let gradientIdCounter = 0;
let markerIdCounter = 0;

/**
 * Build a `<marker>` def + its id for one line endpoint's cap shape (or
 * `null` for `'none'`). Geometry/markup comes from the shared
 * `buildCapMarkerDef` helper (`@/utils/lineCapUtils`), also used by
 * `buildCapMarker` in `@/lib/designToSvg/shapeStyles`.
 */
function buildInlineCapMarker(
  shape: LineCapShape | undefined,
  strokeWidth: number,
  color: string,
  orient: "auto" | "auto-start-reverse",
): { id: string; def: string } | null {
  const id = `pen-svg-marker-${++markerIdCounter}`;
  const def = buildCapMarkerDef(id, shape ?? "none", strokeWidth, color, orient);
  if (!def) return null;
  return { id, def };
}

/** Build fill attribute values (bottom-to-top) + <defs> markup for a node's paint stack. */
function buildSvgFillLayers(node: {
  fills?: Paint[];
  fill?: string;
  fillOpacity?: number;
  fillBinding?: ColorBinding;
  gradientFill?: GradientFill;
  imageFill?: ImageFill;
}): { layers: { fill: string; opacity?: number }[]; defs: string } {
  const paints = getRenderableFills(node);
  const layers: { fill: string; opacity?: number }[] = [];
  let defs = "";
  for (const paint of paints) {
    if (paint.type === "solid") {
      layers.push({
        fill: applyOpacity(paint.color, paint.opacity),
      });
    } else if (paint.type === "gradient") {
      const id = `pen-svg-grad-${++gradientIdCounter}`;
      defs += gradientToSvgDef(paint.gradient, id);
      layers.push({ fill: `url(#${id})`, opacity: paint.opacity });
    }
    // image/pattern paints: skipped in SVG output (matches pathRenderer
    // scope; a pattern's tile natural size is unknown at export time, so a
    // correct <pattern> def cannot be emitted)
  }
  return { layers, defs };
}

/**
 * Resolve a node's `strokes` paint stack (bottom-to-top) into an SVG stroke
 * value, mirroring `resolveStrokePaint` in `@/lib/designToSvg/shapeStyles`:
 * a gradient paint gets a `<linearGradient>`/`<radialGradient>` def instead
 * of being approximated as a solid; a multi-paint stack is approximated with
 * its topmost visible paint only (SVG has one `stroke=` slot per element —
 * full compositing would require duplicating the shape element per layer,
 * out of scope here). Returns `null` when there is no solid/gradient paint
 * to render (e.g. only `strokes` is set but every paint is hidden, or an
 * unsupported image/pattern/video paint).
 */
function resolveStrokePaintFromStack(node: { strokes?: Paint[] }): {
  stroke: string;
  opacity?: number;
  def: string;
} | null {
  if (!node.strokes) return null;
  const strokes = getRenderableStrokes(node).filter((p) => p.type === "solid" || p.type === "gradient");
  const topmost = strokes.at(-1);
  if (!topmost) return null;
  if (topmost.type === "solid") {
    return { stroke: topmost.color, opacity: topmost.opacity, def: "" };
  }
  const id = `pen-svg-stroke-grad-${++gradientIdCounter}`;
  return { stroke: `url(#${id})`, opacity: topmost.opacity, def: gradientToSvgDef(topmost.gradient, id) };
}

function getStrokeAlignPaddingUnits(
  strokeWidth: number,
  align: string | undefined,
): number {
  if (strokeWidth <= 0) return 0;
  const normalized = (align ?? "center").toLowerCase();
  if (normalized === "inside") return 0;
  if (normalized === "outside") return strokeWidth;
  return strokeWidth / 2;
}

function buildSvgRenderStyle(
  offsetX: number,
  offsetY: number,
): string {
  const left = offsetX !== 0 ? `left:${-offsetX}px;` : "";
  const top = offsetY !== 0 ? `top:${-offsetY}px;` : "";
  const pos = left || top ? "position:relative;" : "";
  return `display:block;overflow:visible;${pos}${left}${top}`;
}

function safeRatio(num: number, den: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

/**
 * Convert a PathNode to inline SVG markup
 */
export function pathNodeToSvg(node: PathNode): string {
  const { layers, defs: fillDefs } = buildSvgFillLayers(node);
  let defs = fillDefs;
  const fillRule = node.fillRule ?? "nonzero";

  let strokeWidth = 0;
  let strokeAlign: string | undefined;
  let strokeAttr = "";
  // `strokes` (gradient/multi-paint stack) takes priority over the
  // solid-only `pathStroke`/legacy `stroke` fallbacks — mirrors
  // `getStrokes()`'s fallback order in `@/utils/fillUtils`. Geometry
  // (width/join/cap) is not part of the paint stack, so it still comes from
  // `pathStroke`/node-level fields regardless of which paint model is used.
  const stackStroke = resolveStrokePaintFromStack(node);
  if (stackStroke && (node.strokeWidth || node.pathStroke?.thickness)) {
    strokeWidth = node.strokeWidth ?? node.pathStroke?.thickness ?? 1;
    strokeAlign = node.pathStroke?.align ?? node.strokeAlign;
    const strokeJoin = node.pathStroke?.join ?? "miter";
    const strokeCap = node.pathStroke?.cap ?? "butt";
    const opacityAttr =
      stackStroke.opacity != null && stackStroke.opacity !== 1 ? ` stroke-opacity="${stackStroke.opacity}"` : "";
    strokeAttr = ` stroke="${stackStroke.stroke}"${opacityAttr} stroke-width="${strokeWidth}" stroke-linejoin="${strokeJoin}" stroke-linecap="${strokeCap}"`;
    defs += stackStroke.def;
  } else if (node.pathStroke?.fill) {
    const strokeColor = applyOpacity(node.pathStroke.fill, node.strokeOpacity);
    strokeWidth = node.pathStroke.thickness ?? 1;
    strokeAlign = node.pathStroke.align ?? node.strokeAlign;
    const strokeJoin = node.pathStroke.join ?? "miter";
    const strokeCap = node.pathStroke.cap ?? "butt";
    strokeAttr = ` stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="${strokeJoin}" stroke-linecap="${strokeCap}"`;
  } else if (node.stroke && node.strokeWidth) {
    const strokeColor = applyOpacity(node.stroke, node.strokeOpacity);
    strokeWidth = node.strokeWidth;
    strokeAlign = node.strokeAlign;
    strokeAttr = ` stroke="${strokeColor}" stroke-width="${node.strokeWidth}"`;
  }

  // Use geometry bounds for viewBox if available
  const gb = node.geometryBounds;
  const vbX = gb?.x ?? 0;
  const vbY = gb?.y ?? 0;
  const vbW = gb?.width ?? node.width;
  const vbH = gb?.height ?? node.height;
  const padUnits = getStrokeAlignPaddingUnits(strokeWidth, strokeAlign);
  const scaleX = safeRatio(node.width, vbW);
  const scaleY = safeRatio(node.height, vbH);
  const padX = padUnits * scaleX;
  const padY = padUnits * scaleY;
  const svgWidth = node.width + padX * 2;
  const svgHeight = node.height + padY * 2;
  const style = buildSvgRenderStyle(padX, padY);
  const paddedVbX = vbX - padUnits;
  const paddedVbY = vbY - padUnits;
  const paddedVbW = vbW + padUnits * 2;
  const paddedVbH = vbH + padUnits * 2;

  const shapeEls =
    layers.length === 0
      ? `<path d="${node.geometry}" fill="none" fill-rule="${fillRule}"${strokeAttr}/>`
      : layers
          .map(
            (l, i) =>
              `<path d="${node.geometry}" fill="${l.fill}"${
                l.opacity != null && l.opacity !== 1 ? ` fill-opacity="${l.opacity}"` : ""
              } fill-rule="${fillRule}"${i === layers.length - 1 ? strokeAttr : ""}/>`,
          )
          .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="${paddedVbX} ${paddedVbY} ${paddedVbW} ${paddedVbH}" style="${style}">${defs ? `<defs>${defs}</defs>` : ""}${shapeEls}</svg>`;
}

/**
 * Convert a LineNode to inline SVG markup
 */
export function lineNodeToSvg(node: LineNode): string {
  const [x1, y1, x2, y2] = node.points;
  const strokeColor = node.stroke
    ? applyOpacity(node.stroke, node.strokeOpacity)
    : "#000000";
  const strokeWidth = node.strokeWidth ?? 1;
  const padUnits = getStrokeAlignPaddingUnits(strokeWidth, node.strokeAlign);
  const padX = padUnits;
  const padY = padUnits;
  const style = buildSvgRenderStyle(padX, padY);

  const startMarker = buildInlineCapMarker(node.startCap, strokeWidth, strokeColor, "auto-start-reverse");
  const endMarker = buildInlineCapMarker(node.endCap, strokeWidth, strokeColor, "auto");
  const defs = (startMarker?.def ?? "") + (endMarker?.def ?? "");
  const markerAttrs =
    (startMarker ? ` marker-start="url(#${startMarker.id})"` : "") +
    (endMarker ? ` marker-end="url(#${endMarker.id})"` : "");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${node.width + padX * 2}" height="${node.height + padY * 2}" viewBox="${-padUnits} ${-padUnits} ${node.width + padUnits * 2} ${node.height + padUnits * 2}" style="${style}">${defs ? `<defs>${defs}</defs>` : ""}<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeColor}" stroke-width="${strokeWidth}"${markerAttrs}/></svg>`;
}

/**
 * Convert a PolygonNode to inline SVG markup
 */
export function polygonNodeToSvg(node: PolygonNode): string {
  // Convert flat [x1,y1,x2,y2,...] to "x1,y1 x2,y2 ..." string
  const points: string[] = [];
  for (let i = 0; i < node.points.length; i += 2) {
    points.push(`${node.points[i]},${node.points[i + 1]}`);
  }
  const pointsStr = points.join(" ");

  const { layers, defs: fillDefs } = buildSvgFillLayers(node);
  let defs = fillDefs;
  let strokeWidth = 0;
  let strokeAttr = "";
  const stackStroke = resolveStrokePaintFromStack(node);
  if (stackStroke && node.strokeWidth) {
    strokeWidth = node.strokeWidth;
    const opacityAttr =
      stackStroke.opacity != null && stackStroke.opacity !== 1 ? ` stroke-opacity="${stackStroke.opacity}"` : "";
    strokeAttr = ` stroke="${stackStroke.stroke}"${opacityAttr} stroke-width="${strokeWidth}"`;
    defs += stackStroke.def;
  } else if (node.stroke && node.strokeWidth) {
    const strokeColor = applyOpacity(node.stroke, node.strokeOpacity);
    strokeWidth = node.strokeWidth;
    strokeAttr = ` stroke="${strokeColor}" stroke-width="${node.strokeWidth}"`;
  }
  const padUnits = getStrokeAlignPaddingUnits(strokeWidth, node.strokeAlign);
  const padX = padUnits;
  const padY = padUnits;
  const style = buildSvgRenderStyle(padX, padY);

  const shapeEls =
    layers.length === 0
      ? `<polygon points="${pointsStr}" fill="none"${strokeAttr}/>`
      : layers
          .map(
            (l, i) =>
              `<polygon points="${pointsStr}" fill="${l.fill}"${
                l.opacity != null && l.opacity !== 1 ? ` fill-opacity="${l.opacity}"` : ""
              }${i === layers.length - 1 ? strokeAttr : ""}/>`,
          )
          .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${node.width + padX * 2}" height="${node.height + padY * 2}" viewBox="${-padUnits} ${-padUnits} ${node.width + padUnits * 2} ${node.height + padUnits * 2}" style="${style}">${defs ? `<defs>${defs}</defs>` : ""}${shapeEls}</svg>`;
}
