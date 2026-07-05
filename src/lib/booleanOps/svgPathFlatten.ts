/**
 * Minimal SVG path-data ("d" attribute) parser that flattens every curve
 * command into line segments, producing plain polygon subpaths. Used to feed
 * shape geometry into the polygon boolean-clipping library (which only
 * understands straight-edged rings) — see `src/lib/booleanOps/nodeToPolygon.ts`.
 *
 * Supports M/L/H/V/C/S/Q/T/A/Z in both absolute and relative form. Arcs are
 * converted to a sequence of cubic beziers before flattening (standard
 * SVG-to-bezier arc conversion), so the whole flattening pass only needs one
 * curve-sampling routine.
 */

export interface Point {
  x: number;
  y: number;
}

const CURVE_SEGMENTS = 24;

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function sampleCubic(out: Point[], p0: Point, p1: Point, p2: Point, p3: Point): void {
  for (let i = 1; i <= CURVE_SEGMENTS; i++) {
    out.push(cubicPoint(p0, p1, p2, p3, i / CURVE_SEGMENTS));
  }
}

function quadraticToCubic(p0: Point, p1: Point, p2: Point): [Point, Point] {
  return [
    { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) },
    { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) },
  ];
}

/** Convert an SVG elliptical arc segment into a list of cubic-bezier control-point groups. */
function arcToCubics(
  p0: Point,
  rxIn: number,
  ryIn: number,
  xAxisRotationDeg: number,
  largeArcFlag: boolean,
  sweepFlag: boolean,
  p1: Point,
): [Point, Point, Point][] {
  if (rxIn === 0 || ryIn === 0 || (p0.x === p1.x && p0.y === p1.y)) {
    return [[p0, p1, p1]];
  }

  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (p0.x - p1.x) / 2;
  const dy2 = (p0.y - p1.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const sign = largeArcFlag !== sweepFlag ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;

  function angle(ux: number, uy: number, vx: number, vy: number): number {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let ang = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) ang = -ang;
    return ang;
  }

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweepFlag && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweepFlag && dTheta < 0) dTheta += 2 * Math.PI;

  // Split into segments of at most 90deg for a good bezier approximation.
  const segCount = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segCount;
  const t = (4 / 3) * Math.tan(delta / 4);

  const result: [Point, Point, Point][] = [];
  let theta = theta1;
  for (let i = 0; i < segCount; i++) {
    const thetaEnd = theta + delta;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const cosTE = Math.cos(thetaEnd);
    const sinTE = Math.sin(thetaEnd);

    const startVec = { x: -rx * sinT, y: ry * cosT };
    const endVec = { x: -rx * sinTE, y: ry * cosTE };

    const c1Local = { x: rx * cosT - t * startVec.x, y: ry * sinT - t * startVec.y };
    const c2Local = { x: rx * cosTE + t * endVec.x, y: ry * sinTE + t * endVec.y };
    const endLocal = { x: rx * cosTE, y: ry * sinTE };

    function toWorld(pt: Point): Point {
      return {
        x: cosPhi * pt.x - sinPhi * pt.y + cx,
        y: sinPhi * pt.x + cosPhi * pt.y + cy,
      };
    }

    const c1 = toWorld(c1Local);
    const c2 = toWorld(c2Local);
    const end = i === segCount - 1 ? p1 : toWorld(endLocal);

    result.push([c1, c2, end]);
    theta = thetaEnd;
  }
  return result;
}

/** Tokenize an SVG path "d" string into a flat list of command letters + numeric args. */
function tokenize(d: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    if (match[1]) tokens.push(match[1]);
    else tokens.push(parseFloat(match[2]));
  }
  return tokens;
}

/**
 * Parse + flatten SVG path data into an array of closed polygon subpaths.
 * Open subpaths (no explicit "Z") are closed implicitly — boolean ops only
 * make sense on filled/closed regions.
 */
export function flattenSvgPath(d: string): Point[][] {
  const tokens = tokenize(d);
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };
  let prevControl: Point | null = null; // for S/T reflection
  let prevCmd = "";

  function pushPoint(p: Point) {
    current.push(p);
    cur = p;
  }

  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i] as string;
    i++;
    const isRelative = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    const readNum = (): number => tokens[i++] as number;

    switch (upper) {
      case "M": {
        if (current.length > 0) subpaths.push(current);
        current = [];
        const x = readNum();
        const y = readNum();
        cur = isRelative ? { x: cur.x + x, y: cur.y + y } : { x, y };
        subpathStart = cur;
        pushPoint(cur);
        // Subsequent coordinate pairs after M are implicit L commands.
        while (i < tokens.length && typeof tokens[i] === "number") {
          const lx = readNum();
          const ly = readNum();
          cur = isRelative ? { x: cur.x + lx, y: cur.y + ly } : { x: lx, y: ly };
          pushPoint(cur);
        }
        break;
      }
      case "L": {
        while (true) {
          const x = readNum();
          const y = readNum();
          cur = isRelative ? { x: cur.x + x, y: cur.y + y } : { x, y };
          pushPoint(cur);
          if (!(i < tokens.length && typeof tokens[i] === "number")) break;
        }
        break;
      }
      case "H": {
        while (true) {
          const x = readNum();
          cur = { x: isRelative ? cur.x + x : x, y: cur.y };
          pushPoint(cur);
          if (!(i < tokens.length && typeof tokens[i] === "number")) break;
        }
        break;
      }
      case "V": {
        while (true) {
          const y = readNum();
          cur = { x: cur.x, y: isRelative ? cur.y + y : y };
          pushPoint(cur);
          if (!(i < tokens.length && typeof tokens[i] === "number")) break;
        }
        break;
      }
      case "C": {
        while (true) {
          const x1 = readNum(), y1 = readNum();
          const x2 = readNum(), y2 = readNum();
          const x = readNum(), y = readNum();
          const p1 = isRelative ? { x: cur.x + x1, y: cur.y + y1 } : { x: x1, y: y1 };
          const p2 = isRelative ? { x: cur.x + x2, y: cur.y + y2 } : { x: x2, y: y2 };
          const p3 = isRelative ? { x: cur.x + x, y: cur.y + y } : { x, y };
          sampleCubic(current, cur, p1, p2, p3);
          prevControl = p2;
          cur = p3;
          if (!(i < tokens.length && typeof tokens[i] === "number")) break;
        }
        break;
      }
      case "S": {
        while (true) {
          const x2 = readNum(), y2 = readNum();
          const x = readNum(), y = readNum();
          const reflect: Point =
            prevControl && (prevCmd === "C" || prevCmd === "S")
              ? { x: 2 * cur.x - prevControl.x, y: 2 * cur.y - prevControl.y }
              : cur;
          const p2 = isRelative ? { x: cur.x + x2, y: cur.y + y2 } : { x: x2, y: y2 };
          const p3 = isRelative ? { x: cur.x + x, y: cur.y + y } : { x, y };
          sampleCubic(current, cur, reflect, p2, p3);
          prevControl = p2;
          cur = p3;
          prevCmd = "S";
          if (!(i < tokens.length && typeof tokens[i] === "number")) break;
        }
        prevCmd = "S";
        break;
      }
      case "Q": {
        while (true) {
          const x1 = readNum(), y1 = readNum();
          const x = readNum(), y = readNum();
          const p1 = isRelative ? { x: cur.x + x1, y: cur.y + y1 } : { x: x1, y: y1 };
          const p3 = isRelative ? { x: cur.x + x, y: cur.y + y } : { x, y };
          const [c1, c2] = quadraticToCubic(cur, p1, p3);
          sampleCubic(current, cur, c1, c2, p3);
          prevControl = p1;
          cur = p3;
          if (!(i < tokens.length && typeof tokens[i] === "number")) break;
        }
        break;
      }
      case "T": {
        while (true) {
          const x = readNum(), y = readNum();
          const reflect: Point =
            prevControl && (prevCmd === "Q" || prevCmd === "T")
              ? { x: 2 * cur.x - prevControl.x, y: 2 * cur.y - prevControl.y }
              : cur;
          const p3 = isRelative ? { x: cur.x + x, y: cur.y + y } : { x, y };
          const [c1, c2] = quadraticToCubic(cur, reflect, p3);
          sampleCubic(current, cur, c1, c2, p3);
          prevControl = reflect;
          cur = p3;
          prevCmd = "T";
          if (!(i < tokens.length && typeof tokens[i] === "number")) break;
        }
        prevCmd = "T";
        break;
      }
      case "A": {
        while (true) {
          const rx = readNum(), ry = readNum();
          const xRot = readNum();
          const largeArc = readNum() !== 0;
          const sweep = readNum() !== 0;
          const x = readNum(), y = readNum();
          const end = isRelative ? { x: cur.x + x, y: cur.y + y } : { x, y };
          const segments = arcToCubics(cur, rx, ry, xRot, largeArc, sweep, end);
          for (const [c1, c2, e] of segments) {
            sampleCubic(current, cur, c1, c2, e);
            cur = e;
          }
          if (!(i < tokens.length && typeof tokens[i] === "number")) break;
        }
        break;
      }
      case "Z": {
        if (current.length > 0) {
          cur = subpathStart;
        }
        break;
      }
      default:
        // Unknown command — skip its (unknown) argument count by bailing out.
        i = tokens.length;
        break;
    }

    if (upper !== "S" && upper !== "T" && upper !== "C" && upper !== "Q") prevControl = null;
    prevCmd = upper;
  }

  if (current.length > 0) subpaths.push(current);
  return subpaths;
}
