import { describe, expect, it } from "vitest";
import { buildSquircleRectPath } from "../squircleCorner";

const uniformRadii = (r: number) => ({
  topLeft: r,
  topRight: r,
  bottomRight: r,
  bottomLeft: r,
});

/** Extract the 3 segments (cubic, arc, cubic) built for one corner, by index (0=topRight,1=bottomRight,2=bottomLeft,3=topLeft). */
function cornerSegments(segments: ReturnType<typeof buildSquircleRectPath>["segments"], cornerIndex: number) {
  // Each corner is preceded by exactly one "line" segment (the edge leading into it).
  const lineIndices = segments.reduce<number[]>((acc, seg, i) => {
    if (seg.type === "line") acc.push(i);
    return acc;
  }, []);
  const lineIdx = lineIndices[cornerIndex];
  return segments.slice(lineIdx + 1, lineIdx + 4);
}

describe("buildSquircleRectPath", () => {
  it("degenerates to plain 90deg arcs (no bezier flare) when cornerSmoothing = 0", () => {
    const { segments } = buildSquircleRectPath(200, 100, uniformRadii(20), 0);

    for (let corner = 0; corner < 4; corner++) {
      const [cubic1, arc, cubic2] = cornerSegments(segments, corner);
      expect(cubic1.type).toBe("cubic");
      expect(arc.type).toBe("arc");
      expect(cubic2.type).toBe("cubic");

      if (cubic1.type === "cubic") {
        // Control points collapse onto the endpoint - a straight line in disguise.
        expect(cubic1.cp1x).toBeCloseTo(cubic1.x, 5);
        expect(cubic1.cp1y).toBeCloseTo(cubic1.y, 5);
        expect(cubic1.cp2x).toBeCloseTo(cubic1.x, 5);
        expect(cubic1.cp2y).toBeCloseTo(cubic1.y, 5);
      }
      if (arc.type === "arc") {
        expect(arc.radius).toBeCloseTo(20, 5);
        let delta = arc.endAngle - arc.startAngle;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        // Full quarter circle, same as the old arcTo-based corner.
        expect(Math.abs(delta)).toBeCloseTo(Math.PI / 2, 5);
      }
    }
  });

  it("produces a different (non-degenerate) curve at cornerSmoothing = 0.6", () => {
    const zero = buildSquircleRectPath(200, 100, uniformRadii(20), 0);
    const smoothed = buildSquircleRectPath(200, 100, uniformRadii(20), 0.6);

    const [cubic1Zero] = cornerSegments(zero.segments, 0);
    const [cubic1Smoothed] = cornerSegments(smoothed.segments, 0);

    expect(cubic1Zero.type).toBe("cubic");
    expect(cubic1Smoothed.type).toBe("cubic");
    if (cubic1Zero.type === "cubic" && cubic1Smoothed.type === "cubic") {
      // The smoothed corner's first control point should no longer sit on the
      // straight-line degenerate position.
      expect(
        Math.abs(cubic1Smoothed.cp1x - cubic1Smoothed.x) +
          Math.abs(cubic1Smoothed.cp1y - cubic1Smoothed.y),
      ).toBeGreaterThan(0.5);
      expect(cubic1Smoothed).not.toEqual(cubic1Zero);
    }

    const [, arcZero] = cornerSegments(zero.segments, 0);
    const [, arcSmoothed] = cornerSegments(smoothed.segments, 0);
    if (arcZero.type === "arc" && arcSmoothed.type === "arc") {
      let deltaZero = arcZero.endAngle - arcZero.startAngle;
      let deltaSmoothed = arcSmoothed.endAngle - arcSmoothed.startAngle;
      while (deltaZero > Math.PI) deltaZero -= 2 * Math.PI;
      while (deltaSmoothed > Math.PI) deltaSmoothed -= 2 * Math.PI;
      // Smoothing shrinks the actual arc portion (more of the corner is bezier).
      expect(Math.abs(deltaSmoothed)).toBeLessThan(Math.abs(deltaZero));
    }
  });

  it("respects independent per-corner radii (larger corner reaches further along its edges)", () => {
    const { segments } = buildSquircleRectPath(
      200,
      100,
      { topLeft: 40, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      0.6,
    );

    // 3 zero-radius corners each degenerate to a single "line" straight to the
    // sharp point, plus the 4 straight edges = 7 "line" segments total; the one
    // real (40px) corner contributes exactly one cubic+arc+cubic group.
    const counts = segments.reduce(
      (acc, seg) => {
        acc[seg.type] = (acc[seg.type] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(counts.line).toBe(7);
    expect(counts.cubic).toBe(2);
    expect(counts.arc).toBe(1);
  });

  it("clamps radii when the rect is smaller than 2x the requested radius, without overlap artifacts", () => {
    const { segments, start } = buildSquircleRectPath(30, 30, uniformRadii(100), 0.6);

    // Every generated coordinate must stay within the rect bounds - no negative
    // space / overshoot from an unclamped radius.
    const allPoints: Array<{ x: number; y: number }> = [start];
    for (const seg of segments) {
      if (seg.type === "line") allPoints.push({ x: seg.x, y: seg.y });
      if (seg.type === "cubic") {
        allPoints.push({ x: seg.cp1x, y: seg.cp1y });
        allPoints.push({ x: seg.cp2x, y: seg.cp2y });
        allPoints.push({ x: seg.x, y: seg.y });
      }
      // Arc center/radius can legitimately sit outside [0,w]x[0,h] (it's the
      // circle center, not a point on the path) - only check endpoints via the
      // surrounding cubic segments above.
    }
    for (const p of allPoints) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(30 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(30 + 1e-6);
    }
  });
});
