export interface ConnectorBounds {
  minX: number;
  minY: number;
  nodeWidth: number;
  nodeHeight: number;
}

/**
 * Bounding box of a connector spanning two world-space endpoints, clamped to
 * a minimum 1px size. Shared by `connectorController` (drawing a new
 * connector) and `syncConnectors` (recomputing an existing one's geometry).
 */
export function computeConnectorBounds(
  startPos: { x: number; y: number },
  endPos: { x: number; y: number },
): ConnectorBounds {
  const minX = Math.min(startPos.x, endPos.x);
  const minY = Math.min(startPos.y, endPos.y);
  const maxX = Math.max(startPos.x, endPos.x);
  const maxY = Math.max(startPos.y, endPos.y);
  const nodeWidth = Math.max(maxX - minX, 1);
  const nodeHeight = Math.max(maxY - minY, 1);
  return { minX, minY, nodeWidth, nodeHeight };
}
