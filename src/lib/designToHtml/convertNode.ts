import type {
  SceneNode,
  FlatSceneNode,
  FlatFrameNode,
  TextNode,
  EmbedNode,
  RefNode,
  LayoutProperties,
} from "@/types/scene";
import { flattenTree } from "@/types/scene";
import { resolveRefToFrame } from "@/utils/instanceUtils";
import { generateVisualStyles, generateTextStyles } from "./styleGeneration";
import { generateLayoutStyles } from "./layoutStyleGeneration";
import { pathNodeToSvg, lineNodeToSvg, polygonNodeToSvg } from "./svgGeneration";

/** Stable context threaded through the recursive conversion. */
export interface ConversionContext {
  nodesById: Record<string, FlatSceneNode>;
  childrenById: Record<string, string[]>;
  allNodes: SceneNode[];
  /** Overlay maps from resolved ref nodes — checked before the main store. */
  overlayNodes?: Record<string, FlatSceneNode>;
  overlayChildren?: Record<string, string[]>;
}

function lookupNode(ctx: ConversionContext, id: string): FlatSceneNode | undefined {
  return ctx.overlayNodes?.[id] ?? ctx.nodesById[id];
}

function lookupChildren(ctx: ConversionContext, id: string): string[] {
  return ctx.overlayChildren?.[id] ?? ctx.childrenById[id] ?? [];
}

/**
 * Convert a scene node tree to an HTML string.
 * Works with flat store data, building tree nodes as needed.
 */
export function convertNodeToHtml(
  nodeId: string,
  ctx: ConversionContext,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
): string {
  const node = lookupNode(ctx, nodeId);
  if (!node) return "";

  // Hidden nodes
  if (node.visible === false || node.enabled === false) {
    return "";
  }

  switch (node.type) {
    case "frame":
      return convertFrameNode(node as FlatFrameNode, nodeId, ctx, parentLayout, isRoot);
    case "group":
      return convertGroupNode(nodeId, ctx, parentLayout, isRoot);
    case "text":
      return convertTextNode(node as TextNode, parentLayout, isRoot);
    case "rect":
    case "ellipse":
      return convertShapeNode(node, parentLayout, isRoot);
    case "path":
      return convertSvgShapeNode(node, parentLayout, isRoot, pathNodeToSvg);
    case "line":
      return convertSvgShapeNode(node, parentLayout, isRoot, lineNodeToSvg);
    case "polygon":
      return convertSvgShapeNode(node, parentLayout, isRoot, polygonNodeToSvg);
    case "embed":
      return (node as EmbedNode).htmlContent ?? "";
    case "ref":
      return convertRefNode(node as RefNode, ctx, parentLayout, isRoot);
    default:
      return "";
  }
}

function convertFrameNode(
  node: FlatFrameNode,
  nodeId: string,
  ctx: ConversionContext,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
): string {
  const styles = {
    ...generateLayoutStyles(node, parentLayout, isRoot),
    ...generateVisualStyles(node),
  };

  const childIds = lookupChildren(ctx, nodeId);
  const childLayout = node.layout;
  const childrenHtml = childIds
    .map((childId) => convertNodeToHtml(childId, ctx, childLayout, false))
    .join("");

  return `<div style="${stylesToString(styles)}">${childrenHtml}</div>`;
}

function convertGroupNode(
  nodeId: string,
  ctx: ConversionContext,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
): string {
  const node = lookupNode(ctx, nodeId)!;
  const styles: Record<string, string> = {
    position: "relative",
    ...generateLayoutStyles(node, parentLayout, isRoot),
    ...generateVisualStyles(node),
  };

  const childIds = lookupChildren(ctx, nodeId);
  const childrenHtml = childIds
    .map((childId) => convertNodeToHtml(childId, ctx, undefined, false))
    .join("");

  return `<div style="${stylesToString(styles)}">${childrenHtml}</div>`;
}

function convertTextNode(
  node: TextNode,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
): string {
  const styles = {
    ...generateLayoutStyles(node, parentLayout, isRoot),
    ...generateVisualStyles(node),
    ...generateTextStyles(node),
  };

  const text = escapeHtml(node.text);

  // For fixed-height text with vertical alignment, wrap in a div
  if (node.textWidthMode === "fixed-height" || node.textAlignVertical) {
    return `<div style="${stylesToString(styles)}">${text}</div>`;
  }

  return `<span style="${stylesToString(styles)}">${text}</span>`;
}

function convertShapeNode(
  node: FlatSceneNode,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
): string {
  const styles = {
    ...generateLayoutStyles(node, parentLayout, isRoot),
    ...generateVisualStyles(node),
  };

  return `<div style="${stylesToString(styles)}"></div>`;
}

/**
 * Shared converter for SVG-based shape nodes (path, line, polygon).
 * Applies layout + visual styles to a wrapper div, with fill/border
 * removed since the SVG element handles them directly.
 */
function convertSvgShapeNode(
  node: FlatSceneNode,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
  svgFn: (n: never) => string,
): string {
  const layoutStyles = generateLayoutStyles(node, parentLayout, isRoot);
  const visualStyles = generateVisualStyles(node);
  delete visualStyles["background-color"];
  delete visualStyles.border;
  const wrapperStyles = { ...layoutStyles, ...visualStyles };
  return `<div style="${stylesToString(wrapperStyles)}">${svgFn(node as never)}</div>`;
}

function convertRefNode(
  refNode: RefNode,
  ctx: ConversionContext,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
): string {
  // Resolve the ref to a full frame with overrides applied
  const resolved = resolveRefToFrame(refNode, ctx.allNodes);
  if (!resolved) return "";

  // Flatten resolved tree and layer on top of existing maps (no copying of the full store)
  const { nodesById: resolvedNodes, childrenById: resolvedChildren } = flattenTree([resolved]);

  const layeredCtx: ConversionContext = {
    ...ctx,
    overlayNodes: resolvedNodes,
    overlayChildren: resolvedChildren,
  };

  return convertNodeToHtml(resolved.id, layeredCtx, parentLayout, isRoot);
}

function stylesToString(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}
