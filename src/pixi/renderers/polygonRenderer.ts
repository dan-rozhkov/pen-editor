import { Container, Graphics } from "pixi.js";
import type { PolygonNode } from "@/types/scene";
import { applyFills, applyStroke } from "./fillStrokeHelpers";
import { isOutlineRenderMode, strokeOutlinePath } from "./outlineHelpers";

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
    node.strokeAlign !== prev.strokeAlign ||
    node.gradientFill !== prev.gradientFill ||
    node.fills !== prev.fills
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

  const drawShape = (target: Graphics) => target.poly(points, true);
  if (isOutlineRenderMode()) {
    drawShape(gfx);
    strokeOutlinePath(gfx);
    return;
  }
  const pathReady = applyFills(gfx, node, node.width, node.height, drawShape);
  // Skip rebuilding the geometry for the stroke when the last fill already left
  // a reusable path on `gfx`.
  applyStroke(gfx, node, node.width, node.height, pathReady ? undefined : drawShape);
}
