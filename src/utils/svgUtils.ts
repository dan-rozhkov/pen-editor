import type { PathNode, GroupNode, SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";

/**
 * Measure bounding box of an SVG path data string using an offscreen SVG element.
 */
function getPathBBox(pathData: string): { x: number; y: number; width: number; height: number } {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.position = "absolute";
  svg.style.left = "-9999px";
  svg.style.top = "-9999px";
  document.body.appendChild(svg);

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  svg.appendChild(path);

  const bbox = path.getBBox();
  document.body.removeChild(svg);

  return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
}

/**
 * Extract transform translate values from a <g> element's transform attribute.
 * Returns {tx, ty} offset. Only handles translate for v1.
 */
function getGroupTranslate(el: SVGElement): { tx: number; ty: number } {
  const transform = el.getAttribute("transform");
  if (!transform) return { tx: 0, ty: 0 };

  const translateMatch = transform.match(/translate\(\s*([^,\s]+)[,\s]+([^)]+)\)/);
  if (translateMatch) {
    return { tx: parseFloat(translateMatch[1]) || 0, ty: parseFloat(translateMatch[2]) || 0 };
  }
  return { tx: 0, ty: 0 };
}

/**
 * Recursively collect path elements from an SVG element, accumulating parent translate offsets.
 */
function collectPaths(
  el: Element,
  offsetX: number,
  offsetY: number,
): PathNode[] {
  const results: PathNode[] = [];

  for (const child of Array.from(el.children)) {
    if (child.tagName === "path") {
      const d = child.getAttribute("d");
      if (!d) continue;

      const fill = child.getAttribute("fill");
      const stroke = child.getAttribute("stroke");
      const strokeWidth = child.getAttribute("stroke-width");
      const strokeLinejoin = child.getAttribute("stroke-linejoin");
      const strokeLinecap = child.getAttribute("stroke-linecap");

      const bbox = getPathBBox(d);

      const node: PathNode = {
        id: generateId(),
        type: "path",
        name: "Vector",
        x: bbox.x + offsetX,
        y: bbox.y + offsetY,
        width: Math.max(1, bbox.width),
        height: Math.max(1, bbox.height),
        geometry: d,
        fill: fill && fill !== "none" ? fill : undefined,
        geometryBounds: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      };

      // Add stroke info if present
      if (stroke && stroke !== "none") {
        node.pathStroke = {
          fill: stroke,
          thickness: strokeWidth ? parseFloat(strokeWidth) : 1,
          join: strokeLinejoin || "round",
          cap: strokeLinecap || "round",
          align: "center",
        };
      }

      results.push(node);
    } else if (child.tagName === "g") {
      const { tx, ty } = getGroupTranslate(child as SVGElement);
      results.push(...collectPaths(child, offsetX + tx, offsetY + ty));
    } else {
      // Recurse into other elements (like <svg>, <defs> siblings, etc.)
      results.push(...collectPaths(child, offsetX, offsetY));
    }
  }

  return results;
}

/**
 * Parse an SVG file string and return scene nodes (PathNodes, possibly wrapped in a GroupNode).
 * Returns a single SceneNode ready to add to the scene.
 */
export function parseSvgToNodes(svgText: string): { node: SceneNode; svgWidth: number; svgHeight: number } | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");

  const svgEl = doc.querySelector("svg");
  if (!svgEl) return null;

  // Get SVG dimensions from viewBox or width/height attributes
  let svgWidth = 100;
  let svgHeight = 100;

  const viewBox = svgEl.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      svgWidth = parts[2];
      svgHeight = parts[3];
    }
  } else {
    const w = svgEl.getAttribute("width");
    const h = svgEl.getAttribute("height");
    if (w) svgWidth = parseFloat(w) || 100;
    if (h) svgHeight = parseFloat(h) || 100;
  }

  const pathNodes = collectPaths(svgEl, 0, 0);
  if (pathNodes.length === 0) return null;

  if (pathNodes.length === 1) {
    return { node: pathNodes[0], svgWidth, svgHeight };
  }

  // Multiple paths — wrap in a group
  // Compute bounding box of all paths
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pathNodes) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }

  // Offset children relative to group origin
  for (const p of pathNodes) {
    p.x -= minX;
    p.y -= minY;
  }

  const group: GroupNode = {
    id: generateId(),
    type: "group",
    name: "SVG",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    children: pathNodes,
  };

  return { node: group, svgWidth, svgHeight };
}
