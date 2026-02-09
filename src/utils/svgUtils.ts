import type { PathNode, GroupNode, SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";

/**
 * Measure bounding box of an SVG path data string using an offscreen SVG element.
 */
export function getPathBBox(pathData: string): { x: number; y: number; width: number; height: number } {
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

/** Inherited SVG style properties passed down from parent elements */
interface InheritedStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: string;
  strokeLinejoin?: string;
  strokeLinecap?: string;
  opacity?: string;
  fillOpacity?: string;
  strokeOpacity?: string;
  fillRule?: string;
}

/** Resolve a color value: treat "currentColor" as black, return null for "none" */
function resolveInheritedColor(
  localAttr: string | null,
  inherited: string | undefined,
): string | undefined {
  const raw = localAttr ?? inherited;
  if (!raw || raw === "none") return undefined;
  if (raw === "currentColor") return "#000000";
  return raw;
}

/** Read style attributes from an element, falling back to inherited values */
function getStyleProp(el: Element, prop: string): string | null {
  const inlineStyle = el.getAttribute("style");
  if (!inlineStyle) return null;
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i");
  const m = inlineStyle.match(re);
  return m ? m[1].trim() : null;
}

function getAttrOrStyle(el: Element, attr: string, styleProp: string = attr): string | null {
  return el.getAttribute(attr) ?? getStyleProp(el, styleProp);
}

function getInheritedStyle(el: Element, parent: InheritedStyle): InheritedStyle {
  return {
    fill: getAttrOrStyle(el, "fill") ?? parent.fill,
    stroke: getAttrOrStyle(el, "stroke") ?? parent.stroke,
    strokeWidth: getAttrOrStyle(el, "stroke-width") ?? parent.strokeWidth,
    strokeLinejoin: getAttrOrStyle(el, "stroke-linejoin") ?? parent.strokeLinejoin,
    strokeLinecap: getAttrOrStyle(el, "stroke-linecap") ?? parent.strokeLinecap,
    opacity: getAttrOrStyle(el, "opacity") ?? parent.opacity,
    fillOpacity: getAttrOrStyle(el, "fill-opacity") ?? parent.fillOpacity,
    strokeOpacity: getAttrOrStyle(el, "stroke-opacity") ?? parent.strokeOpacity,
    fillRule: getAttrOrStyle(el, "fill-rule") ?? parent.fillRule,
  };
}

/** Clip path definition extracted from SVG <defs> */
interface ClipPathDef {
  geometry: string;
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Convert basic SVG shapes to path data.
 */
function shapeToPathData(el: Element): string | null {
  const tag = el.tagName.toLowerCase();

  if (tag === "path") {
    return el.getAttribute("d");
  }

  if (tag === "rect") {
    const x = parseFloat(el.getAttribute("x") || "0");
    const y = parseFloat(el.getAttribute("y") || "0");
    const w = parseFloat(el.getAttribute("width") || "0");
    const h = parseFloat(el.getAttribute("height") || "0");
    if (w <= 0 || h <= 0) return null;
    return `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
  }

  if (tag === "circle") {
    const cx = parseFloat(el.getAttribute("cx") || "0");
    const cy = parseFloat(el.getAttribute("cy") || "0");
    const r = parseFloat(el.getAttribute("r") || "0");
    if (r <= 0) return null;
    // Approximate circle with bezier curves
    const k = 0.5522847498; // magic number for circle approximation
    return `M${cx - r},${cy} C${cx - r},${cy - k * r} ${cx - k * r},${cy - r} ${cx},${cy - r} C${cx + k * r},${cy - r} ${cx + r},${cy - k * r} ${cx + r},${cy} C${cx + r},${cy + k * r} ${cx + k * r},${cy + r} ${cx},${cy + r} C${cx - k * r},${cy + r} ${cx - r},${cy + k * r} ${cx - r},${cy} Z`;
  }

  if (tag === "ellipse") {
    const cx = parseFloat(el.getAttribute("cx") || "0");
    const cy = parseFloat(el.getAttribute("cy") || "0");
    const rx = parseFloat(el.getAttribute("rx") || "0");
    const ry = parseFloat(el.getAttribute("ry") || "0");
    if (rx <= 0 || ry <= 0) return null;
    const k = 0.5522847498;
    return `M${cx - rx},${cy} C${cx - rx},${cy - k * ry} ${cx - k * rx},${cy - ry} ${cx},${cy - ry} C${cx + k * rx},${cy - ry} ${cx + rx},${cy - k * ry} ${cx + rx},${cy} C${cx + rx},${cy + k * ry} ${cx + k * rx},${cy + ry} ${cx},${cy + ry} C${cx - k * rx},${cy + ry} ${cx - rx},${cy + k * ry} ${cx - rx},${cy} Z`;
  }

  return null;
}

/**
 * Parse clip-path="url(#id)" attribute and extract the id.
 */
function parseClipPathUrl(attrValue: string | null): string | null {
  if (!attrValue) return null;
  const match = attrValue.match(/url\(\s*#([^)]+)\s*\)/);
  return match ? match[1] : null;
}

/**
 * Collect all <clipPath> definitions from the SVG document.
 * Returns a map of clipPath id -> { geometry, bounds }
 */
function collectClipPaths(doc: Document): Map<string, ClipPathDef> {
  const clipPaths = new Map<string, ClipPathDef>();

  const clipPathElements = doc.querySelectorAll("clipPath");
  for (const clipEl of Array.from(clipPathElements)) {
    const id = clipEl.getAttribute("id");
    if (!id) continue;

    // Collect all path data from child shapes
    const pathParts: string[] = [];
    for (const child of Array.from(clipEl.children)) {
      const pathData = shapeToPathData(child);
      if (pathData) {
        pathParts.push(pathData);
      }
    }

    if (pathParts.length === 0) continue;

    const combinedGeometry = pathParts.join(" ");
    const bounds = getPathBBox(combinedGeometry);

    clipPaths.set(id, { geometry: combinedGeometry, bounds });
  }

  return clipPaths;
}

/**
 * Recursively collect path elements from an SVG element, accumulating parent translate offsets
 * and inheriting fill/stroke from parent elements.
 */
function collectPaths(
  el: Element,
  offsetX: number,
  offsetY: number,
  inherited: InheritedStyle,
  clipPaths: Map<string, ClipPathDef>,
  inheritedClipId: string | null = null,
): PathNode[] {
  const results: PathNode[] = [];

  for (const child of Array.from(el.children)) {
    // Check for clip-path on this element (inherits to children)
    const localClipId = parseClipPathUrl(child.getAttribute("clip-path")) ?? inheritedClipId;

    if (child.tagName === "path") {
      const d = child.getAttribute("d");
      if (!d) continue;

      // Resolve fill and stroke with inheritance
      const localFill = getAttrOrStyle(child, "fill");
      const localStroke = getAttrOrStyle(child, "stroke");
      const resolvedFill = resolveInheritedColor(localFill, inherited.fill);
      const resolvedStroke = resolveInheritedColor(localStroke, inherited.stroke);
      const resolvedStrokeWidth = getAttrOrStyle(child, "stroke-width") ?? inherited.strokeWidth;
      const resolvedLinejoin = getAttrOrStyle(child, "stroke-linejoin") ?? inherited.strokeLinejoin;
      const resolvedLinecap = getAttrOrStyle(child, "stroke-linecap") ?? inherited.strokeLinecap;

      // Resolve opacity values with inheritance
      const localOpacity = getAttrOrStyle(child, "opacity");
      const localFillOpacity = getAttrOrStyle(child, "fill-opacity");
      const localStrokeOpacity = getAttrOrStyle(child, "stroke-opacity");
      const resolvedOpacity = localOpacity ?? inherited.opacity;
      const resolvedFillOpacity = localFillOpacity ?? inherited.fillOpacity;
      const resolvedStrokeOpacity = localStrokeOpacity ?? inherited.strokeOpacity;
      const resolvedFillRule = getAttrOrStyle(child, "fill-rule") ?? inherited.fillRule;

      // Skip fully invisible paths (no fill AND no stroke)
      if (!resolvedFill && !resolvedStroke) continue;

      const bbox = getPathBBox(d);
      // Skip zero-size paths (e.g. bounding box rectangles like "M0 0h24v24H0z")
      if (bbox.width === 0 && bbox.height === 0) continue;

      const node: PathNode = {
        id: generateId(),
        type: "path",
        name: "Vector",
        x: bbox.x + offsetX,
        y: bbox.y + offsetY,
        width: Math.max(1, bbox.width),
        height: Math.max(1, bbox.height),
        geometry: d,
        fill: resolvedFill,
        geometryBounds: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      };

      // Add clip geometry if present
      if (localClipId) {
        const clipDef = clipPaths.get(localClipId);
        if (clipDef) {
          node.clipGeometry = clipDef.geometry;
          node.clipBounds = clipDef.bounds;
        }
      }

      // Add fill-rule if present (evenodd creates holes in paths)
      if (resolvedFillRule === "evenodd" || resolvedFillRule === "nonzero") {
        node.fillRule = resolvedFillRule;
      }

      // Add opacity if present
      if (resolvedOpacity) {
        node.opacity = parseFloat(resolvedOpacity);
      }
      if (resolvedFillOpacity) {
        node.fillOpacity = parseFloat(resolvedFillOpacity);
      }
      if (resolvedStrokeOpacity) {
        node.strokeOpacity = parseFloat(resolvedStrokeOpacity);
      }

      // Add stroke info if present
      if (resolvedStroke) {
        node.pathStroke = {
          fill: resolvedStroke,
          thickness: resolvedStrokeWidth ? parseFloat(resolvedStrokeWidth) : 1,
          join: resolvedLinejoin || "round",
          cap: resolvedLinecap || "round",
          align: "center",
        };
      }

      results.push(node);
    } else if (child.tagName === "g") {
      const { tx, ty } = getGroupTranslate(child as SVGElement);
      const childStyle = getInheritedStyle(child, inherited);
      results.push(...collectPaths(child, offsetX + tx, offsetY + ty, childStyle, clipPaths, localClipId));
    } else {
      // Recurse into other elements (like <svg>, <defs> siblings, etc.)
      const childStyle = getInheritedStyle(child, inherited);
      results.push(...collectPaths(child, offsetX, offsetY, childStyle, clipPaths, localClipId));
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

  // Build inherited style from root <svg> element attributes
  const rootStyle: InheritedStyle = {
    fill: getAttrOrStyle(svgEl, "fill") ?? undefined,
    stroke: getAttrOrStyle(svgEl, "stroke") ?? undefined,
    strokeWidth: getAttrOrStyle(svgEl, "stroke-width") ?? undefined,
    strokeLinejoin: getAttrOrStyle(svgEl, "stroke-linejoin") ?? undefined,
    strokeLinecap: getAttrOrStyle(svgEl, "stroke-linecap") ?? undefined,
    opacity: getAttrOrStyle(svgEl, "opacity") ?? undefined,
    fillOpacity: getAttrOrStyle(svgEl, "fill-opacity") ?? undefined,
    strokeOpacity: getAttrOrStyle(svgEl, "stroke-opacity") ?? undefined,
    fillRule: getAttrOrStyle(svgEl, "fill-rule") ?? undefined,
  };

  // Collect clip-path definitions from <defs>
  const clipPathDefs = collectClipPaths(doc);

  const pathNodes = collectPaths(svgEl, 0, 0, rootStyle, clipPathDefs, null);
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
