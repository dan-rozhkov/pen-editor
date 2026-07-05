import type { FlatSceneNode } from "@/types/scene";
import { convertNodeToSvg } from "./convertNode";
import type { SvgConversionContext } from "./shapeStyles";

export interface DesignToSvgResult {
  /** Standalone `<svg>` document string (empty when `rootId` was not found). */
  svg: string;
  /** Human-readable notices about content that could not be faithfully exported. */
  warnings: string[];
}

/**
 * Serialize a scene node (and its descendants) to a standalone SVG document.
 * Works directly against the flat store data (`nodesById`/`childrenById`),
 * mirroring `convertDesignNodesToHtml` in `designToHtml/index.ts`.
 *
 * The exported `<svg>` is sized to the root node's own width/height, with
 * every descendant positioned via nested `<g transform="translate(x,y)">`
 * (coordinates are parent-relative, matching the scene graph's storage
 * convention). Embeds, component instances (`ref`), and shaders cannot be
 * represented as flat SVG and are replaced with a placeholder or skipped —
 * see `warnings` for what was affected.
 */
export function convertDesignNodesToSvg(
  rootId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): DesignToSvgResult {
  const root = nodesById[rootId];
  if (!root) {
    return { svg: "", warnings: [`Node not found: ${rootId}`] };
  }

  const ctx: SvgConversionContext = { nodesById, childrenById, defs: [], warnings: [] };
  const body = convertNodeToSvg(rootId, ctx, true);
  const defsBlock = ctx.defs.length > 0 ? `<defs>${ctx.defs.join("")}</defs>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${root.width}" height="${root.height}" viewBox="0 0 ${root.width} ${root.height}">${defsBlock}${body}</svg>`;
  return { svg, warnings: ctx.warnings };
}
