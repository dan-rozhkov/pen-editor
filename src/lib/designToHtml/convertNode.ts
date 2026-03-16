import type {
  SceneNode,
  FlatSceneNode,
  FlatFrameNode,
  TextNode,
  EmbedNode,
  LayoutProperties,
} from "@/types/scene";
import { generateVisualStyles, generateTextStyles } from "./styleGeneration";
import { generateLayoutStyles } from "./layoutStyleGeneration";
import { pathNodeToSvg, lineNodeToSvg, polygonNodeToSvg } from "./svgGeneration";

/** Stable context threaded through the recursive conversion. */
export interface ConversionContext {
  nodesById: Record<string, FlatSceneNode>;
  childrenById: Record<string, string[]>;
  allNodes: SceneNode[];
  isComponent?: boolean;
}

function lookupNode(ctx: ConversionContext, id: string): FlatSceneNode | undefined {
  return ctx.nodesById[id];
}

function lookupChildren(ctx: ConversionContext, id: string): string[] {
  return ctx.childrenById[id] ?? [];
}

/**
 * Parse a node name for slot convention.
 * - "slot" → default slot (name: null)
 * - "slot:title" → named slot (name: "title")
 * - anything else → null (not a slot)
 */
function parseSlotName(name?: string): { name: string | null } | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (lower === "slot") return { name: null };
  if (lower.startsWith("slot:")) return { name: lower.slice(5).trim() || null };
  return null;
}

/**
 * Wrap HTML in a `<slot>` element if the node name matches slot convention.
 * Only applies when converting a component (ctx.isComponent is true).
 */
function wrapWithSlotIfNeeded(html: string, node: FlatSceneNode, ctx: ConversionContext): string {
  if (!ctx.isComponent) return html;
  // Check isSlot flag on frame nodes
  if (node.type === "frame" && (node as FlatFrameNode).isSlot) {
    const slotName = node.name?.toLowerCase().trim();
    if (slotName && slotName !== "slot") {
      return `<slot name="${slotName}">${html}</slot>`;
    }
    return `<slot>${html}</slot>`;
  }
  // Fall back to naming convention
  const slotInfo = parseSlotName(node.name);
  if (!slotInfo) return html;
  if (slotInfo.name) {
    return `<slot name="${slotInfo.name}">${html}</slot>`;
  }
  return `<slot>${html}</slot>`;
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

  let html: string;
  switch (node.type) {
    case "frame":
      html = convertFrameNode(node as FlatFrameNode, nodeId, ctx, parentLayout, isRoot);
      break;
    case "group":
      html = convertGroupNode(nodeId, ctx, parentLayout, isRoot);
      break;
    case "text":
      html = convertTextNode(node as TextNode, parentLayout, isRoot);
      break;
    case "rect":
    case "ellipse":
      html = convertShapeNode(node, parentLayout, isRoot);
      break;
    case "path":
      html = convertSvgShapeNode(node, parentLayout, isRoot, pathNodeToSvg);
      break;
    case "line":
      html = convertSvgShapeNode(node, parentLayout, isRoot, lineNodeToSvg);
      break;
    case "polygon":
      html = convertSvgShapeNode(node, parentLayout, isRoot, polygonNodeToSvg);
      break;
    case "embed":
      html = (node as EmbedNode).htmlContent ?? "";
      break;
    default:
      html = "";
      break;
  }

  // Wrap with <slot> if node name matches slot convention and we're converting a component
  if (!isRoot && html) {
    html = wrapWithSlotIfNeeded(html, node, ctx);
  }

  return html;
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
  const wrapperStyles = { ...layoutStyles, ...visualStyles, overflow: "visible" };
  return `<div style="${stylesToString(wrapperStyles)}">${svgFn(node as never)}</div>`;
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
