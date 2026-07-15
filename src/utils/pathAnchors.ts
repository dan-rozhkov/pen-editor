import type { PathAnchor, PathHandle, PathNode } from "@/types/scene";

/**
 * Pure geometry + point-manipulation logic for the pen tool / path edit mode.
 *
 * Anchors are stored in the same coordinate space as `PathNode.geometry` /
 * `geometryBounds` (the "raw geometry space" the SVG `d` string lives in) —
 * *not* the node's local 0..width box. `PathNode.width`/`height` may differ
 * from `geometryBounds` when the node has been non-uniformly scaled via the
 * transform handles; `applyAnchorEditToNode` preserves that scale factor
 * across edits (see its doc comment for the exact invariant).
 *
 * Everything here is pure (no store/DOM access) so it can be unit-tested
 * directly, independent of the non-unit-testable Pixi pointer-event glue in
 * `src/pixi/interaction/`.
 */

export type { PathAnchor, PathHandle };

const EPS = 1e-3;

/** Reflect `handle` through `anchor`, preserving distance (mirrored/symmetric handle). */
export function mirrorHandle(anchor: { x: number; y: number }, handle: PathHandle): PathHandle {
  return { x: 2 * anchor.x - handle.x, y: 2 * anchor.y - handle.y };
}

function fmt(n: number): string {
  // Keep output compact but lossless for the typical range of canvas coords.
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/**
 * Build an SVG path `d` string from anchors. A segment is a straight `L`
 * when neither endpoint supplies a handle for it, otherwise a cubic `C`
 * (missing handles fall back to the endpoint itself, per SVG convention).
 */
export function anchorsToSVGPath(points: PathAnchor[], closed: boolean): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${fmt(points[0].x)},${fmt(points[0].y)}`;

  let d = `M${fmt(points[0].x)},${fmt(points[0].y)}`;
  const segCount = closed ? points.length : points.length - 1;

  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c1 = a.handleOut ?? null;
    const c2 = b.handleIn ?? null;
    if (c1 || c2) {
      const cp1 = c1 ?? { x: a.x, y: a.y };
      const cp2 = c2 ?? { x: b.x, y: b.y };
      d += ` C${fmt(cp1.x)},${fmt(cp1.y)} ${fmt(cp2.x)},${fmt(cp2.y)} ${fmt(b.x)},${fmt(b.y)}`;
    } else {
      d += ` L${fmt(b.x)},${fmt(b.y)}`;
    }
  }

  if (closed) d += " Z";
  return d;
}

/**
 * De Casteljau evaluation of a single-axis cubic bezier at `t` (0..1).
 * Exported for `pathMeasure.ts` (arc-length LUT + point-at-length), which
 * evaluates the same cubic on both axes to get an exact (x, y) at a given t.
 */
export function cubicValue(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  );
}

/**
 * Derivative (tangent component) of a single-axis cubic bezier at `t`.
 * B'(t) = 3(1-t)^2 (p1-p0) + 6(1-t)t (p2-p1) + 3t^2 (p3-p2). Exported for
 * `pathMeasure.ts`, which combines the x/y derivatives into a tangent angle
 * via `Math.atan2`. Shares the same B'(t) coefficients `cubicExtremaTs` below
 * solves for zeros of.
 */
export function cubicDerivative(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return (
    3 * mt * mt * (p1 - p0) +
    6 * mt * t * (p2 - p1) +
    3 * t * t * (p3 - p2)
  );
}

/** t-values in (0,1) where the cubic bezier's derivative is zero on one axis. */
function cubicExtremaTs(p0: number, p1: number, p2: number, p3: number): number[] {
  // B'(t) = 3a t^2 + 2b t + c, with:
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = p0 - 2 * p1 + p2;
  const c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) {
      const t = -c / (2 * b);
      if (t > 0 && t < 1) ts.push(t);
    }
    return ts;
  }
  const disc = b * b - a * c;
  if (disc < 0) return ts;
  const sqrtDisc = Math.sqrt(disc);
  for (const t of [(-b + sqrtDisc) / a, (-b - sqrtDisc) / a]) {
    if (t > 0 && t < 1) ts.push(t);
  }
  return ts;
}

interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function extendWithPoint(ext: Extent, x: number, y: number): void {
  if (x < ext.minX) ext.minX = x;
  if (x > ext.maxX) ext.maxX = x;
  if (y < ext.minY) ext.minY = y;
  if (y > ext.maxY) ext.maxY = y;
}

function extendWithCubicSegment(ext: Extent, a: PathAnchor, b: PathAnchor): void {
  const cp1 = a.handleOut ?? { x: a.x, y: a.y };
  const cp2 = b.handleIn ?? { x: b.x, y: b.y };
  extendWithPoint(ext, a.x, a.y);
  extendWithPoint(ext, b.x, b.y);
  if (!a.handleOut && !b.handleIn) return; // straight line — endpoints suffice
  for (const t of cubicExtremaTs(a.x, cp1.x, cp2.x, b.x)) {
    extendWithPoint(ext, cubicValue(a.x, cp1.x, cp2.x, b.x, t), cubicValue(a.y, cp1.y, cp2.y, b.y, t));
  }
  for (const t of cubicExtremaTs(a.y, cp1.y, cp2.y, b.y)) {
    extendWithPoint(ext, cubicValue(a.x, cp1.x, cp2.x, b.x, t), cubicValue(a.y, cp1.y, cp2.y, b.y, t));
  }
}

/** Pure (no DOM) bounding-box computation over anchors — accounts for curve extrema. */
export function computeAnchorsBBox(
  points: PathAnchor[],
  closed: boolean,
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y, width: 0, height: 0 };

  const ext: Extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const segCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segCount; i++) {
    extendWithCubicSegment(ext, points[i], points[(i + 1) % points.length]);
  }

  return {
    x: ext.minX,
    y: ext.minY,
    width: Math.max(EPS, ext.maxX - ext.minX),
    height: Math.max(EPS, ext.maxY - ext.minY),
  };
}

/**
 * Parse an SVG path `d` string back into anchors, for legacy paths (loaded
 * `.pen` files, pencil-drawn strokes, imported SVGs) that don't carry a
 * structured `points` array yet. Supports a single subpath with
 * M/L/H/V/C/S/Q/T/Z commands (both absolute and relative) — the common case
 * for everything this editor itself produces.
 *
 * Returns null for anything structurally out of scope for point-editing
 * (compound paths with multiple subpaths, or arc `A` commands) — callers
 * should treat that as "not editable via point edit mode" rather than crash.
 */
export function svgPathToAnchors(d: string): { points: PathAnchor[]; closed: boolean } | null {
  const trimmed = d.trim();
  if (!trimmed) return null;
  if (/[aA]/.test(trimmed.replace(/[eE][-+]?\d+/g, ""))) return null; // arc command (avoid matching exponents)

  const tokenRe = /([MLHVCSQTZmlhvcsqtz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(trimmed)) !== null) {
    tokens.push(m[1] ?? m[2]);
  }

  const points: PathAnchor[] = [];
  let closed = false;
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let lastControl: { x: number; y: number } | null = null; // for S/T reflection
  let lastCmd = "";
  let i = 0;
  let subpathCount = 0;

  function nextNum(): number {
    const v = parseFloat(tokens[i]);
    i++;
    return v;
  }

  function ensureAnchor(x: number, y: number, handleIn?: PathHandle | null): void {
    points.push({ x, y, ...(handleIn ? { handleIn } : {}) });
  }

  function setHandleOut(idx: number, handle: PathHandle): void {
    if (idx < 0 || idx >= points.length) return;
    points[idx] = { ...points[idx], handleOut: handle };
  }

  while (i < tokens.length) {
    const tok = tokens[i];
    const isCmd = /^[a-zA-Z]$/.test(tok);
    const cmd = isCmd ? tok : lastCmd;
    if (isCmd) i++;
    if (!cmd) return null;

    switch (cmd) {
      case "M":
      case "m": {
        subpathCount++;
        if (subpathCount > 1) return null; // compound path — out of scope
        const dx = cmd === "m" ? cur.x : 0;
        const dy = cmd === "m" ? cur.y : 0;
        cur = { x: nextNum() + dx, y: nextNum() + dy };
        start = { ...cur };
        ensureAnchor(cur.x, cur.y);
        lastControl = null;
        lastCmd = cmd === "m" ? "l" : "L";
        break;
      }
      case "L":
      case "l": {
        const dx = cmd === "l" ? cur.x : 0;
        const dy = cmd === "l" ? cur.y : 0;
        cur = { x: nextNum() + dx, y: nextNum() + dy };
        ensureAnchor(cur.x, cur.y);
        lastControl = null;
        lastCmd = cmd;
        break;
      }
      case "H":
      case "h": {
        const dx = cmd === "h" ? cur.x : 0;
        cur = { x: nextNum() + dx, y: cur.y };
        ensureAnchor(cur.x, cur.y);
        lastControl = null;
        lastCmd = cmd;
        break;
      }
      case "V":
      case "v": {
        const dy = cmd === "v" ? cur.y : 0;
        cur = { x: cur.x, y: nextNum() + dy };
        ensureAnchor(cur.x, cur.y);
        lastControl = null;
        lastCmd = cmd;
        break;
      }
      case "C":
      case "c": {
        const ox = cmd === "c" ? cur.x : 0;
        const oy = cmd === "c" ? cur.y : 0;
        const c1 = { x: nextNum() + ox, y: nextNum() + oy };
        const c2 = { x: nextNum() + ox, y: nextNum() + oy };
        const end = { x: nextNum() + ox, y: nextNum() + oy };
        setHandleOut(points.length - 1, c1);
        ensureAnchor(end.x, end.y, c2);
        cur = end;
        lastControl = c2;
        lastCmd = cmd;
        break;
      }
      case "S":
      case "s": {
        const ox = cmd === "s" ? cur.x : 0;
        const oy = cmd === "s" ? cur.y : 0;
        const c1 = lastControl ? mirrorHandle(cur, lastControl) : { ...cur };
        const c2 = { x: nextNum() + ox, y: nextNum() + oy };
        const end = { x: nextNum() + ox, y: nextNum() + oy };
        setHandleOut(points.length - 1, c1);
        ensureAnchor(end.x, end.y, c2);
        cur = end;
        lastControl = c2;
        lastCmd = cmd;
        break;
      }
      case "Q":
      case "q": {
        const ox = cmd === "q" ? cur.x : 0;
        const oy = cmd === "q" ? cur.y : 0;
        const qc = { x: nextNum() + ox, y: nextNum() + oy };
        const end = { x: nextNum() + ox, y: nextNum() + oy };
        // Quadratic -> cubic control point conversion.
        const c1 = { x: cur.x + (2 / 3) * (qc.x - cur.x), y: cur.y + (2 / 3) * (qc.y - cur.y) };
        const c2 = { x: end.x + (2 / 3) * (qc.x - end.x), y: end.y + (2 / 3) * (qc.y - end.y) };
        setHandleOut(points.length - 1, c1);
        ensureAnchor(end.x, end.y, c2);
        cur = end;
        lastControl = qc;
        lastCmd = cmd;
        break;
      }
      case "T":
      case "t": {
        const ox = cmd === "t" ? cur.x : 0;
        const oy = cmd === "t" ? cur.y : 0;
        const reflectedControl: PathHandle = lastControl ? mirrorHandle(cur, lastControl) : { ...cur };
        const end = { x: nextNum() + ox, y: nextNum() + oy };
        const c1 = { x: cur.x + (2 / 3) * (reflectedControl.x - cur.x), y: cur.y + (2 / 3) * (reflectedControl.y - cur.y) };
        const c2 = { x: end.x + (2 / 3) * (reflectedControl.x - end.x), y: end.y + (2 / 3) * (reflectedControl.y - end.y) };
        setHandleOut(points.length - 1, c1);
        ensureAnchor(end.x, end.y, c2);
        cur = end;
        lastControl = reflectedControl;
        lastCmd = cmd;
        break;
      }
      case "Z":
      case "z": {
        closed = true;
        cur = { ...start };
        lastCmd = cmd;
        break;
      }
      default:
        return null; // unsupported command
    }
  }

  if (points.length === 0) return null;

  // Drop a trailing duplicate of the start anchor produced by an explicit
  // "line back to start" before Z (common in hand-authored / exported SVGs).
  if (closed && points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.x - last.x) < EPS && Math.abs(first.y - last.y) < EPS && !last.handleIn) {
      points.pop();
    }
  }

  return { points, closed };
}

/**
 * Reverse a contour's point order (swapping each anchor's in/out handles so
 * the curve shape is unchanged, only its direction of travel). Used by the
 * text-on-path SVG exporter to flip which way glyphs read along the curve —
 * browsers have no "reverse direction" attribute on `<textPath>`, so the
 * `<path>` itself must be authored backward instead. Mirrors the Pixi
 * renderer's `flip` handling (`@/utils/textPathLayout`), which achieves the
 * same visual result by adding PI to each glyph's tangent angle instead.
 */
export function reverseAnchors(points: PathAnchor[]): PathAnchor[] {
  return [...points].reverse().map((p) => ({
    x: p.x,
    y: p.y,
    handleIn: p.handleOut ?? null,
    handleOut: p.handleIn ?? null,
  }));
}

// --- Pure point-manipulation reducers (pen tool + path edit mode) ---

/** Move an anchor (and its handles, so they travel with it) by a delta. */
export function moveAnchorPoint(points: PathAnchor[], index: number, dx: number, dy: number): PathAnchor[] {
  return points.map((p, i) => {
    if (i !== index) return p;
    return {
      x: p.x + dx,
      y: p.y + dy,
      handleIn: p.handleIn ? { x: p.handleIn.x + dx, y: p.handleIn.y + dy } : p.handleIn,
      handleOut: p.handleOut ? { x: p.handleOut.x + dx, y: p.handleOut.y + dy } : p.handleOut,
    };
  });
}

/**
 * Move one handle of an anchor to an absolute position. By default the
 * opposite handle is mirrored to keep the pair symmetric (smooth anchor);
 * pass `breakSymmetry: true` (Alt-drag) to move only the dragged handle.
 */
export function moveHandlePoint(
  points: PathAnchor[],
  index: number,
  which: "in" | "out",
  pos: PathHandle,
  breakSymmetry: boolean,
): PathAnchor[] {
  return points.map((p, i) => {
    if (i !== index) return p;
    const next: PathAnchor = { ...p };
    if (which === "out") {
      next.handleOut = pos;
      if (!breakSymmetry) next.handleIn = mirrorHandle(p, pos);
    } else {
      next.handleIn = pos;
      if (!breakSymmetry) next.handleOut = mirrorHandle(p, pos);
    }
    return next;
  });
}

/** Append a new anchor to the end of the contour (plain pen-tool click/drag). */
export function appendAnchorPoint(points: PathAnchor[], anchor: PathAnchor): PathAnchor[] {
  return [...points, anchor];
}

/**
 * Close the contour. If the last anchor is a duplicate of the first (e.g.
 * the user clicked back on the start point without moving), drop it — the
 * `closed` flag on the segment loop already reconnects start<->end.
 */
export function closeContourPoints(points: PathAnchor[]): { points: PathAnchor[]; closed: true } {
  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.x - last.x) < EPS && Math.abs(first.y - last.y) < EPS) {
      return { points: points.slice(0, -1), closed: true };
    }
  }
  return { points: [...points], closed: true };
}

/**
 * Recompute `geometry`/`geometryBounds` (and `x`/`y`/`width`/`height`) for a
 * path node after a point edit, preserving whatever non-uniform scale the
 * node already had (width/height vs. geometryBounds) so editing points on a
 * previously-resized path doesn't silently snap it back to 1:1 scale anchor
 * positions are always expressed in the *original* geometry space, and the
 * node's on-screen box is `geometryBounds` scaled by `width/geometryBounds.width`
 * (`height` respectively) — the same convention `pathRenderer.ts` already uses.
 */
export function applyAnchorEditToNode(
  node: Pick<PathNode, "x" | "y" | "width" | "height" | "geometryBounds">,
  points: PathAnchor[],
  closed: boolean,
): Partial<PathNode> {
  // Absent `geometryBounds` means geometry lives in the node's local 0..width
  // box (origin 0,0) — the same assumption `pathRenderer.drawPath` makes. Using
  // {node.x, node.y} here would shift the node's x/y on the first edit.
  const gb = node.geometryBounds ?? { x: 0, y: 0, width: node.width, height: node.height };
  const scaleX = gb.width !== 0 ? node.width / gb.width : 1;
  const scaleY = gb.height !== 0 ? node.height / gb.height : 1;
  const newGB = computeAnchorsBBox(points, closed);

  return {
    points,
    closed,
    geometry: anchorsToSVGPath(points, closed),
    geometryBounds: newGB,
    x: node.x + (newGB.x - gb.x) * scaleX,
    y: node.y + (newGB.y - gb.y) * scaleY,
    width: newGB.width * scaleX,
    height: newGB.height * scaleY,
  };
}
