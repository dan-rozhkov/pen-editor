import type { FlatSceneNode } from "@/types/scene";
import { getAbsolutePositionFlat } from "@/utils/nodeUtils";
import { convertDesignNodesToSvg, type DesignToSvgResult } from "./index";
import { convertNodeToSvg } from "./convertNode";
import type { SvgConversionContext } from "./shapeStyles";

/**
 * Serialize a multi-node selection to a single standalone `<svg>` document.
 * A single-node selection delegates straight to `convertDesignNodesToSvg`
 * (sized to that node's own box). For 2+ nodes — NOT necessarily siblings;
 * `selectionStore.addToSelection` allows selecting nodes from anywhere in
 * the tree, so they can live under different parents — each node's
 * ABSOLUTE position (summed up its `parentById` chain via
 * `getAbsolutePositionFlat`) is used for both the combined bounding box and
 * its own `<g transform="translate(...)">`, so nodes are positioned
 * correctly relative to each other regardless of nesting. For a top-level
 * node, absolute position equals `node.x`/`node.y`, so this preserves
 * existing behavior for same-parent selections.
 */
export function buildSvgForSelection(
  nodeIds: string[],
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  parentById: Record<string, string | null>,
): DesignToSvgResult {
  if (nodeIds.length === 0) {
    return { svg: "", warnings: ["No selection"] };
  }
  if (nodeIds.length === 1) {
    return convertDesignNodesToSvg(nodeIds[0], nodesById, childrenById);
  }

  const warnings: string[] = [];
  const nodes: FlatSceneNode[] = [];
  for (const id of nodeIds) {
    const node = nodesById[id];
    if (node) {
      nodes.push(node);
    } else {
      warnings.push(`Node not found: ${id}`);
    }
  }
  if (nodes.length === 0) {
    warnings.push("No matching nodes in selection");
    return { svg: "", warnings };
  }

  const positions = new Map(nodes.map((n) => [n.id, getAbsolutePositionFlat(n.id, nodesById, parentById)]));
  const posOf = (n: FlatSceneNode) => positions.get(n.id)!;

  const minX = Math.min(...nodes.map((n) => posOf(n).x));
  const minY = Math.min(...nodes.map((n) => posOf(n).y));
  const maxX = Math.max(...nodes.map((n) => posOf(n).x + n.width));
  const maxY = Math.max(...nodes.map((n) => posOf(n).y + n.height));
  const width = maxX - minX;
  const height = maxY - minY;

  const ctx: SvgConversionContext = { nodesById, childrenById, defs: [], warnings: [] };
  const body = nodes
    .map((n) => {
      const pos = posOf(n);
      return `<g transform="translate(${pos.x - minX} ${pos.y - minY})">${convertNodeToSvg(n.id, ctx, true)}</g>`;
    })
    .join("");
  const defsBlock = ctx.defs.length > 0 ? `<defs>${ctx.defs.join("")}</defs>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="visible">${defsBlock}${body}</svg>`;
  return { svg, warnings: [...warnings, ...ctx.warnings] };
}
