import { Container, Graphics } from "pixi.js";
import type { EllipseNode } from "@/types/scene";
import { applyFill, applyStroke } from "./fillStrokeHelpers";
import { applyImageFillEllipse } from "./imageFillHelpers";

export function createEllipseContainer(node: EllipseNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "ellipse-bg";
  drawEllipse(gfx, node);
  container.addChild(gfx);

  // Image fill with elliptical clipping
  if (node.imageFill) {
    applyImageFillEllipse(container, node.imageFill, node.width, node.height);
  }

  return container;
}

export function updateEllipseContainer(
  container: Container,
  node: EllipseNode,
  prev: EllipseNode,
): void {
  if (
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
    node.gradientFill !== prev.gradientFill
  ) {
    const gfx = container.getChildByLabel("ellipse-bg") as Graphics;
    if (gfx) {
      gfx.clear();
      drawEllipse(gfx, node);
    }
  }

  // Image fill
  if (
    node.imageFill !== prev.imageFill ||
    node.width !== prev.width ||
    node.height !== prev.height
  ) {
    applyImageFillEllipse(container, node.imageFill, node.width, node.height);
  }
}

export function drawEllipse(gfx: Graphics, node: EllipseNode): void {
  gfx.ellipse(node.width / 2, node.height / 2, node.width / 2, node.height / 2);
  applyFill(gfx, node, node.width, node.height);

  applyStroke(gfx, node, node.width, node.height);
}
