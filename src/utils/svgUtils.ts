import type { PathNode, GroupNode, SceneNode, GradientFill } from "@/types/scene";
import { generateId } from "@/types/scene";

/**
 * A 2D affine matrix in SVG's `matrix(a,b,c,d,e,f)` convention:
 * `x' = a*x + c*y + e`, `y' = b*x + d*y + f`.
 */
interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function isIdentityMatrix(m: Matrix2D): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

function multiplyMatrix(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function applyMatrixToPoint(m: Matrix2D, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/**
 * Parse an SVG `transform`/`gradientTransform` attribute value into a single
 * composed `Matrix2D`. Supports `translate`, `scale`, `rotate` (with or
 * without a pivot), `matrix`, `skewX`/`skewY`. Unknown function names or
 * malformed argument lists are skipped (identity contribution) rather than
 * throwing, so a partially-malformed transform list degrades gracefully.
 */
function parseTransformAttribute(transform: string | null | undefined): Matrix2D {
  if (!transform) return IDENTITY_MATRIX;
  let result = IDENTITY_MATRIX;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(transform))) {
    const fn = match[1].toLowerCase();
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    let m: Matrix2D | null = null;
    if (fn === "translate" && args.length >= 1) {
      m = { a: 1, b: 0, c: 0, d: 1, e: args[0], f: args[1] ?? 0 };
    } else if (fn === "scale" && args.length >= 1) {
      const sx = args[0];
      const sy = args.length > 1 ? args[1] : sx;
      m = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
    } else if (fn === "rotate" && args.length >= 1) {
      const rad = (args[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rot: Matrix2D = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      if (args.length >= 3) {
        const [, cx, cy] = args;
        const toOrigin: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy };
        const back: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy };
        m = multiplyMatrix(multiplyMatrix(back, rot), toOrigin);
      } else {
        m = rot;
      }
    } else if (fn === "matrix" && args.length === 6) {
      m = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
    } else if (fn === "skewx" && args.length >= 1) {
      m = { a: 1, b: 0, c: Math.tan((args[0] * Math.PI) / 180), d: 1, e: 0, f: 0 };
    } else if (fn === "skewy" && args.length >= 1) {
      m = { a: 1, b: Math.tan((args[0] * Math.PI) / 180), c: 0, d: 1, e: 0, f: 0 };
    }
    if (m) result = multiplyMatrix(result, m);
  }
  return result;
}

/**
 * Singular values of the 2x2 linear part of a matrix, via the closed-form
 * "E,F,G,H" 2x2 SVD trick. Used to approximate an elliptical radial gradient
 * (non-uniform scale/rotation baked into `gradientTransform`) as a single
 * circular radius: `sqrt(s1*s2)` preserves the ellipse's area-equivalent
 * radius, and `s2/s1` measures how far from circular it actually is (used to
 * decide whether to warn about the approximation).
 */
function svdSingularValues(m: Matrix2D): { s1: number; s2: number } {
  const E = (m.a + m.d) / 2;
  const F = (m.a - m.d) / 2;
  const G = (m.b + m.c) / 2;
  const H = (m.b - m.c) / 2;
  const Q = Math.hypot(E, H);
  const R = Math.hypot(F, G);
  return { s1: Math.max(0, Q + R), s2: Math.max(0, Q - R) };
}

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

  // The second argument is optional per the SVG spec (`translate(10)` means
  // `translate(10, 0)`) — the previous `[,\s]+([^)]+)` group required it,
  // silently reading a single-argument translate as {tx: 0, ty: 0}.
  const translateMatch = transform.match(/translate\(\s*([^,\s)]+)\s*(?:[,\s]+([^)]+))?\)/);
  if (translateMatch) {
    const tx = parseFloat(translateMatch[1]) || 0;
    const ty = translateMatch[2] !== undefined ? parseFloat(translateMatch[2]) || 0 : 0;
    return { tx, ty };
  }
  return { tx: 0, ty: 0 };
}

/**
 * Does a `transform` attribute contain any function other than `translate`?
 * Used to warn about `<g>` transforms this importer can't bake into
 * geometry — checked against every function in the list, not just the
 * first, so `translate(5,5) scale(2)` (common Figma/Illustrator output)
 * is caught instead of being misread as "starts with translate, so fine".
 */
function hasNonTranslateTransformFunction(transform: string): boolean {
  const names = Array.from(transform.matchAll(/([a-zA-Z]+)\s*\(/g)).map((m) => m[1].toLowerCase());
  return names.some((name) => name !== "translate");
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

function parseGradientUrl(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^url\(\s*['"]?#([^'")]+)['"]?\s*\)$/i);
  return match ? match[1] : null;
}

/** Raw (pre-normalization, pre-gradientTransform) coordinate parsing, shared
 * by linear and radial gradients. Unlike `parseGradientCoord`, this returns a
 * value in the gradient's own raw coordinate space (fraction for
 * objectBoundingBox, user units for userSpaceOnUse) so a `gradientTransform`
 * matrix — which operates in that same raw space — can be applied before the
 * final per-axis normalization. */
function parseGradientRawCoord(
  value: string | null,
  rawFallback: number,
  axisSize: number,
  units: string,
): number {
  if (!value) return rawFallback;
  const raw = value.trim();
  if (raw.endsWith("%")) {
    const pct = parseFloat(raw);
    if (!Number.isFinite(pct)) return rawFallback;
    return units === "userSpaceOnUse" ? (pct / 100) * axisSize : pct / 100;
  }
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : rawFallback;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * A gradient definition, parsed once from `<defs>` and left in its own raw
 * coordinate space (`gradientTransform` already baked in for radial
 * gradients' center/radius, and for linear gradients' endpoints) — NOT yet
 * normalized to 0-1. A `userSpaceOnUse` gradient can only be turned into the
 * shape-local 0-1 fractions the renderer expects once the *referencing
 * shape's* bounding box is known (see `resolveGradientForShape`), so that
 * step happens per-use instead of once here.
 */
type RawGradientDef =
  | {
      kind: "linear";
      units: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stops: GradientFill["stops"];
    }
  | {
      kind: "radial";
      units: string;
      cx: number;
      cy: number;
      r: number;
      stops: GradientFill["stops"];
    };

/**
 * Resolve a raw gradient definition into shape-local 0-1 `GradientFill`
 * coordinates, using `bbox` — the same local (untranslated) bounding box
 * `collectPaths` already computes for the referencing shape via
 * `getPathBBox`.
 *
 * `objectBoundingBox` (the SVG default) needs no shape knowledge: its
 * coordinates are already fractions of the shape's own bbox by definition.
 * `userSpaceOnUse` coordinates are in the same user-coordinate system as the
 * shape's geometry, so they are made shape-local by subtracting the bbox
 * origin and dividing by the bbox size — never by the SVG viewport, which is
 * an unrelated coordinate system once a shape isn't the same size as its
 * document (see the regression this fixes: a small shape in a large SVG had
 * its gradient normalized against the whole canvas instead of itself).
 */
function resolveGradientForShape(
  def: RawGradientDef,
  bbox: { x: number; y: number; width: number; height: number },
): GradientFill {
  const userSpace = def.units === "userSpaceOnUse";

  if (def.kind === "linear") {
    const startX = userSpace ? (bbox.width > 0 ? (def.x1 - bbox.x) / bbox.width : def.x1) : def.x1;
    const startY = userSpace ? (bbox.height > 0 ? (def.y1 - bbox.y) / bbox.height : def.y1) : def.y1;
    const endX = userSpace ? (bbox.width > 0 ? (def.x2 - bbox.x) / bbox.width : def.x2) : def.x2;
    const endY = userSpace ? (bbox.height > 0 ? (def.y2 - bbox.y) / bbox.height : def.y2) : def.y2;
    return {
      type: "linear",
      stops: def.stops,
      startX: clamp01(startX),
      startY: clamp01(startY),
      endX: clamp01(endX),
      endY: clamp01(endY),
    };
  }

  const startX = userSpace ? (bbox.width > 0 ? (def.cx - bbox.x) / bbox.width : def.cx) : def.cx;
  const startY = userSpace ? (bbox.height > 0 ? (def.cy - bbox.y) / bbox.height : def.cy) : def.cy;
  // Radius is normalized against width only, matching how this repo's
  // renderer scales `endRadius` (`fillStrokeHelpers.ts`: `endRadius * width`).
  const endRadius = userSpace ? (bbox.width > 0 ? def.r / bbox.width : def.r) : def.r;

  return {
    type: "radial",
    stops: def.stops,
    startX: clamp01(startX),
    startY: clamp01(startY),
    endX: clamp01(startX),
    endY: clamp01(startY),
    startRadius: 0,
    endRadius: Math.max(0, endRadius),
  };
}

function parseGradientStops(gradientEl: Element): GradientFill["stops"] {
  return Array.from(gradientEl.querySelectorAll("stop"))
    .map((stopEl) => {
      const offsetRaw = getAttrOrStyle(stopEl, "offset") ?? "0%";
      const offset = offsetRaw.trim().endsWith("%")
        ? parseFloat(offsetRaw) / 100
        : parseFloat(offsetRaw);
      const stopColor = getAttrOrStyle(stopEl, "stop-color") ?? "#000000";
      const stopOpacityRaw = getAttrOrStyle(stopEl, "stop-opacity");
      const stopOpacity = stopOpacityRaw != null ? parseFloat(stopOpacityRaw) : undefined;
      return {
        color: stopColor,
        position: Number.isFinite(offset) ? Math.max(0, Math.min(1, offset)) : 0,
        ...(Number.isFinite(stopOpacity ?? NaN) ? { opacity: Math.max(0, Math.min(1, stopOpacity!)) } : {}),
      };
    })
    .sort((a, b) => a.position - b.position);
}

function collectLinearGradients(
  doc: Document,
  svgWidth: number,
  svgHeight: number,
): Map<string, RawGradientDef> {
  const gradients = new Map<string, RawGradientDef>();
  const gradientEls = doc.querySelectorAll("linearGradient");

  for (const gradientEl of Array.from(gradientEls)) {
    const id = gradientEl.getAttribute("id");
    if (!id) continue;

    const units = gradientEl.getAttribute("gradientUnits") ?? "objectBoundingBox";
    const matrix = parseTransformAttribute(gradientEl.getAttribute("gradientTransform"));

    const rawX1 = parseGradientRawCoord(gradientEl.getAttribute("x1"), 0, svgWidth, units);
    const rawY1 = parseGradientRawCoord(gradientEl.getAttribute("y1"), 0, svgHeight, units);
    const rawX2 = parseGradientRawCoord(
      gradientEl.getAttribute("x2"),
      units === "userSpaceOnUse" ? svgWidth : 1,
      svgWidth,
      units,
    );
    const rawY2 = parseGradientRawCoord(gradientEl.getAttribute("y2"), 0, svgHeight, units);

    // `gradientTransform` operates in the gradient's own raw coordinate
    // space (fraction for objectBoundingBox, user units for
    // userSpaceOnUse) — apply it here, before this def is stored, so the
    // per-shape resolution step later only has to do the unit conversion.
    const p1 = applyMatrixToPoint(matrix, rawX1, rawY1);
    const p2 = applyMatrixToPoint(matrix, rawX2, rawY2);

    const stops = parseGradientStops(gradientEl);
    if (stops.length === 0) continue;

    gradients.set(id, {
      kind: "linear",
      units,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      stops,
    });
  }

  return gradients;
}

/**
 * Collect `<radialGradient>` defs into the same raw shape used for linear
 * gradients. This repo's `GradientFill`/renderer model only supports a
 * single (circular) radius (see `pixi/renderers/fillStrokeHelpers.ts`), so an
 * elliptical result — from a non-uniform-scale/rotation `gradientTransform`,
 * which QuiverAI emits (e.g. `translate(...) rotate(...) scale(sx,sy)`) — is
 * approximated by its area-equivalent circular radius (`sqrt(s1*s2)` of the
 * transform's singular values) and a warning is pushed when the two axes
 * differ enough to matter.
 */
function collectRadialGradients(
  doc: Document,
  svgWidth: number,
  svgHeight: number,
  warnings: string[],
): Map<string, RawGradientDef> {
  const gradients = new Map<string, RawGradientDef>();
  const gradientEls = doc.querySelectorAll("radialGradient");

  for (const gradientEl of Array.from(gradientEls)) {
    const id = gradientEl.getAttribute("id");
    if (!id) continue;

    const units = gradientEl.getAttribute("gradientUnits") ?? "objectBoundingBox";
    const matrix = parseTransformAttribute(gradientEl.getAttribute("gradientTransform"));

    const rawCx = parseGradientRawCoord(gradientEl.getAttribute("cx"), units === "userSpaceOnUse" ? svgWidth * 0.5 : 0.5, svgWidth, units);
    const rawCy = parseGradientRawCoord(gradientEl.getAttribute("cy"), units === "userSpaceOnUse" ? svgHeight * 0.5 : 0.5, svgHeight, units);
    const rawR = parseGradientRawCoord(gradientEl.getAttribute("r"), units === "userSpaceOnUse" ? svgWidth * 0.5 : 0.5, svgWidth, units);

    let centerX = rawCx;
    let centerY = rawCy;
    let radius = rawR;

    if (!isIdentityMatrix(matrix)) {
      const center = applyMatrixToPoint(matrix, rawCx, rawCy);
      centerX = center.x;
      centerY = center.y;
      const { s1, s2 } = svdSingularValues(matrix);
      // Area-equivalent circular radius of the transformed ellipse.
      radius = rawR * Math.sqrt(Math.max(0, s1 * s2));
      if (s1 > 0 && s2 / s1 < 0.85) {
        warnings.push(
          `Radial gradient "${id}" is elliptical (its gradientTransform has non-uniform scale/rotation); approximated as a circle.`,
        );
      }
    }

    const stops = parseGradientStops(gradientEl);
    if (stops.length === 0) continue;

    gradients.set(id, {
      kind: "radial",
      units,
      cx: centerX,
      cy: centerY,
      r: radius,
      stops,
    });
  }

  return gradients;
}

/** Parse a `points="x1,y1 x2,y2 ..."` attribute into an `M...L...` path string. */
function pointsAttrToPathData(pointsAttr: string): string | null {
  const coords = pointsAttr.trim().split(/[\s,]+/).map(Number);
  if (coords.length < 4) return null;
  let d = `M${coords[0]},${coords[1]}`;
  for (let i = 2; i < coords.length; i += 2) {
    d += ` L${coords[i]},${coords[i + 1]}`;
  }
  return d;
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

    // SVG semantics: if only one radius is provided, the other matches it.
    const rawRx = el.getAttribute("rx");
    const rawRy = el.getAttribute("ry");
    let rx = rawRx !== null ? parseFloat(rawRx) : NaN;
    let ry = rawRy !== null ? parseFloat(rawRy) : NaN;

    const hasRx = Number.isFinite(rx);
    const hasRy = Number.isFinite(ry);
    if (hasRx && !hasRy) ry = rx;
    if (!hasRx && hasRy) rx = ry;

    rx = Number.isFinite(rx) ? Math.max(0, Math.min(rx, w / 2)) : 0;
    ry = Number.isFinite(ry) ? Math.max(0, Math.min(ry, h / 2)) : 0;

    if (rx <= 0 || ry <= 0) {
      return `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
    }

    const right = x + w;
    const bottom = y + h;
    return `M${x + rx},${y} H${right - rx} A${rx},${ry} 0 0 1 ${right},${y + ry} V${bottom - ry} A${rx},${ry} 0 0 1 ${right - rx},${bottom} H${x + rx} A${rx},${ry} 0 0 1 ${x},${bottom - ry} V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`;
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

  if (tag === "line") {
    const x1 = parseFloat(el.getAttribute("x1") || "0");
    const y1 = parseFloat(el.getAttribute("y1") || "0");
    const x2 = parseFloat(el.getAttribute("x2") || "0");
    const y2 = parseFloat(el.getAttribute("y2") || "0");
    return `M${x1},${y1} L${x2},${y2}`;
  }

  if (tag === "polygon") {
    const points = el.getAttribute("points");
    if (!points) return null;
    const d = pointsAttrToPathData(points);
    return d ? d + " Z" : null;
  }

  if (tag === "polyline") {
    const points = el.getAttribute("points");
    if (!points) return null;
    return pointsAttrToPathData(points);
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
// Containers whose children are definitions/masking geometry, never directly
// visible content: recursing into them would double-render clip-path/mask
// shapes as if they were real drawable paths (a real pre-existing bug —
// `<defs><clipPath><path .../></clipPath></defs>` used to fall through to
// the generic "recurse into anything" branch below and get collected twice,
// once correctly via `collectClipPaths` and once bogusly as a visible node).
//
// `symbol` is deliberately NOT in this set, even though the SVG spec says a
// `<symbol>`'s content is only rendered once instanced by a `<use>`. `<use>`
// itself is unsupported here (see `UNSUPPORTED_LEAF_TAGS`, warned and
// skipped), so treating `symbol` as non-rendering made a whole class of
// documents — sprite sheets, some Illustrator exports that put their actual
// artwork inside a single `<symbol>` — import as an empty scene with zero
// warning, which is worse than a misplaced-but-visible import for an editor
// whose whole point is letting the user then fix placement by hand. See the
// `symbol` branch below for the tradeoff this makes explicit via a warning.
const NON_RENDERING_CONTAINER_TAGS = new Set(["defs", "clippath", "mask", "pattern", "filter"]);
// Recognized elements this importer cannot convert to a path. Skipped with a
// warning instead of silently vanishing (or, worse, being misread by the
// generic container-recursion fallback).
const UNSUPPORTED_LEAF_TAGS = new Set(["text", "image", "use", "foreignobject"]);

function collectPaths(
  el: Element,
  offsetX: number,
  offsetY: number,
  inherited: InheritedStyle,
  clipPaths: Map<string, ClipPathDef>,
  gradientDefs: Map<string, RawGradientDef>,
  warnings: string[],
  inheritedClipId: string | null = null,
): PathNode[] {
  const results: PathNode[] = [];

  function createPathNode(
    d: string,
    bbox: { x: number; y: number; width: number; height: number },
    fill: string | undefined,
    fillGradient: GradientFill | undefined,
    localClipId: string | null,
    resolvedFillRule: string | undefined,
    resolvedOpacity: string | undefined,
    resolvedFillOpacity: string | undefined,
    resolvedStrokeOpacity: string | undefined,
    resolvedStroke: string | undefined,
    resolvedStrokeWidth: string | undefined,
    resolvedLinejoin: string | undefined,
    resolvedLinecap: string | undefined,
  ): PathNode {
    // Keep thin strokes accurate (e.g. vertical bars with near-zero bbox width),
    // but avoid zero dimensions that would break scaling in the path renderer.
    const EPS = 1e-3;
    const safeGeomWidth = Math.max(EPS, bbox.width);
    const safeGeomHeight = Math.max(EPS, bbox.height);
    const node: PathNode = {
      id: generateId(),
      type: "path",
      name: "Vector",
      x: bbox.x + offsetX,
      y: bbox.y + offsetY,
      width: safeGeomWidth,
      height: safeGeomHeight,
      geometry: d,
      fill,
      geometryBounds: { x: bbox.x, y: bbox.y, width: safeGeomWidth, height: safeGeomHeight },
    };
    if (fillGradient) node.gradientFill = fillGradient;

    if (localClipId) {
      const clipDef = clipPaths.get(localClipId);
      if (clipDef) {
        node.clipGeometry = clipDef.geometry;
        node.clipBounds = clipDef.bounds;
      }
    }

    if (resolvedFillRule === "evenodd" || resolvedFillRule === "nonzero") {
      node.fillRule = resolvedFillRule;
    }
    if (resolvedOpacity != null) node.opacity = parseFloat(resolvedOpacity);
    if (resolvedFillOpacity != null) node.fillOpacity = parseFloat(resolvedFillOpacity);
    if (resolvedStrokeOpacity != null) node.strokeOpacity = parseFloat(resolvedStrokeOpacity);

    if (resolvedStroke) {
      node.pathStroke = {
        fill: resolvedStroke,
        thickness: resolvedStrokeWidth ? parseFloat(resolvedStrokeWidth) : 1,
        join: resolvedLinejoin || "round",
        cap: resolvedLinecap || "round",
        align: "center",
      };
    }
    return node;
  }

  function splitIntoSubpaths(pathData: string): string[] {
    const chunks = pathData.match(/[Mm][^Mm]*/g);
    if (!chunks || chunks.length <= 1) return [pathData];
    return chunks.map((chunk) => chunk.trim()).filter(Boolean);
  }

  const shapeTagNames = new Set(["path", "rect", "circle", "ellipse", "line", "polygon", "polyline"]);

  for (const child of Array.from(el.children)) {
    const childTag = child.tagName.toLowerCase();

    // Definitions/masking containers are harvested separately (gradients,
    // clip-paths) — recursing into them would re-collect their shape
    // children as bogus visible content.
    if (NON_RENDERING_CONTAINER_TAGS.has(childTag)) continue;

    if (UNSUPPORTED_LEAF_TAGS.has(childTag)) {
      warnings.push(`Skipped unsupported <${childTag}> element (not convertible to a vector path).`);
      continue;
    }

    try {
      // Check for clip-path on this element (inherits to children)
      const localClipId = parseClipPathUrl(child.getAttribute("clip-path")) ?? inheritedClipId;

      if (shapeTagNames.has(childTag)) {
        const d = shapeToPathData(child);
        if (!d) continue;

        // Resolve fill and stroke with inheritance
        const localFill = getAttrOrStyle(child, "fill");
        const localStroke = getAttrOrStyle(child, "stroke");
        const resolvedFill = resolveInheritedColor(localFill, inherited.fill);
        let resolvedStroke = resolveInheritedColor(localStroke, inherited.stroke);
        const resolvedStrokeWidth = getAttrOrStyle(child, "stroke-width") ?? inherited.strokeWidth;
        const resolvedLinejoin = getAttrOrStyle(child, "stroke-linejoin") ?? inherited.strokeLinejoin;
        const resolvedLinecap = getAttrOrStyle(child, "stroke-linecap") ?? inherited.strokeLinecap;

        if (resolvedStroke && /^url\(/i.test(resolvedStroke)) {
          warnings.push(`Element <${childTag}> uses an unsupported gradient/pattern stroke; used a solid fallback color instead.`);
          resolvedStroke = "#808080";
        }

        // Resolve opacity values with inheritance
        const localOpacity = getAttrOrStyle(child, "opacity");
        const localFillOpacity = getAttrOrStyle(child, "fill-opacity");
        const localStrokeOpacity = getAttrOrStyle(child, "stroke-opacity");
        const resolvedOpacity = localOpacity ?? inherited.opacity;
        const resolvedFillOpacity = localFillOpacity ?? inherited.fillOpacity;
        const resolvedStrokeOpacity = localStrokeOpacity ?? inherited.strokeOpacity;
        const resolvedFillRule = getAttrOrStyle(child, "fill-rule") ?? inherited.fillRule;
        const fillGradientId = parseGradientUrl(resolvedFill);
        const gradientDef = fillGradientId ? gradientDefs.get(fillGradientId) : undefined;
        let hasSolidFill = !!resolvedFill && !fillGradientId;
        let effectiveFill = hasSolidFill ? resolvedFill : undefined;

        // A `url(#id)` fill that doesn't resolve (unsupported paint type like
        // a pattern/mesh gradient, or a dangling reference) must never drop
        // the shape — fall back to a solid color and say so.
        if (fillGradientId && !gradientDef) {
          warnings.push(`Element <${childTag}> references unresolved paint "url(#${fillGradientId})"; used a solid fallback color instead.`);
          effectiveFill = "#808080";
          hasSolidFill = true;
        }

        // Skip fully invisible paths (no fill AND no stroke)
        if (!hasSolidFill && !gradientDef && !resolvedStroke) continue;

        const shouldSplitSubpaths =
          !!resolvedStroke &&
          !hasSolidFill &&
          !gradientDef &&
          (d.match(/[Mm]/g)?.length ?? 0) > 1;
        const pathParts = shouldSplitSubpaths ? splitIntoSubpaths(d) : [d];

        for (let part of pathParts) {
          let bbox = getPathBBox(part);
          // Skip zero-size paths (e.g. bounding box rectangles like "M0 0h24v24H0z")
          if (bbox.width === 0 && bbox.height === 0) continue;

          // Detect dot/point paths (near-zero area, e.g. from <line x1=9 y1=9 x2=9.01 y2=9>).
          // In SVG these render as filled circles via stroke-linecap:round.
          // Convert to a filled circle path using stroke color as fill, no stroke.
          const isDot = bbox.width < 0.5 && bbox.height < 0.5 && resolvedStroke;
          if (isDot) {
            const sw = resolvedStrokeWidth ? parseFloat(resolvedStrokeWidth) : 1;
            const r = sw / 2;
            const cx = bbox.x + bbox.width / 2;
            const cy = bbox.y + bbox.height / 2;
            const k = 0.5522847498;
            part = `M${cx - r},${cy} C${cx - r},${cy - k * r} ${cx - k * r},${cy - r} ${cx},${cy - r} C${cx + k * r},${cy - r} ${cx + r},${cy - k * r} ${cx + r},${cy} C${cx + r},${cy + k * r} ${cx + k * r},${cy + r} ${cx},${cy + r} C${cx - k * r},${cy + r} ${cx - r},${cy + k * r} ${cx - r},${cy} Z`;
            bbox = getPathBBox(part);
          }

          // Resolve the gradient against THIS part's own bbox — not the SVG
          // viewport — now that it is finally known. See
          // `resolveGradientForShape`'s doc comment for why this can't
          // happen once, up front, for a `userSpaceOnUse` gradient.
          const fillGradient = gradientDef ? resolveGradientForShape(gradientDef, bbox) : undefined;

          results.push(createPathNode(
            part,
            bbox,
            // For dots, use stroke color as fill (SVG renders dots as filled circles)
            isDot ? resolvedStroke : effectiveFill,
            fillGradient,
            localClipId,
            resolvedFillRule,
            resolvedOpacity,
            resolvedFillOpacity,
            resolvedStrokeOpacity,
            // For dots, remove stroke (the fill circle already represents the dot)
            isDot ? undefined : resolvedStroke,
            isDot ? undefined : resolvedStrokeWidth,
            resolvedLinejoin,
            resolvedLinecap,
          ));
        }
      } else if (child.tagName === "g") {
        // Known limitation: only `translate` is honored on `<g>` — `scale`/
        // `rotate`/`matrix` on a group are ignored (the group's children keep
        // their original size/orientation). QuiverAI itself never emits `<g>`
        // (verified against three real generations), so this only affects
        // the file-drop import path for hand-authored/Figma-exported SVGs.
        // Baking a general transform into `PathNode.geometry` correctly
        // (arcs in particular) needs a full path-data tokenizer/rewriter,
        // which is a much larger, separate change — left as future work
        // rather than risking the working translate-only path here.
        const { tx, ty } = getGroupTranslate(child as SVGElement);
        const transformAttr = child.getAttribute("transform");
        if (transformAttr && hasNonTranslateTransformFunction(transformAttr)) {
          warnings.push(`<g transform="${transformAttr}"> uses scale/rotate/matrix, which is not baked into child geometry (only translation is applied).`);
        }
        const childStyle = getInheritedStyle(child, inherited);
        results.push(...collectPaths(child, offsetX + tx, offsetY + ty, childStyle, clipPaths, gradientDefs, warnings, localClipId));
      } else if (childTag === "symbol") {
        // Per spec this content is invisible until a `<use>` instances it,
        // but `<use>` is unsupported here (skipped with its own warning
        // below), so honoring the spec literally would silently import
        // nothing for a document whose real content lives entirely inside a
        // `<symbol>`. Importing it directly — at the symbol's own
        // coordinates, un-repeated, un-transformed by whatever `<use>`
        // would have applied — is a deliberate tradeoff: misplaced but
        // visible beats correct-per-spec but empty for this editor.
        warnings.push(
          `<symbol${child.getAttribute("id") ? ` id="${child.getAttribute("id")}"` : ""}> content was imported directly; any <use> that would normally position/scale/repeat it is not supported, so placement may not match the original file.`,
        );
        const childStyle = getInheritedStyle(child, inherited);
        results.push(...collectPaths(child, offsetX, offsetY, childStyle, clipPaths, gradientDefs, warnings, localClipId));
      } else {
        // Recurse into other elements (like <svg>, <a>, <switch>, etc.)
        const childStyle = getInheritedStyle(child, inherited);
        results.push(...collectPaths(child, offsetX, offsetY, childStyle, clipPaths, gradientDefs, warnings, localClipId));
      }
    } catch (err) {
      // Never let one malformed element take down the whole document.
      warnings.push(
        `Skipped <${childTag}> due to a parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return results;
}

/**
 * Parse an SVG file string and return scene nodes (PathNodes, possibly wrapped in a GroupNode).
 * Returns a single SceneNode ready to add to the scene, or `null` when the
 * document is unparseable/empty of drawable content — this never throws.
 *
 * `warnings` is additive (existing callers that only destructure
 * `{ node, svgWidth, svgHeight }` are unaffected): it reports non-fatal
 * degradations — unresolved paint references falling back to a solid color,
 * an elliptical radial gradient approximated as a circle, unsupported
 * elements skipped, or a `<g>` transform whose scale/rotate component
 * couldn't be baked in (see `collectPaths`'s known limitation there).
 */
/** Read an SVG's own intrinsic size from its `viewBox` (preferred) or its
 * `width`/`height` attributes, falling back to 100x100 when neither is
 * present or parseable — the same default `parseSvgToNodes` has always
 * used. Factored out so callers that only need the size (the live preview
 * layer's uniform-fit calculation) don't have to duplicate this parsing or
 * run the full node conversion. */
function getSvgElementIntrinsicSize(svgEl: Element): { width: number; height: number } {
  let width = 100;
  let height = 100;

  const viewBox = svgEl.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      width = parts[2];
      height = parts[3];
    }
  } else {
    const w = svgEl.getAttribute("width");
    const h = svgEl.getAttribute("height");
    if (w) width = parseFloat(w) || 100;
    if (h) height = parseFloat(h) || 100;
  }

  return { width, height };
}

/**
 * Text-parsing wrapper around `getSvgElementIntrinsicSize`, for callers that
 * only have the raw SVG string — e.g. the `generate_vector` live preview,
 * which rasterizes a streamed SVG prefix and needs its natural size to fit
 * it the same way the eventual committed scene nodes will be fit (see
 * `computeUniformFit` in `lib/quiverVector/fit.ts`). Returns `null` rather
 * than throwing on unparseable input, same convention as `parseSvgToNodes`.
 */
export function getSvgIntrinsicSize(svgText: string): { width: number; height: number } | null {
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svgEl = doc.querySelector("svg");
    return svgEl ? getSvgElementIntrinsicSize(svgEl) : null;
  } catch {
    return null;
  }
}

export function parseSvgToNodes(
  svgText: string,
): { node: SceneNode; svgWidth: number; svgHeight: number; warnings: string[] } | null {
  const warnings: string[] = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");

    const svgEl = doc.querySelector("svg");
    if (!svgEl) return null;

    // Get SVG dimensions from viewBox or width/height attributes
    const { width: svgWidth, height: svgHeight } = getSvgElementIntrinsicSize(svgEl);

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

    // Collect clip-path and gradient definitions from <defs>
    const clipPathDefs = collectClipPaths(doc);
    const gradientDefs = collectLinearGradients(doc, svgWidth, svgHeight);
    const radialGradientDefs = collectRadialGradients(doc, svgWidth, svgHeight, warnings);
    for (const [id, gradient] of radialGradientDefs) gradientDefs.set(id, gradient);

    const pathNodes = collectPaths(svgEl, 0, 0, rootStyle, clipPathDefs, gradientDefs, warnings, null);
    if (pathNodes.length === 0) return null;

    if (pathNodes.length === 1) {
      return { node: pathNodes[0], svgWidth, svgHeight, warnings };
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

    return { node: group, svgWidth, svgHeight, warnings };
  } catch {
    // Never throw on malformed input — treat as "nothing importable".
    return null;
  }
}
