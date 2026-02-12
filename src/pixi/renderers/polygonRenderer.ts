import { Container, Graphics } from "pixi.js";
import type { PolygonNode } from "@/types/scene";
import { applyFill, applyStroke } from "./fillStrokeHelpers";

export function createPolygonContainer(node: PolygonNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "polygon-gfx";
  drawPolygon(gfx, node);
  container.addChild(gfx);
  return container;
}

export function updatePolygonContainer(
  container: Container,
  node: PolygonNode,
  prev: PolygonNode,
): void {
  if (
    node.points !== prev.points ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.fill !== prev.fill ||
    node.fillBinding !== prev.fillBinding ||
    node.fillOpacity !== prev.fillOpacity ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth ||
    node.gradientFill !== prev.gradientFill
  ) {
    const gfx = container.getChildByLabel("polygon-gfx") as Graphics;
    if (gfx) {
      gfx.clear();
      drawPolygon(gfx, node);
    }
  }
}

export function drawPolygon(gfx: Graphics, node: PolygonNode): void {
  const points = node.points;
  if (!points || points.length < 6) return;

  gfx.poly(points, true);
  applyFill(gfx, node, node.width, node.height);

  applyStroke(gfx, node, node.width, node.height);
}
