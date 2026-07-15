import { describe, it, expect } from "vitest";
import { layoutTextOnPath, resolveTextPathDirection } from "../textPathLayout";
import { preparePath } from "../pathMeasure";
import { reverseAnchors } from "../pathAnchors";
import type { PathAnchor, TextNode } from "@/types/scene";

function pathTextNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: "t1",
    type: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    text: "AB",
    fontSize: 16,
    letterSpacing: 0,
    textPath: {
      points: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ],
      closed: false,
      startOffset: 0,
      side: "left",
    },
    ...overrides,
  } as TextNode;
}

const r = 100;
const k = 0.5522847498;
const CIRCLE_POINTS: PathAnchor[] = [
  { x: r, y: 0, handleOut: { x: r, y: r * k }, handleIn: { x: r, y: -r * k } },
  { x: 0, y: r, handleIn: { x: r * k, y: r }, handleOut: { x: -r * k, y: r } },
  { x: -r, y: 0, handleIn: { x: -r, y: r * k }, handleOut: { x: -r, y: -r * k } },
  { x: 0, y: -r, handleIn: { x: -r * k, y: -r }, handleOut: { x: r * k, y: -r } },
];

describe("resolveTextPathDirection", () => {
  it("returns the points/closed/startOffset unchanged when flip is not set", () => {
    const tp = { points: CIRCLE_POINTS, closed: true, startOffset: 0.4, side: "left" as const };
    const result = resolveTextPathDirection(tp);
    expect(result.points).toBe(tp.points);
    expect(result.closed).toBe(true);
    expect(result.startOffset).toBe(0.4);
  });

  it("reverses the points but leaves startOffset unchanged when flip is set", () => {
    // `startOffset` is a fraction along the *effective* (post-flip) direction
    // of travel, so it passes through untouched — remapping it to
    // `1 - startOffset` (an earlier, wrong version of this helper) combined
    // with the default `startOffset: 0` would place the entire string's
    // start at the very end of the path, rendering at most one glyph before
    // overflow cut the rest (see `layoutTextOnPath`'s regression test below).
    const tp = {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      closed: false,
      startOffset: 0.25,
      side: "left" as const,
      flip: true,
    };
    const result = resolveTextPathDirection(tp);
    expect(result.points).toEqual([
      { x: 100, y: 0, handleIn: null, handleOut: null },
      { x: 0, y: 0, handleIn: null, handleOut: null },
    ]);
    expect(result.startOffset).toBeCloseTo(0.25, 10);
  });
});

describe("layoutTextOnPath — flip (finding 1 regression)", () => {
  it("reverses BOTH the advance order and the tangent on an open path, matching SVG/Figma flip semantics", () => {
    // A long straight horizontal path with plenty of room on both sides of
    // the midpoint. letterSpacing 0, fontSize 16 -> the test canvas stub
    // measures "A"/"B" at 8px each (see src/test/setup.ts).
    const node = pathTextNode({ text: "AB", textPath: { ...pathTextNode().textPath!, startOffset: 0.5 } });
    const flippedNode = pathTextNode({
      text: "AB",
      textPath: { ...pathTextNode().textPath!, startOffset: 0.5, flip: true },
    });

    const forward = layoutTextOnPath(node)!;
    const flipped = layoutTextOnPath(flippedNode)!;

    // Glyph 0 sits at the same physical point either way (the path's own
    // midpoint) — `flip` only changes what happens from there. (The LUT's
    // arc-length sampling — `@/utils/pathMeasure` — introduces a little
    // sub-pixel noise off exact grid samples, hence the loose tolerance on
    // the non-exact positions below.)
    expect(forward.glyphs[0].x).toBeCloseTo(500, 5);
    expect(flipped.glyphs[0].x).toBeCloseTo(500, 5);

    // Forward: B advances to the right (toward increasing path length),
    // unrotated.
    expect(forward.glyphs[1].x).toBeCloseTo(508, 0);
    expect(forward.glyphs[0].angle).toBeCloseTo(0, 5);

    // Flipped: B must advance to the LEFT of A (reversed reading order) —
    // before the fix, the renderer kept walking forward (B would land at
    // the same +508 as the non-flipped case) while only rotating each
    // glyph by PI in place, which mirrors letters without actually
    // reversing which one comes first (wrong — see finding 1).
    expect(flipped.glyphs[1].x).toBeCloseTo(492, 0);
    expect(flipped.glyphs[1].x).toBeLessThan(flipped.glyphs[0].x);
    // ...and the tangent is rotated by PI relative to the forward case.
    expect(flipped.glyphs[0].angle).toBeCloseTo(Math.PI, 5);
  });

  it("lays out a closed circular path (badges/stamps) by walking the SAME reversed-anchor curve `resolveTextPathDirection`/the SVG exporter use — not just rotating glyphs in place", () => {
    const tp = { points: CIRCLE_POINTS, closed: true, startOffset: 0.3, side: "left" as const, flip: true };
    const node = pathTextNode({ text: "AB", textPath: tp });
    const layout = layoutTextOnPath(node)!;
    expect(layout.glyphs).toHaveLength(2);

    // Ground truth: replay exactly what a browser's `<textPath>` does with
    // the SVG exporter's authored-backward path (`reverseAnchors`), with
    // `startOffset` unchanged — walk the reversed contour forward from
    // `startOffset * totalLength`. Before the fix, `layoutTextOnPath`
    // instead walked the ORIGINAL (unreversed) contour and only rotated
    // each glyph by PI in place, which does not match this at all for a
    // closed curve (the two would land on different points and diverge in
    // opposite rotational directions).
    const reversed = preparePath(reverseAnchors(CIRCLE_POINTS), true);
    const startAdvance = tp.startOffset * reversed.totalLength;
    const expectedGlyph0 = reversed.getPointAtLength(startAdvance);
    const expectedGlyph1 = reversed.getPointAtLength(startAdvance + 8 /* "A"'s measured width */);

    expect(layout.glyphs[0].x).toBeCloseTo(expectedGlyph0.x, 5);
    expect(layout.glyphs[0].y).toBeCloseTo(expectedGlyph0.y, 5);
    expect(layout.glyphs[0].angle).toBeCloseTo(expectedGlyph0.angle, 5);
    expect(layout.glyphs[1].x).toBeCloseTo(expectedGlyph1.x, 5);
    expect(layout.glyphs[1].y).toBeCloseTo(expectedGlyph1.y, 5);
  });
});

describe("layoutTextOnPath — letterSpacing for non-BMP characters (finding 5 regression)", () => {
  it("applies letterSpacing exactly once per glyph, even after an astral (surrogate-pair) character", () => {
    // "😀" is a single Unicode code point but 2 UTF-16 code units — Array.from
    // (code-point aware) yields it as one glyph, but `char.length` (the raw
    // JS string length) is 2, which is what `measureTextWidth` uses to bake
    // in "(text.length - 1) * letterSpacing".
    const node = pathTextNode({
      text: "a\u{1F600}b",
      letterSpacing: 5,
      textPath: { ...pathTextNode().textPath!, startOffset: 0 },
    });

    const layout = layoutTextOnPath(node)!;
    expect(layout.glyphs.map((g) => g.char)).toEqual(["a", "\u{1F600}", "b"]);

    // Test-stub canvas measures `text.length * 8` (see src/test/setup.ts):
    // "a" -> 8, "\u{1F600}" (2 code units) -> 16.
    // Glyph widths (letter-spacing NOT included, per TextPathGlyph's doc
    // comment) must be the raw measured width, not the raw width plus an
    // extra letterSpacing baked in by measureTextWidth's own UTF-16-length
    // based formula.
    expect(layout.glyphs[0].width).toBeCloseTo(8, 5); // "a"
    expect(layout.glyphs[1].width).toBeCloseTo(16, 5); // "😀" (2 code units x 8)
    expect(layout.glyphs[2].width).toBeCloseTo(8, 5); // "b"

    // Advance/x positions: each glyph's x is the previous glyph's x + its
    // width + exactly one letterSpacing. (Loose tolerance: the arc-length
    // LUT — `@/utils/pathMeasure` — introduces a little sub-pixel noise off
    // exact grid samples; that noise is orders of magnitude smaller than the
    // ~1 extra letterSpacing of drift the bug caused.)
    expect(layout.glyphs[0].x).toBeCloseTo(0, 5);
    expect(layout.glyphs[1].x).toBeCloseTo(0 + 8 + 5, 0); // 13
    // Before the fix, the emoji's measured width had one extra letterSpacing
    // baked in (21 instead of 16), so "b" would land at 13 + 21 + 5 = 39
    // instead of the correct 13 + 16 + 5 = 34 — drifting every glyph after
    // an emoji by one extra letterSpacing.
    expect(layout.glyphs[2].x).toBeCloseTo(13 + 16 + 5, 0); // 34
  });
});
