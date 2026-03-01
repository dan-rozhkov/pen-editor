import { Container, Graphics } from "pixi.js";
import type { RectNode } from "@/types/scene";
import { applyFill, applyStroke, hasVisualPropsChanged } from "./fillStrokeHelpers";
import { applyImageFill } from "./imageFillHelpers";

export function createRectContainer(node: RectNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "rect-bg";
  drawRect(gfx, node);
  container.addChild(gfx);

  // Image fill
  if (node.imageFill) {
    applyImageFill(container, node.imageFill, node.width, node.height, node.cornerRadius);
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
    node.height !== prev.height
  ) {
    applyImageFill(container, node.imageFill, node.width, node.height, node.cornerRadius);
  }
}

export function drawRect(gfx: Graphics, node: RectNode): void {
  if (node.cornerRadius) {
    gfx.roundRect(0, 0, node.width, node.height, node.cornerRadius);
  } else {
    gfx.rect(0, 0, node.width, node.height);
  }
  applyFill(gfx, node, node.width, node.height);

  applyStroke(gfx, node, node.width, node.height);
}
