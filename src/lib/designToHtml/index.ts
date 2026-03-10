import type { FlatSceneNode, SceneNode, TextNode } from "@/types/scene";
import { isGoogleFont } from "@/utils/fontUtils";
import { convertNodeToHtml, type ConversionContext } from "./convertNode";
import { buildVariableStyleBlock } from "@/utils/variableCssUtils";

/**
 * Convert a design frame (by ID) to an HTML string with inline styles.
 *
 * @param frameId - The ID of the root frame to convert
 * @param nodesById - Flat node storage
 * @param childrenById - Children index
 * @param allNodes - Full tree for resolving component instances
 * @returns HTML string representation of the design
 */
export function convertDesignNodesToHtml(
  frameId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  allNodes: SceneNode[],
): string {
  const ctx: ConversionContext = { nodesById, childrenById, allNodes };
  const html = convertNodeToHtml(frameId, ctx, undefined, true);

  const varBlock = generateVariableRootBlock(nodesById);
  const fontLinks = generateFontLinks(nodesById);
  return varBlock + fontLinks + html;
}

/**
 * Collect all variable IDs referenced via fillBinding/strokeBinding in the node tree
 * and generate a `<style>:root { ... }</style>` block with their current values.
 */
function generateVariableRootBlock(nodesById: Record<string, FlatSceneNode>): string {
  const referencedVarIds = new Set<string>();
  for (const node of Object.values(nodesById)) {
    if (node.fillBinding) referencedVarIds.add(node.fillBinding.variableId);
    if (node.strokeBinding) referencedVarIds.add(node.strokeBinding.variableId);
  }
  if (referencedVarIds.size === 0) return "";
  return buildVariableStyleBlock(referencedVarIds);
}

/**
 * Collect all Google Font families used across text nodes and
 * return `<link>` tags to load them.
 */
function generateFontLinks(nodesById: Record<string, FlatSceneNode>): string {
  const families = new Set<string>();
  for (const node of Object.values(nodesById)) {
    if (node.type === "text") {
      const family = (node as TextNode).fontFamily;
      if (family && isGoogleFont(family)) {
        families.add(family);
      }
    }
  }
  if (families.size === 0) return "";

  return Array.from(families)
    .map((family) => {
      const encoded = family.replace(/ /g, "+");
      return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encoded}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap">`;
    })
    .join("");
}
