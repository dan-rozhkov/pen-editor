import { vi } from "vitest";

/**
 * happy-dom's `SVGGraphicsElement.getBBox()` always returns a zero-size rect
 * (no real layout engine to measure against — see
 * node_modules/happy-dom/lib/nodes/svg-graphics-element/SVGGraphicsElement.js).
 * `svgUtils.ts`'s `getPathBBox` calls the real DOM method on an offscreen
 * `<path>`, so any test exercising `parseSvgToNodes` (which measures every
 * shape this way) needs a stand-in, or every shape's bbox comes back
 * 0x0 and gets silently dropped.
 *
 * Good enough for path data built only from M/L/Z commands (straight-line
 * shapes — what `<rect>` without rx/ry produces, the common case in tests):
 * pairs up every two numbers in the `d` attribute as an (x,y) point and
 * takes their bounding box. Does not handle curve commands (A/C) correctly
 * — a rounded rect or circle/ellipse fixture needs a more precise stub.
 *
 * Call once per test (or in `beforeEach`); it's a `vi.spyOn` and is undone
 * automatically by `vi.restoreAllMocks()` / a fresh per-file environment.
 */
export function stubSvgGetBBox(): void {
  const proto = (
    globalThis as unknown as {
      SVGGraphicsElement: { prototype: { getBBox: (this: Element) => unknown } };
    }
  ).SVGGraphicsElement.prototype;

  vi.spyOn(proto, "getBBox").mockImplementation(function (this: Element) {
    const d = this.getAttribute("d") ?? "";
    const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      minX = Math.min(minX, nums[i]);
      maxX = Math.max(maxX, nums[i]);
      minY = Math.min(minY, nums[i + 1]);
      maxY = Math.max(maxY, nums[i + 1]);
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  });
}
