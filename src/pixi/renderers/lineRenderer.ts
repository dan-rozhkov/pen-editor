import { Container, Graphics } from "pixi.js";
import type { LineNode } from "@/types/scene";
import { buildCapPrimitive, capTrimLength } from "@/utils/lineCapUtils";
import { getResolvedStroke, parseColor, parseAlpha } from "./colorHelpers";
import { isOutlineRenderMode, strokeOutlinePath } from "./outlineHelpers";

export function createLineContainer(node: LineNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "line-gfx";
  drawLine(gfx, node);
  container.addChild(gfx);
  return container;
}

export function updateLineContainer(
  container: Container,
  node: LineNode,
  prev: LineNode,
): void {
  if (
    node.points !== prev.points ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth ||
    node.startCap !== prev.startCap ||
    node.endCap !== prev.endCap
  ) {
    const gfx = container.getChildByLabel("line-gfx") as Graphics;
    if (gfx) {
      gfx.clear();
      drawLine(gfx, node);
    }
  }
}

/** Draw one endpoint's cap primitive, rotated so local +x points along `angle`. */
function drawCap(
  gfx: Graphics,
  x: number,
  y: number,
  angle: number,
  shape: LineNode["startCap"],
  strokeWidth: number,
  color: number,
  alpha: number,
): void {
  const primitive = buildCapPrimitive(shape ?? "none", strokeWidth);
  if (!primitive) return;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toWorld = (lx: number, ly: number): [number, number] => [
    x + lx * cos - ly * sin,
    y + lx * sin + ly * cos,
  ];

  if (primitive.kind === "lines") {
    for (const [x1, y1, x2, y2] of primitive.segments) {
      const [wx1, wy1] = toWorld(x1, y1);
      const [wx2, wy2] = toWorld(x2, y2);
      gfx.moveTo(wx1, wy1);
      gfx.lineTo(wx2, wy2);
      gfx.stroke({ color, alpha, width: strokeWidth });
    }
  } else if (primitive.kind === "polygon") {
    const worldPoints: number[] = [];
    for (let i = 0; i < primitive.points.length; i += 2) {
      const [wx, wy] = toWorld(primitive.points[i], primitive.points[i + 1]);
      worldPoints.push(wx, wy);
    }
    gfx.poly(worldPoints, true);
    gfx.fill({ color, alpha });
  } else {
    const [wx, wy] = toWorld(primitive.cx, primitive.cy);
    gfx.circle(wx, wy, primitive.radius);
    gfx.fill({ color, alpha });
  }
}

export function drawLine(gfx: Graphics, node: LineNode): void {
  const points = node.points;
  if (points.length < 4) return;

  // Outline mode: just the bare segment, no caps (caps are filled shapes),
  // no node color/width — same wireframe stroke as every other shape.
  if (isOutlineRenderMode()) {
    gfx.moveTo(points[0], points[1]);
    gfx.lineTo(points[2], points[3]);
    strokeOutlinePath(gfx);
    return;
  }

  const strokeColor = getResolvedStroke(node) ?? "#000000";
  const color = parseColor(strokeColor);
  const alpha = parseAlpha(strokeColor);
  const strokeWidth = node.strokeWidth ?? 1;

  let [x1, y1, x2, y2] = points;
  const startCap = node.startCap ?? "none";
  const endCap = node.endCap ?? "none";
  const angleStartToEnd = Math.atan2(y2 - y1, x2 - x1);
  const angleEndToStart = angleStartToEnd + Math.PI;
  const totalLength = Math.hypot(x2 - x1, y2 - y1);

  // Trim the visible stroke back from each endpoint so solid caps
  // (triangle/circle) don't get pierced by the underlying line.
  if (totalLength > 0) {
    const dirX = (x2 - x1) / totalLength;
    const dirY = (y2 - y1) / totalLength;
    const startTrim = Math.min(capTrimLength(startCap, strokeWidth), totalLength / 2);
    const endTrim = Math.min(capTrimLength(endCap, strokeWidth), totalLength / 2);
    x1 = x1 + dirX * startTrim;
    y1 = y1 + dirY * startTrim;
    x2 = x2 - dirX * endTrim;
    y2 = y2 - dirY * endTrim;
  }

  gfx.moveTo(x1, y1);
  gfx.lineTo(x2, y2);
  gfx.stroke({
    color,
    alpha,
    width: strokeWidth,
  });

  drawCap(gfx, points[0], points[1], angleEndToStart, startCap, strokeWidth, color, alpha);
  drawCap(gfx, points[2], points[3], angleStartToEnd, endCap, strokeWidth, color, alpha);
}
