import type { PathNode, LineNode, PolygonNode } from "@/types/scene";
import { applyOpacity } from "@/utils/colorUtils";

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
  const fill = node.fill ? applyOpacity(node.fill, node.fillOpacity) : "none";
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="${paddedVbX} ${paddedVbY} ${paddedVbW} ${paddedVbH}" style="${style}"><path d="${node.geometry}" fill="${fill}" fill-rule="${fillRule}"${strokeAttr}/></svg>`;
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

  const fill = node.fill ? applyOpacity(node.fill, node.fillOpacity) : "none";
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${node.width + padX * 2}" height="${node.height + padY * 2}" viewBox="${-padUnits} ${-padUnits} ${node.width + padUnits * 2} ${node.height + padUnits * 2}" style="${style}"><polygon points="${pointsStr}" fill="${fill}"${strokeAttr}/></svg>`;
}
