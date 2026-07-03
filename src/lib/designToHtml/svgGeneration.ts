import type {
  ColorBinding,
  GradientFill,
  ImageFill,
  LineNode,
  Paint,
  PathNode,
  PolygonNode,
} from "@/types/scene";
import { applyOpacity } from "@/utils/colorUtils";
import { getRenderableFills } from "@/utils/fillUtils";

let gradientIdCounter = 0;

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
    // image paints: skipped in SVG output (matches pathRenderer scope)
  }
  return { layers, defs };
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
  const { layers, defs } = buildSvgFillLayers(node);
  const fillRule = node.fillRule ?? "nonzero";

  let strokeWidth = 0;
  let strokeAlign: string | undefined;
  let strokeAttr = "";
  if (node.pathStroke?.fill) {
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${node.width + padX * 2}" height="${node.height + padY * 2}" viewBox="${-padUnits} ${-padUnits} ${node.width + padUnits * 2} ${node.height + padUnits * 2}" style="${style}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/></svg>`;
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

  const { layers, defs } = buildSvgFillLayers(node);
  let strokeWidth = 0;
  let strokeAttr = "";
  if (node.stroke && node.strokeWidth) {
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
