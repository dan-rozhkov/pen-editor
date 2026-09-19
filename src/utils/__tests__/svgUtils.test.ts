import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { parseSvgToNodes } from "../svgUtils";
import { stubSvgGetBBox } from "@/test/svgGetBBoxStub";
import type { PathNode, GroupNode, SceneNode } from "@/types/scene";

function readFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

function flatten(node: SceneNode): PathNode[] {
  if (node.type === "path") return [node];
  if (node.type === "group") return node.children.flatMap(flatten);
  return [];
}

beforeEach(() => {
  // happy-dom's SVGGraphicsElement.getBBox() always returns 0x0 (no layout
  // engine) — see src/test/svgGetBBoxStub.ts's doc comment. It measures
  // straight-line (M/L/Z) geometry exactly by pairing consecutive numbers,
  // but is NOT curve-aware, so any assertion on a curved shape's exact
  // bounds below is intentionally avoided in favor of assertions the stub
  // cannot distort (node count, fill/stroke/gradient resolution, `d`
  // passthrough, warnings).
  stubSvgGetBBox();
});

describe("parseSvgToNodes", () => {
  it("passes relative path data through byte-identical (no flattening/reparsing)", () => {
    const d = "m69.64 30.53-1.81-25.86c-8.19 5.69-15.76 11.43-23.12 17.05h-9.4z";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><path d="${d}" fill="#FD720D"/></svg>`;
    const result = parseSvgToNodes(svg);
    expect(result).not.toBeNull();
    const node = result!.node as PathNode;
    expect(node.type).toBe("path");
    expect(node.geometry).toBe(d);
    expect(node.fill).toBe("#FD720D");
  });

  it("computes geometryBounds for every path node", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="4" height="4" fill="#000"/></svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as PathNode;
    expect(node.geometryBounds).toBeDefined();
    expect(node.geometryBounds!.width).toBeGreaterThan(0);
    expect(node.geometryBounds!.height).toBeGreaterThan(0);
  });

  it("bakes <g transform=translate(...)> offsets into children", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <g transform="translate(5,5)">
        <rect x="0" y="0" width="2" height="2" fill="#111"/>
      </g>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as PathNode;
    // `x`/`y` (the node's placement) carry the baked `<g>` translate;
    // `geometryBounds` stays in the untranslated local geometry space (see
    // `createPathNode` in svgUtils.ts) — matching the file-drop path's
    // existing convention for path placement vs. local geometry.
    expect(node.x).toBeCloseTo(5, 5);
    expect(node.y).toBeCloseTo(5, 5);
  });

  it("does not bake <g transform=scale(...)> into geometry, and warns about it (known limitation)", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <g transform="scale(2)">
        <rect x="0" y="0" width="2" height="2" fill="#111"/>
      </g>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as PathNode;
    // Width stays 2 (unscaled) — this is the documented gap, not a silent guess.
    expect(node.geometryBounds!.width).toBeCloseTo(2, 5);
    expect(result!.warnings.some((w) => w.includes("scale/rotate/matrix"))).toBe(true);
  });

  it("warns about scale/rotate/matrix even when translate comes first (finding 7 regression)", () => {
    // `translate(5,5) scale(2)` is common Figma/Illustrator output. The old
    // warning check only inspected whether the WHOLE attribute started with
    // "translate(", so this exact combination — translate present, but not
    // alone — silently dropped the scale with no warning at all.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <g transform="translate(5,5) scale(2)">
        <rect x="0" y="0" width="2" height="2" fill="#111"/>
      </g>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as PathNode;
    // translate is still baked in...
    expect(node.x).toBeCloseTo(5, 5);
    expect(node.y).toBeCloseTo(5, 5);
    // ...but scale is not, and that must now be warned about.
    expect(result!.warnings.some((w) => w.includes("scale/rotate/matrix"))).toBe(true);
  });

  it("bakes a single-argument translate(x) as translate(x, 0) (finding 7 regression)", () => {
    // `translate(10)` is legal SVG (y defaults to 0). The old regex required
    // two arguments and silently read this as {tx: 0, ty: 0} — neither
    // applying the offset nor warning about it.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <g transform="translate(10)">
        <rect x="0" y="0" width="2" height="2" fill="#111"/>
      </g>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as PathNode;
    expect(node.x).toBeCloseTo(10, 5);
    expect(node.y).toBeCloseTo(0, 5);
    // Pure translate (even single-argument) must not warn.
    expect(result!.warnings.some((w) => w.includes("scale/rotate/matrix"))).toBe(false);
  });

  it("converts rect (incl. rx/ry), circle, ellipse, line, polygon, polyline to path geometry", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
      <rect x="0" y="0" width="10" height="10" rx="2" fill="#111"/>
      <circle cx="20" cy="20" r="5" fill="#222"/>
      <ellipse cx="40" cy="40" rx="6" ry="3" fill="#333"/>
      <line x1="0" y1="0" x2="10" y2="10" stroke="#444"/>
      <polygon points="0,0 10,0 5,10" fill="#555"/>
      <polyline points="0,0 5,5 10,0" stroke="#666"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    expect(result).not.toBeNull();
    const nodes = flatten(result!.node);
    expect(nodes.length).toBe(6);
    for (const n of nodes) {
      expect(typeof n.geometry).toBe("string");
      expect(n.geometry.length).toBeGreaterThan(0);
    }
  });

  it("resolves a linearGradient fill reference", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#111111"/>
          <stop offset="1" stop-color="#222222"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="10" height="10" fill="url(#g1)"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as PathNode;
    expect(node.gradientFill).toBeDefined();
    expect(node.gradientFill!.type).toBe("linear");
    expect(node.gradientFill!.stops.map((s) => s.color)).toEqual(["#111111", "#222222"]);
  });

  it("resolves a radialGradient fill reference (with gradientUnits=userSpaceOnUse)", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <defs>
        <radialGradient id="r1" cx="40" cy="40" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#FFF6E0"/>
          <stop offset="1" stop-color="#F8CB72"/>
        </radialGradient>
      </defs>
      <circle cx="40" cy="40" r="30" fill="url(#r1)"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    expect(result).not.toBeNull();
    const node = result!.node as PathNode;
    expect(node.gradientFill).toBeDefined();
    expect(node.gradientFill!.type).toBe("radial");
    expect(node.gradientFill!.startX).toBeCloseTo(0.5, 3);
    expect(node.gradientFill!.startY).toBeCloseTo(0.5, 3);
    // A `userSpaceOnUse` gradient must be normalized against the referencing
    // SHAPE's own bbox, not the SVG viewport (finding 1). The circle's bbox
    // is x:[10,70] y:[10,70] — 60x60 — so its radius (30) is 30/60 = 0.5 of
    // that bbox, not 30/80 = 0.375 of the 80x80 viewport (the old, wrong
    // value this test used to assert).
    expect(node.gradientFill!.endRadius).toBeCloseTo(30 / 60, 3);
  });

  it("normalizes a userSpaceOnUse gradient against the shape's bbox, not the SVG viewport (finding 1 regression)", () => {
    // A small shape positioned away from the origin, in a much larger
    // viewport — the case where normalizing against the viewport instead of
    // the shape's own bbox produces a visibly wrong result rather than one
    // that happens to look reasonable by coincidence (as a centered circle
    // does above). The gradient exactly covers the rect (cx/cy at its
    // center, r = half its width), so a correct shape-local result is
    // always startX=startY=0.5, endRadius=0.5, regardless of viewport size
    // or the shape's position within it.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
      <defs>
        <radialGradient id="r1" cx="70" cy="70" r="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff"/>
          <stop offset="1" stop-color="#000"/>
        </radialGradient>
      </defs>
      <rect x="60" y="60" width="20" height="20" fill="url(#r1)"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as PathNode;
    expect(node.gradientFill!.startX).toBeCloseTo(0.5, 3);
    expect(node.gradientFill!.startY).toBeCloseTo(0.5, 3);
    expect(node.gradientFill!.endRadius).toBeCloseTo(0.5, 3);
  });

  it("normalizes a userSpaceOnUse LINEAR gradient against the shape's bbox, not the SVG viewport (finding 1 regression)", () => {
    // Same bug, `collectLinearGradients` had it too. A gradient spanning
    // exactly across a small, off-origin rect must resolve to
    // startX=0,endX=1 in shape-local space, not some fraction of the much
    // larger viewport.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="g1" x1="60" y1="70" x2="80" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#111111"/>
          <stop offset="1" stop-color="#222222"/>
        </linearGradient>
      </defs>
      <rect x="60" y="60" width="20" height="20" fill="url(#g1)"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as PathNode;
    expect(node.gradientFill!.type).toBe("linear");
    expect(node.gradientFill!.startX).toBeCloseTo(0, 3);
    expect(node.gradientFill!.startY).toBeCloseTo(0.5, 3);
    expect(node.gradientFill!.endX).toBeCloseTo(1, 3);
    expect(node.gradientFill!.endY).toBeCloseTo(0.5, 3);
  });

  it("bakes gradientTransform into a radialGradient (real QuiverAI shape) and approximates ellipticity with a warning", () => {
    // Real fixture: unit gradient (cx=0,cy=0,r=1) positioned/scaled via
    // gradientTransform — the exact pattern QuiverAI emits for a radial glow.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <defs>
        <radialGradient id="paint0_radial_3032_56637" cx="0" cy="0" r="1" gradientTransform="translate(39.99 39.45) rotate(-.01737) scale(27.84 27.38)" gradientUnits="userSpaceOnUse">
          <stop stop-color="#FFF6E0" offset="0"/>
          <stop stop-color="#FFF1D3" offset=".5259"/>
          <stop stop-color="#F8CB72" offset="1"/>
        </radialGradient>
      </defs>
      <circle cx="39.99" cy="39.45" r="27.83" fill="url(#paint0_radial_3032_56637)"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    expect(result).not.toBeNull();
    const node = result!.node as PathNode;
    expect(node.gradientFill).toBeDefined();
    expect(node.gradientFill!.type).toBe("radial");
    // The circle's bbox is centered exactly on the gradient's own center in
    // this fixture (both at 39.99,39.45), so bbox-relative center lands at
    // 0.5,0.5 regardless of the viewport — NOT close to (40,40)/80 (~0.5
    // anyway here, but for the wrong reason: that was normalizing against
    // an 80x80 viewport that only coincidentally has a similar scale to the
    // circle's own ~55.66-wide bbox). Finding 1's fix makes bbox-relative
    // normalization exact rather than viewport-coincidental.
    expect(node.gradientFill!.startX).toBeCloseTo(0.5, 3);
    expect(node.gradientFill!.startY).toBeCloseTo(0.5, 3);
    // Radius is normalized against the circle's own bbox width (2*27.83 =
    // 55.66), not the 80-wide viewport: ~27.6/55.66 ≈ 0.496, not the
    // previous (wrong) ~27.6/80 ≈ 0.345.
    expect(node.gradientFill!.endRadius).toBeCloseTo(27.6 / 55.66, 2);
    expect(node.gradientFill!.stops.length).toBe(3);
  });

  it("falls back to a solid color (with a warning) when a fill reference can't be resolved instead of dropping the shape", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
      <rect x="0" y="0" width="5" height="5" fill="url(#missing)"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    expect(result).not.toBeNull();
    const node = result!.node as PathNode;
    expect(node.fill).toBeDefined();
    expect(node.gradientFill).toBeUndefined();
    expect(result!.warnings.some((w) => w.includes("unresolved paint"))).toBe(true);
  });

  it("keeps only the stroke when fill=none", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="0" y="0" width="5" height="5" stroke="#123456" stroke-width="1"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as PathNode;
    expect(node.fill).toBeUndefined();
    expect(node.pathStroke).toBeDefined();
    expect(node.pathStroke!.fill).toBe("#123456");
  });

  it("composes opacity / fill-opacity / stroke-opacity onto the node", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
      <rect x="0" y="0" width="5" height="5" fill="#000" stroke="#fff" opacity="0.5" fill-opacity="0.7" stroke-opacity="0.3"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as PathNode;
    expect(node.opacity).toBeCloseTo(0.5);
    expect(node.fillOpacity).toBeCloseTo(0.7);
    expect(node.strokeOpacity).toBeCloseTo(0.3);
  });

  it("does not throw on malformed/garbage input and returns null", () => {
    expect(() => parseSvgToNodes("not xml at all <<<>")).not.toThrow();
    expect(parseSvgToNodes("not xml at all <<<>")).toBeNull();
    expect(() => parseSvgToNodes("")).not.toThrow();
  });

  it("skips one malformed/unsupported element without losing the rest of the document", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <image href="broken.png" width="5" height="5"/>
      <rect x="0" y="0" width="5" height="5" fill="#000"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    expect(result).not.toBeNull();
    const nodes = flatten(result!.node);
    expect(nodes.length).toBe(1);
    expect(result!.warnings.some((w) => w.includes("image"))).toBe(true);
  });

  it("does not double-render <clipPath> contents living in <defs> as visible shapes", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <defs>
        <clipPath id="c1">
          <rect x="0" y="0" width="20" height="20"/>
        </clipPath>
      </defs>
      <rect x="0" y="0" width="5" height="5" fill="#000" clip-path="url(#c1)"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const nodes = flatten(result!.node);
    // Only the one real visible rect — not a second copy from the clipPath's
    // own <rect>, which is definition geometry, not drawable content.
    expect(nodes.length).toBe(1);
    expect(nodes[0].clipGeometry).toBeDefined();
  });

  it("imports <symbol> content directly, with a placement caveat warning, instead of returning nothing (finding 9)", () => {
    // Per spec a <symbol>'s content only renders once a <use> instances it,
    // and <use> is unsupported here — but treating <symbol> as pure
    // non-rendering geometry (like <defs>/<clipPath>) made a whole document
    // whose real content lives inside one <symbol> import as an EMPTY scene
    // with no warning at all, which is worse than a misplaced-but-visible
    // import for an editor whose point is letting the user fix placement by
    // hand afterward.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <symbol id="icon-star" viewBox="0 0 24 24">
        <rect x="2" y="2" width="10" height="10" fill="#111"/>
      </symbol>
      <use href="#icon-star" x="0" y="0"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    expect(result).not.toBeNull();
    const nodes = flatten(result!.node);
    // The symbol's own rect is imported directly...
    expect(nodes.length).toBe(1);
    expect(nodes[0].fill).toBe("#111");
    // ...with a warning that <use>'s positioning/repeat/scale isn't honored.
    expect(result!.warnings.some((w) => w.includes("<symbol") && w.includes("<use>"))).toBe(true);
    // The unsupported <use> element still gets its own separate warning.
    expect(result!.warnings.some((w) => w.includes("use"))).toBe(true);
  });

  it("end-to-end: real QuiverAI 3-shape sample (rect + 2 relative-notation paths)", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
  <rect x="1.428" width="77.14" height="80" fill="#FFFAF3"/>
  <path d="m69.64 30.53-1.81-25.86c-8.19 5.69-15.76 11.43-23.12 17.05h-9.4c-7.49-5.84-15.22-11.5-23.07-17.05l-1.85 25.86 5.28 5.99-9.5 11.54 24.85 19.18 1.49 2.03 0.88 1.06 6.62 4.96 6.63-4.96 0.88-1.06 1.49-2.03 24.85-19.18-9.55-11.54 5.33-5.99z" fill="#FD720D"/>
  <path d="m18.04 44.12-11.87 3.94 24.85 19.18-4.67-13.8-8.31-9.32z" fill="#D94F06"/>
</svg>`;
    const result = parseSvgToNodes(svg);
    expect(result).not.toBeNull();
    expect(result!.svgWidth).toBe(80);
    expect(result!.svgHeight).toBe(80);
    const nodes = flatten(result!.node);
    expect(nodes.length).toBe(3);
    expect(nodes.map((n) => n.fill).sort()).toEqual(["#D94F06", "#FD720D", "#FFFAF3"].sort());
    expect(nodes.find((n) => n.fill === "#FD720D")!.geometry).toContain("c-8.19 5.69");
  });

  it("end-to-end: real QuiverAI circle+linearGradient+stroke sample", () => {
    const svg = readFixture("quiver-linear-gradient.svg");
    const result = parseSvgToNodes(svg);
    expect(result).not.toBeNull();
    const nodes = flatten(result!.node);
    expect(nodes.length).toBeGreaterThan(0);
    const gradientNode = nodes.find((n) => n.gradientFill?.type === "linear");
    expect(gradientNode).toBeDefined();
    expect(gradientNode!.pathStroke?.fill).toBe("#2E3B4F");
    expect(gradientNode!.pathStroke?.thickness).toBeCloseTo(0.7692);
  });

  it("end-to-end: full real QuiverAI 'arrow-2' generation (132 paths, radial gradient, ellipses, strokes)", () => {
    const svg = readFixture("quiver-arrow2.svg");
    const result = parseSvgToNodes(svg);
    expect(result).not.toBeNull();
    const nodes = flatten(result!.node);
    // The stub's curve-blindness drops a handful of curved shapes to a 0x0
    // bbox (documented above and in svgGetBBoxStub.ts) — assert a floor, not
    // the exact live-browser count.
    expect(nodes.length).toBeGreaterThan(100);
    const gradientNode = nodes.find((n) => n.gradientFill?.type === "radial");
    expect(gradientNode).toBeDefined();
    const strokedCount = nodes.filter((n) => n.pathStroke).length;
    expect(strokedCount).toBeGreaterThan(50);
    // Never throws even on this much denser real document.
    expect(result!.warnings).toBeDefined();
  });
});

describe("parseSvgToNodes — group wrapping", () => {
  it("wraps multiple shapes in a GroupNode named 'SVG'", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
      <rect x="0" y="0" width="2" height="2" fill="#000"/>
      <rect x="4" y="4" width="2" height="2" fill="#111"/>
    </svg>`;
    const result = parseSvgToNodes(svg);
    const node = result!.node as GroupNode;
    expect(node.type).toBe("group");
    expect(node.name).toBe("SVG");
    expect(node.children.length).toBe(2);
  });
});
