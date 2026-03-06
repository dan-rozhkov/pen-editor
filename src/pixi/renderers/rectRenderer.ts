import { Container, Graphics } from "pixi.js";
import type { RectNode } from "@/types/scene";
import { applyFill, applyStroke, hasVisualPropsChanged, drawRoundedShape } from "./fillStrokeHelpers";
import { applyImageFill } from "./imageFillHelpers";

export function createRectContainer(node: RectNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "rect-bg";
  drawRect(gfx, node);
  container.addChild(gfx);

  // Image fill
  if (node.imageFill) {
    applyImageFill(container, node.imageFill, node.width, node.height, node.cornerRadius, node.cornerRadiusPerCorner);
  }

  return container;
}

export function updateRectContainer(
  container: Container,
  node: RectNode,
  prev: RectNode,
): void {
  // Check if visual properties changed
  if (hasVisualPropsChanged(node, prev)) {
    const gfx = container.getChildByLabel("rect-bg") as Graphics;
    if (gfx) {
      gfx.clear();
      drawRect(gfx, node);
    }
  }

  // Image fill
  if (
    node.imageFill !== prev.imageFill ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.cornerRadius !== prev.cornerRadius ||
    node.cornerRadiusPerCorner !== prev.cornerRadiusPerCorner
  ) {
    applyImageFill(container, node.imageFill, node.width, node.height, node.cornerRadius, node.cornerRadiusPerCorner);
  }
}

export function drawRect(gfx: Graphics, node: RectNode): void {
  drawRoundedShape(gfx, node.width, node.height, node.cornerRadius, node.cornerRadiusPerCorner);
  applyFill(gfx, node, node.width, node.height);

  applyStroke(gfx, node, node.width, node.height);
}
