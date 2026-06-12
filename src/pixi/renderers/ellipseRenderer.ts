import { Container, Graphics } from "pixi.js";
import type { EllipseNode } from "@/types/scene";
import {
  applyFills,
  applyStroke,
  hasFillSourceChanged,
  hasVisualPropsChanged,
} from "./fillStrokeHelpers";
import { applyImageFillsEllipse } from "./imageFillHelpers";

export function createEllipseContainer(node: EllipseNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "ellipse-bg";
  container.addChild(gfx);
  drawEllipse(gfx, node);

  // Image fill stack with elliptical clipping
  applyImageFillsEllipse(container, node, node.width, node.height);

  return container;
}

export function updateEllipseContainer(
  container: Container,
  node: EllipseNode,
  prev: EllipseNode,
): void {
  if (hasVisualPropsChanged(node, prev)) {
    const gfx = container.getChildByLabel("ellipse-bg") as Graphics;
    if (gfx) {
      gfx.clear();
      drawEllipse(gfx, node);
    }
  }

  // Image fill stack
  if (
    hasFillSourceChanged(node, prev) ||
    node.width !== prev.width ||
    node.height !== prev.height
  ) {
    applyImageFillsEllipse(container, node, node.width, node.height);
  }
}

export function drawEllipse(gfx: Graphics, node: EllipseNode): void {
  const drawShape = (target: Graphics) =>
    target.ellipse(node.width / 2, node.height / 2, node.width / 2, node.height / 2);
  const pathReady = applyFills(gfx, node, node.width, node.height, drawShape);
  // Skip rebuilding the geometry for the stroke when the last fill already left
  // a reusable path on `gfx`.
  applyStroke(gfx, node, node.width, node.height, pathReady ? undefined : drawShape);
}
