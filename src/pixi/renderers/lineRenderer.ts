import { Container, Graphics } from "pixi.js";
import type { LineNode } from "@/types/scene";
import { getResolvedStroke, parseColor, parseAlpha } from "./colorHelpers";

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
    node.strokeWidth !== prev.strokeWidth
  ) {
    const gfx = container.getChildByLabel("line-gfx") as Graphics;
    if (gfx) {
      gfx.clear();
      drawLine(gfx, node);
    }
  }
}

export function drawLine(gfx: Graphics, node: LineNode): void {
  const strokeColor = getResolvedStroke(node) ?? "#000000";
  const points = node.points;
  if (points.length < 4) return;

  gfx.moveTo(points[0], points[1]);
  gfx.lineTo(points[2], points[3]);
  gfx.stroke({
    color: parseColor(strokeColor),
    alpha: parseAlpha(strokeColor),
    width: node.strokeWidth ?? 1,
  });
}
