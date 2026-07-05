import type { Polygon } from "martinez-polygon-clipping";

export interface PathBuildResult {
  /** SVG path "d" string, always intended to be filled with fill-rule="evenodd". */
  geometry: string;
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Build an SVG path "d" string (and its bounding box) from a boolean-op result
 * MultiPolygon. Every ring (exterior or hole) becomes its own "M ... Z"
 * subpath; `fillRule: "evenodd"` on the resulting node makes holes render
 * correctly regardless of ring winding direction.
 */
export function polygonsToPath(polygons: Polygon[]): PathBuildResult | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const subpaths: string[] = [];

  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      let d = "";
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = ring[i];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
      }
      d += " Z";
      subpaths.push(d);
    }
  }

  if (subpaths.length === 0 || !Number.isFinite(minX)) return null;

  return {
    geometry: subpaths.join(" "),
    bounds: { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) },
  };
}
