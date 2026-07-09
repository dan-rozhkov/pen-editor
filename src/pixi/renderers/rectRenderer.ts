import { Container, Graphics } from "pixi.js";
import type { RectNode } from "@/types/scene";
import {
  applyFills,
  applyStroke,
  hasFillSourceChanged,
  hasVisualPropsChanged,
  drawRoundedShape,
} from "./fillStrokeHelpers";
import { applyImageFills } from "./imageFillHelpers";
import { applyVideoFills } from "./videoFillHelpers";

export function createRectContainer(node: RectNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "rect-bg";
  container.addChild(gfx);
  drawRect(gfx, node);

  // Image fill paint stack
  applyImageFills(
    container,
    node,
    node.width,
    node.height,
    node.cornerRadius,
    node.cornerRadiusPerCorner,
    node.cornerSmoothing,
  );

  // Video fill (topmost video paint)
  applyVideoFills(
    container,
    node,
    node.width,
    node.height,
    node.cornerRadius,
    node.cornerRadiusPerCorner,
    node.cornerSmoothing,
  );

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

  // Image fill stack
  if (
    hasFillSourceChanged(node, prev) ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.cornerRadius !== prev.cornerRadius ||
    node.cornerRadiusPerCorner !== prev.cornerRadiusPerCorner ||
    node.cornerSmoothing !== prev.cornerSmoothing
  ) {
    applyImageFills(
      container,
      node,
      node.width,
      node.height,
      node.cornerRadius,
      node.cornerRadiusPerCorner,
      node.cornerSmoothing,
    );
    applyVideoFills(
      container,
      node,
      node.width,
      node.height,
      node.cornerRadius,
      node.cornerRadiusPerCorner,
      node.cornerSmoothing,
    );
  }
}

export function drawRect(gfx: Graphics, node: RectNode): void {
  const drawShape = (target: Graphics) =>
    drawRoundedShape(
      target,
      node.width,
      node.height,
      node.cornerRadius,
      node.cornerRadiusPerCorner,
      node.cornerSmoothing,
    );
  const pathReady = applyFills(gfx, node, node.width, node.height, drawShape);
  // Skip rebuilding the geometry for the stroke when the last fill already left
  // a reusable path on `gfx`.
  applyStroke(gfx, node, node.width, node.height, pathReady ? undefined : drawShape);
}
