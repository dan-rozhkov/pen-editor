import { Container, Graphics } from "pixi.js";
import type { EllipseNode } from "@/types/scene";
import { buildEllipseArcGeometry, hasCustomEllipseArc } from "@/lib/shapePath/ellipseArc";
import {
  applyFills,
  applyStroke,
  hasFillSourceChanged,
  hasVisualPropsChanged,
} from "./fillStrokeHelpers";
import { applyImageFillsEllipse } from "./imageFillHelpers";
import { applyVideoFillsEllipse } from "./videoFillHelpers";

export function createEllipseContainer(node: EllipseNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "ellipse-bg";
  container.addChild(gfx);
  drawEllipse(gfx, node);

  // Image fill stack with elliptical clipping. NOTE: the image mask is always
  // a full ellipse — it does not respect arc/donut params (documented gap;
  // combining an image fill with a non-default arc is rare in practice).
  applyImageFillsEllipse(container, node, node.width, node.height);
  applyVideoFillsEllipse(container, node, node.width, node.height);

  return container;
}

export function updateEllipseContainer(
  container: Container,
  node: EllipseNode,
  prev: EllipseNode,
): void {
  if (
    hasVisualPropsChanged(node, prev) ||
    node.startAngle !== prev.startAngle ||
    node.sweepAngle !== prev.sweepAngle ||
    node.innerRadiusRatio !== prev.innerRadiusRatio
  ) {
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
    applyVideoFillsEllipse(container, node, node.width, node.height);
  }
}

/** Draw a (possibly multi-contour) polyline arc/donut shape onto `target`. */
function drawArcContours(target: Graphics, node: EllipseNode): void {
  const geometry = buildEllipseArcGeometry(node.width, node.height, node);
  for (const contour of geometry.contours) {
    const [first, ...rest] = contour.points;
    if (!first) continue;
    target.moveTo(first.x, first.y);
    for (const p of rest) {
      target.lineTo(p.x, p.y);
    }
    target.closePath();
  }
}

export function drawEllipse(gfx: Graphics, node: EllipseNode): void {
  const arcParams = {
    startAngle: node.startAngle,
    sweepAngle: node.sweepAngle,
    innerRadiusRatio: node.innerRadiusRatio,
  };
  const useArc = hasCustomEllipseArc(arcParams);
  const drawShape = (target: Graphics) =>
    useArc
      ? drawArcContours(target, node)
      : target.ellipse(node.width / 2, node.height / 2, node.width / 2, node.height / 2);
  const pathReady = applyFills(gfx, node, node.width, node.height, drawShape);
  // Skip rebuilding the geometry for the stroke when the last fill already left
  // a reusable path on `gfx`.
  applyStroke(gfx, node, node.width, node.height, pathReady ? undefined : drawShape);
}
