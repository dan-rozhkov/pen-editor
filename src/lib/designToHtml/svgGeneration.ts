import type { PathNode, LineNode, PolygonNode } from "@/types/scene";
import { applyOpacity } from "@/utils/colorUtils";

/**
 * Convert a PathNode to inline SVG markup
 */
export function pathNodeToSvg(node: PathNode): string {
  const fill = node.fill ? applyOpacity(node.fill, node.fillOpacity) : "none";
  const fillRule = node.fillRule ?? "nonzero";

  let strokeAttr = "";
  if (node.pathStroke?.fill) {
    const strokeColor = node.pathStroke.fill;
    const strokeWidth = node.pathStroke.thickness ?? 1;
    const strokeJoin = node.pathStroke.join ?? "miter";
    const strokeCap = node.pathStroke.cap ?? "butt";
    strokeAttr = ` stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="${strokeJoin}" stroke-linecap="${strokeCap}"`;
  } else if (node.stroke && node.strokeWidth) {
    const strokeColor = applyOpacity(node.stroke, node.strokeOpacity);
    strokeAttr = ` stroke="${strokeColor}" stroke-width="${node.strokeWidth}"`;
  }

  // Use geometry bounds for viewBox if available
  const gb = node.geometryBounds;
  const vbX = gb?.x ?? 0;
  const vbY = gb?.y ?? 0;
  const vbW = gb?.width ?? node.width;
  const vbH = gb?.height ?? node.height;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${node.width}" height="${node.height}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" style="display:block"><path d="${node.geometry}" fill="${fill}" fill-rule="${fillRule}"${strokeAttr}/></svg>`;
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${node.width}" height="${node.height}" viewBox="0 0 ${node.width} ${node.height}" style="display:block"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/></svg>`;
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
  let strokeAttr = "";
  if (node.stroke && node.strokeWidth) {
    const strokeColor = applyOpacity(node.stroke, node.strokeOpacity);
    strokeAttr = ` stroke="${strokeColor}" stroke-width="${node.strokeWidth}"`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${node.width}" height="${node.height}" viewBox="0 0 ${node.width} ${node.height}" style="display:block"><polygon points="${pointsStr}" fill="${fill}"${strokeAttr}/></svg>`;
}
