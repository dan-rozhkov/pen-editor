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
 * (`arrow`, `none`) need no trim — the line meets the cap's vertex exactly.
 */
export function capTrimLength(shape: LineCapShape, strokeWidth: number): number {
  const w = Math.max(strokeWidth, 1);
  switch (shape) {
    case "triangle":
      return w * 3;
    case "circle":
      return w * 2.8;
    case "bar":
    case "arrow":
    case "none":
    default:
      return 0;
  }
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
