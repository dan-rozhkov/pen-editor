import { Container, Graphics } from "pixi.js";
import type { ConnectorNode } from "@/types/scene";
import { getResolvedStroke, parseColor, parseAlpha } from "./colorHelpers";
import { drawArrowhead, shortenLineEnd } from "@/utils/connectorUtils";

const ARROW_SIZE = 8;

export function createConnectorContainer(node: ConnectorNode): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.label = "connector-gfx";
  drawConnector(gfx, node);
  container.addChild(gfx);
  return container;
}

export function updateConnectorContainer(
  container: Container,
  node: ConnectorNode,
  prev: ConnectorNode,
): void {
  if (
    node.points !== prev.points ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth ||
    node.width !== prev.width ||
    node.height !== prev.height
  ) {
    const gfx = container.getChildByLabel("connector-gfx") as Graphics;
    if (gfx) {
      gfx.clear();
      drawConnector(gfx, node);
    }
  }
}

function drawConnector(gfx: Graphics, node: ConnectorNode): void {
  const strokeColor = getResolvedStroke(node) ?? "#333333";
  const points = node.points;
  if (points.length < 4) return;

  const x1 = points[0];
  const y1 = points[1];
  const x2 = points[2];
  const y2 = points[3];

  const color = parseColor(strokeColor);
  const alpha = parseAlpha(strokeColor);
  const width = node.strokeWidth ?? 2;

  // Draw line (shortened so it ends at arrowhead base)
  const lineEnd = shortenLineEnd(x1, y1, x2, y2, ARROW_SIZE);
  gfx.moveTo(x1, y1);
  gfx.lineTo(lineEnd.x, lineEnd.y);
  gfx.stroke({ color, alpha, width });

  // Draw arrowhead at end point
  drawArrowhead(gfx, x1, y1, x2, y2, ARROW_SIZE, { color, alpha });
}
