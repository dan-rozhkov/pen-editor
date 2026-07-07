import type { LineCapShape } from "@/types/scene";

export type { LineCapShape };

/**
 * Local-space cap primitive geometry, shared by the Pixi renderer
 * (`@/pixi/renderers/lineRenderer`) and the SVG exporters
 * (`@/lib/designToSvg/convertNode`, `@/lib/designToHtml/svgGeneration`).
 *
 * All shapes are built in a local coordinate system where the endpoint sits
 * at the origin (0, 0) and "outward" (away from the line, in the direction a
 * viewer reading the arrow would call "forward") is +x. Consumers rotate this
 * primitive so +x aligns with the line's direction of travel at that end,
 * then translate it onto the endpoint's world coordinates. Because the tip
 * sits at the origin and the body extends toward -x (back along the line),
 * the same local geometry also works unrotated as an SVG `<marker>` with
 * `orient="auto"` (end) / `orient="auto-start-reverse"` (start) — both
 * conventions place the marker's local +x axis along the outward direction.
 */
export type CapPrimitive =
  | { kind: "lines"; segments: [number, number, number, number][] }
  | { kind: "polygon"; points: number[] }
  | { kind: "circle"; cx: number; cy: number; radius: number };

/**
 * How far the visible line stroke should be trimmed back from the true
 * endpoint so it doesn't visibly poke through a solid cap. Open shapes
 * (`arrow`, `bar`, `none`) need no trim — the line meets the cap's vertex
 * exactly.
 *
 * Derived directly from `buildCapPrimitive`'s own geometry (rather than a
 * second set of hardcoded `w * 3` / `w * 2.8` factors) so the trim can never
 * silently drift out of sync with the primitive it's trimming for.
 */
export function capTrimLength(shape: LineCapShape, strokeWidth: number): number {
  if (shape !== "triangle" && shape !== "circle") return 0;
  const primitive = buildCapPrimitive(shape, strokeWidth);
  if (!primitive) return 0;
  // Unpadded bounds: triangle/circle are filled ("polygon"/"circle" kind),
  // not stroked, so no stroke-width padding applies here regardless.
  return -capPrimitiveBounds(primitive, 0).minX;
}

/** Build the local-space primitive for a cap shape, sized by `strokeWidth`. Returns `null` for `'none'`. */
export function buildCapPrimitive(shape: LineCapShape, strokeWidth: number): CapPrimitive | null {
  const w = Math.max(strokeWidth, 1);
  switch (shape) {
    case "none":
      return null;
    case "arrow": {
      const length = w * 3;
      const spread = w * 1.6;
      return {
        kind: "lines",
        segments: [
          [0, 0, -length, -spread],
          [0, 0, -length, spread],
        ],
      };
    }
    case "triangle": {
      const length = w * 3;
      const spread = w * 1.4;
      return {
        kind: "polygon",
        points: [0, 0, -length, -spread, -length, spread],
      };
    }
    case "circle": {
      const radius = w * 1.4;
      return { kind: "circle", cx: -radius, cy: 0, radius };
    }
    case "bar": {
      const spread = w * 1.8;
      return { kind: "lines", segments: [[0, -spread, 0, spread]] };
    }
    default:
      return null;
  }
}

/** Render a flat `[x1,y1,x2,y2,...]` point list as an SVG `points`/polyline attribute value. */
export function pointsAttr(points: number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i < points.length; i += 2) {
    pairs.push(`${points[i]},${points[i + 1]}`);
  }
  return pairs.join(" ");
}

export interface CapMarkerBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/**
 * Bounding box of a cap primitive in local marker coordinates (the tip is
 * always at the origin — see the module docs above). "lines"-kind
 * primitives are stroked (not filled), so their geometric bbox is padded by
 * half the stroke width on every side: otherwise an SVG `<marker>`'s
 * default `overflow: hidden` viewport shaves the stroke, and the "bar" cap
 * (a single segment with all x=0) would report a zero-width box entirely,
 * which makes `markerWidth="0"` and suppresses rendering per spec.
 *
 * `strokeWidth` here is the literal padding amount (not run through
 * `buildCapPrimitive`'s own `Math.max(strokeWidth, 1)` floor) — callers that
 * want padding to match the rendered geometry should pass the same floored
 * value they passed to `buildCapPrimitive`; pass `0` for unpadded bounds.
 */
export function capPrimitiveBounds(primitive: CapPrimitive, strokeWidth: number): CapMarkerBounds {
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
  let minX = Math.min(...xs);
  let minY = Math.min(...ys);
  let maxX = Math.max(...xs);
  let maxY = Math.max(...ys);
  if (primitive.kind === "lines") {
    const pad = Math.max(strokeWidth, 0) / 2;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Build a full SVG `<marker>` element definition for one line endpoint's cap
 * shape, or `null` for `'none'`. Shared by both SVG export paths
 * (`@/lib/designToSvg/shapeStyles`, `@/lib/designToHtml/svgGeneration`) so
 * the anchor/overflow fixes only need to exist in one place.
 *
 * `refX`/`refY` are `"0"`: per the SVG spec, `refX`/`refY` are expressed in
 * the marker's own `viewBox` coordinate system, and the cap primitive's tip
 * always sits at local `(0, 0)` regardless of the viewBox's origin — so no
 * translation by `-bounds.minX/minY` is needed (that had been anchoring the
 * marker (minX, minY) away from the line endpoint). `overflow="visible"`
 * plus the stroke-padded viewBox from `capPrimitiveBounds` keep stroked caps
 * ("arrow", "bar") from being clipped by the marker's default clip box.
 */
export function buildCapMarkerDef(
  id: string,
  shape: LineCapShape,
  strokeWidth: number,
  color: string,
  orient: "auto" | "auto-start-reverse",
): string | null {
  const primitive = buildCapPrimitive(shape, strokeWidth);
  if (!primitive) return null;

  // Match the floor `buildCapPrimitive` applies internally so the padding
  // added here lines up with the geometry actually drawn.
  const bounds = capPrimitiveBounds(primitive, Math.max(strokeWidth, 1));
  const inner =
    primitive.kind === "lines"
      ? primitive.segments
          .map(
            ([x1, y1, x2, y2]) =>
              `<path d="M${x1},${y1} L${x2},${y2}" stroke="${color}" stroke-width="${strokeWidth}" fill="none"/>`,
          )
          .join("")
      : primitive.kind === "polygon"
        ? `<polygon points="${pointsAttr(primitive.points)}" fill="${color}"/>`
        : `<circle cx="${primitive.cx}" cy="${primitive.cy}" r="${primitive.radius}" fill="${color}"/>`;

  return `<marker id="${id}" markerWidth="${bounds.width}" markerHeight="${bounds.height}" refX="0" refY="0" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" markerUnits="userSpaceOnUse" orient="${orient}" overflow="visible">${inner}</marker>`;
}
