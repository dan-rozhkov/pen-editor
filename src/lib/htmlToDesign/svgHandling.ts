import type { SceneNode } from "@/types/scene";

export function serializeSvgWithComputedStyles(svgEl: SVGSVGElement): string | null {
  try {
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    const sourceNodes = [svgEl, ...Array.from(svgEl.querySelectorAll("*"))];
    const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];
    const count = Math.min(sourceNodes.length, cloneNodes.length);

    const styleProps = [
      "fill",
      "stroke",
      "stroke-width",
      "stroke-linecap",
      "stroke-linejoin",
      "opacity",
      "fill-opacity",
      "stroke-opacity",
      "fill-rule",
    ];

    for (let i = 0; i < count; i++) {
      const sourceEl = sourceNodes[i] as Element;
      const cloneEl = cloneNodes[i] as Element;
      const computed = window.getComputedStyle(sourceEl);
      const isRoot = i === 0;
      const shouldCopyComputed =
        isRoot ||
        sourceEl.hasAttribute("class") ||
        sourceEl.hasAttribute("style");
      for (const prop of styleProps) {
        if (!shouldCopyComputed && !sourceEl.hasAttribute(prop)) continue;
        const value = computed.getPropertyValue(prop)?.trim();
        if (!value) continue;
        // Keep "none" when style/class explicitly defines it (important for SVG paths like chart stroke path).
        if (
          (prop === "fill" || prop === "stroke") &&
          value === "none" &&
          !sourceEl.hasAttribute(prop) &&
          !shouldCopyComputed
        ) {
          continue;
        }
        cloneEl.setAttribute(prop, value);
      }
    }

    const viewBox = clone.getAttribute("viewBox");
    if (!clone.getAttribute("width") || !clone.getAttribute("height")) {
      const rect = svgEl.getBoundingClientRect();
      const resolvedW = rect.width > 0 ? rect.width : 1;
      const resolvedH = rect.height > 0 ? rect.height : 1;
      clone.setAttribute("width", `${resolvedW}`);
      clone.setAttribute("height", `${resolvedH}`);
      if (!viewBox) clone.setAttribute("viewBox", `0 0 ${resolvedW} ${resolvedH}`);
    }

    if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    return new XMLSerializer().serializeToString(clone);
  } catch {
    return null;
  }
}

export function svgTextToDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

const SVG_OPEN_TAG_RE = /<svg\b[^>]*>/i;
const DEFAULT_SVG_SIZE = 24;

function readAttr(tag: string, name: string): string | null {
  // Require a real attribute boundary (whitespace or a preceding quote) before
  // the name so `width` does not also match `stroke-width` — Feather/Lucide
  // roots carry `stroke-width`, and matching it would read the stroke width as
  // the SVG width and skip injecting a real one, leaving the SVG 0x0.
  const match = tag.match(new RegExp(`(?:\\s|["'])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  if (!match) return null;
  return match[2] ?? match[3] ?? null;
}

/**
 * Pure, DOM-free normalization of a raw `<svg>...</svg>` markup string:
 * injects `width`/`height`/`viewBox`/`xmlns` into the root `<svg>` opening
 * tag when missing, so `svgTextToDataUrl()` never produces a data: URL that
 * decodes to a 0x0 image. Only the opening tag's attributes are touched —
 * inner markup is left byte-for-byte as-is. Non-SVG input is returned
 * unchanged.
 */
export function normalizeSvgMarkup(svgText: string, fallbackWidth: number, fallbackHeight: number): string {
  const openTagMatch = svgText.match(SVG_OPEN_TAG_RE);
  if (!openTagMatch) return svgText;

  const openTag = openTagMatch[0];
  const existingWidth = parseFloat(readAttr(openTag, 'width') ?? '');
  const existingHeight = parseFloat(readAttr(openTag, 'height') ?? '');
  const viewBox = readAttr(openTag, 'viewBox');
  const viewBoxParts = viewBox?.trim().split(/[\s,]+/).map(Number);
  const viewBoxWidth = viewBoxParts?.length === 4 ? viewBoxParts[2] : undefined;
  const viewBoxHeight = viewBoxParts?.length === 4 ? viewBoxParts[3] : undefined;

  const safeFallbackWidth = fallbackWidth > 0 ? fallbackWidth : DEFAULT_SVG_SIZE;
  const safeFallbackHeight = fallbackHeight > 0 ? fallbackHeight : DEFAULT_SVG_SIZE;

  const width = Number.isFinite(existingWidth) && existingWidth > 0
    ? existingWidth
    : (viewBoxWidth && viewBoxWidth > 0 ? viewBoxWidth : safeFallbackWidth);
  const height = Number.isFinite(existingHeight) && existingHeight > 0
    ? existingHeight
    : (viewBoxHeight && viewBoxHeight > 0 ? viewBoxHeight : safeFallbackHeight);

  let newOpenTag = openTag;
  if (readAttr(newOpenTag, 'width') === null) {
    newOpenTag = newOpenTag.replace(/<svg\b/i, `<svg width="${width}"`);
  }
  if (readAttr(newOpenTag, 'height') === null) {
    newOpenTag = newOpenTag.replace(/<svg\b/i, `<svg height="${height}"`);
  }
  if (readAttr(newOpenTag, 'viewBox') === null) {
    newOpenTag = newOpenTag.replace(/<svg\b/i, `<svg viewBox="0 0 ${width} ${height}"`);
  }
  if (readAttr(newOpenTag, 'xmlns') === null) {
    newOpenTag = newOpenTag.replace(/<svg\b/i, `<svg xmlns="http://www.w3.org/2000/svg"`);
  }

  return svgText.slice(0, openTagMatch.index) + newOpenTag + svgText.slice((openTagMatch.index ?? 0) + openTag.length);
}

export function scaleAndOffsetNode(node: SceneNode, sx: number, sy: number, ox: number, oy: number): void {
  node.x = node.x * sx + ox;
  node.y = node.y * sy + oy;
  node.width *= sx;
  node.height *= sy;

  if (node.type === "path") {
    // Keep geometry/clip bounds in the original path coordinate space.
    // Path renderer derives transform from `node.width/height` vs geometry bounds.
    // Scaling bounds here causes double-transform and visual offsets/insets.
  }

  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      scaleAndOffsetNode(child, sx, sy, 0, 0);
    }
  }
}

export function normalizeSvgNodeToViewport(node: SceneNode, svgWidth: number, svgHeight: number): SceneNode {
  if (node.type !== "group") return node;

  const normalizedChildren = node.children.map((child) => {
    const clone = structuredClone(child) as SceneNode;
    shiftNode(clone, node.x, node.y);
    return clone;
  });

  return {
    ...node,
    x: 0,
    y: 0,
    width: Math.max(1, svgWidth),
    height: Math.max(1, svgHeight),
    children: normalizedChildren,
  };
}

export function shiftNode(node: SceneNode, dx: number, dy: number): void {
  node.x += dx;
  node.y += dy;
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      shiftNode(child, dx, dy);
    }
  }
}
