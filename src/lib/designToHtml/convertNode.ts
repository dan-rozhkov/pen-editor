import type {
  SceneNode,
  FlatSceneNode,
  FlatFrameNode,
  TextNode,
  EmbedNode,
  LayoutProperties,
} from "@/types/scene";
import { generateVisualStyles, generateTextStyles, BACKGROUND_STYLE_KEYS } from "./styleGeneration";
import { generateLayoutStyles } from "./layoutStyleGeneration";
import { pathNodeToSvg, lineNodeToSvg, polygonNodeToSvg } from "./svgGeneration";
import { resolveMasking, getMaskMode } from "@/lib/masks/maskResolution";
import { getFills } from "@/utils/fillUtils";
import { imageModeToCssSize } from "@/lib/cssBackground";
import { getParagraphAttrs, hasActiveList, splitParagraphs } from "@/lib/textLists/paragraphs";
import { computeParagraphMarkerInfos } from "@/lib/textLists/markers";

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
 *
 * `extraStyles` merges additional CSS declarations onto the node's own
 * wrapper element — currently used only to apply a Figma-style sibling
 * mask's `clip-path`/`mask-image` (see `convertChildrenWithMasking` below).
 */
export function convertNodeToHtml(
  nodeId: string,
  ctx: ConversionContext,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
  extraStyles?: Record<string, string>,
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
      html = convertFrameNode(node as FlatFrameNode, nodeId, ctx, parentLayout, isRoot, extraStyles);
      break;
    case "group":
      html = convertGroupNode(nodeId, ctx, parentLayout, isRoot, extraStyles);
      break;
    case "text":
      html = convertTextNode(node as TextNode, parentLayout, isRoot, extraStyles);
      break;
    case "rect":
    case "ellipse":
      html = convertShapeNode(node, parentLayout, isRoot, extraStyles);
      break;
    case "path":
      html = convertSvgShapeNode(node, parentLayout, isRoot, pathNodeToSvg, extraStyles);
      break;
    case "line":
      html = convertSvgShapeNode(node, parentLayout, isRoot, lineNodeToSvg, extraStyles);
      break;
    case "polygon":
      html = convertSvgShapeNode(node, parentLayout, isRoot, polygonNodeToSvg, extraStyles);
      break;
    case "embed":
      html = (node as EmbedNode).htmlContent ?? "";
      if (extraStyles && Object.keys(extraStyles).length > 0 && html) {
        html = `<div style="${stylesToString(extraStyles)}">${html}</div>`;
      }
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
  extraStyles?: Record<string, string>,
): string {
  const styles = {
    ...generateLayoutStyles(node, parentLayout, isRoot),
    ...generateVisualStyles(node),
    ...extraStyles,
  };

  const childIds = lookupChildren(ctx, nodeId);
  const childLayout = node.layout;
  const childrenHtml = convertChildrenWithMasking(childIds, ctx, childLayout);

  return `<div style="${stylesToString(styles)}">${childrenHtml}</div>`;
}

function convertGroupNode(
  nodeId: string,
  ctx: ConversionContext,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
  extraStyles?: Record<string, string>,
): string {
  const node = lookupNode(ctx, nodeId)!;
  const styles: Record<string, string> = {
    position: "relative",
    ...generateLayoutStyles(node, parentLayout, isRoot),
    ...generateVisualStyles(node),
    ...extraStyles,
  };

  const childIds = lookupChildren(ctx, nodeId);
  const childrenHtml = convertChildrenWithMasking(childIds, ctx, undefined);

  return `<div style="${stylesToString(styles)}">${childrenHtml}</div>`;
}

/**
 * Render a frame/group's children applying Figma-style sibling masking (see
 * `resolveMasking`). The masker node itself is never rendered as content
 * (matching how the SVG exporter's `convertChildrenWithMasking` excludes it
 * too); every sibling it clips gets a computed `clip-path`/`mask-image`
 * merged onto its own wrapper element via `extraStyles`.
 *
 * Only maskers directly expressible in the sibling's own local box are
 * supported: rect-like bounds (`inset()`) and ellipses (`ellipse()`) for
 * vector mode, and a single image-fill layer (`mask-image`) for alpha mode.
 * Anything else (path/polygon/line geometry, text glyphs, multi-layer
 * fills, groups with a custom `clipGeometry`) has no cheap CSS equivalent
 * here — this exporter has no warning plumbing (unlike the SVG exporter's
 * `ctx.warnings`), so, matching how it already handles other unsupported
 * features, the masker's clipping effect is simply skipped and the content
 * renders unmasked.
 */
function convertChildrenWithMasking(
  childIds: string[],
  ctx: ConversionContext,
  childLayout: LayoutProperties | undefined,
): string {
  const { maskerIdBySiblingId, maskerIds } = resolveMasking(childIds, ctx.nodesById);
  if (maskerIds.size === 0) {
    return childIds.map((childId) => convertNodeToHtml(childId, ctx, childLayout, false)).join("");
  }

  const parts: string[] = [];
  for (const childId of childIds) {
    if (maskerIds.has(childId)) continue; // maskers aren't rendered as content
    const maskerId = maskerIdBySiblingId.get(childId);
    const maskerNode = maskerId ? ctx.nodesById[maskerId] : undefined;
    const siblingNode = ctx.nodesById[childId];
    const clipStyles = maskerNode && siblingNode ? buildMaskClipStyles(maskerNode, siblingNode) : undefined;
    parts.push(convertNodeToHtml(childId, ctx, childLayout, false, clipStyles));
  }
  return parts.join("");
}

/**
 * Compute the CSS declarations that approximate a masker's clip for one
 * sibling, expressed in the sibling's own local box (CSS `clip-path`/
 * `mask-image` coordinates are relative to the element's own border box,
 * not the shared parent frame both nodes' `x`/`y` are stored in).
 * Returns `undefined` when the masker's shape has no cheap CSS equivalent.
 */
function buildMaskClipStyles(
  maskerNode: FlatSceneNode,
  siblingNode: FlatSceneNode,
): Record<string, string> | undefined {
  const localLeft = maskerNode.x - siblingNode.x;
  const localTop = maskerNode.y - siblingNode.y;

  if (getMaskMode(maskerNode) === "vector") {
    if (maskerNode.type === "ellipse") {
      const rx = maskerNode.width / 2;
      const ry = maskerNode.height / 2;
      const cx = localLeft + rx;
      const cy = localTop + ry;
      return { "clip-path": `ellipse(${rx}px ${ry}px at ${cx}px ${cy}px)` };
    }
    if (
      maskerNode.type === "rect" ||
      maskerNode.type === "frame" ||
      maskerNode.type === "group"
    ) {
      const right = siblingNode.width - (localLeft + maskerNode.width);
      const bottom = siblingNode.height - (localTop + maskerNode.height);
      return { "clip-path": `inset(${localTop}px ${right}px ${bottom}px ${localLeft}px)` };
    }
    // path / polygon / line: no simple box/ellipse equivalent — skip.
    return undefined;
  }

  // Alpha mode: text glyphs have no cheap CSS mask; a single image-fill
  // layer maps onto `mask-image` sized/positioned like the masker's own box.
  const imagePaint = getFills(maskerNode).find((p) => p.type === "image");
  if (!imagePaint || imagePaint.type !== "image") return undefined;
  const url = `url("${imagePaint.image.url}")`;
  const size = imageModeToCssSize(imagePaint.image.mode);
  const position = `${localLeft}px ${localTop}px`;
  return {
    "-webkit-mask-image": url,
    "-webkit-mask-size": size,
    "-webkit-mask-position": position,
    "-webkit-mask-repeat": "no-repeat",
    "mask-image": url,
    "mask-size": size,
    "mask-position": position,
    "mask-repeat": "no-repeat",
  };
}

interface ListEntry {
  level: number;
  type: "bullet" | "number";
  html: string;
}

interface ListStackFrame {
  level: number;
  type: "bullet" | "number";
  items: string[];
}

/**
 * Build nested `<ul>`/`<ol>` HTML from a flat run of list entries (one per
 * paragraph, already ordered). Sibling entries at the same level/type share a
 * list; a deeper `level` opens a nested list inside the previous `<li>`; a
 * type change at the same level closes the current list and opens a sibling
 * one (so a bullet run followed by a numbered run at the same depth doesn't
 * get merged into one invalid mixed list).
 */
function renderNestedListHtml(entries: ListEntry[]): string {
  const stack: ListStackFrame[] = [];
  const roots: string[] = [];

  const closeFrame = () => {
    const frame = stack.pop();
    if (!frame) return;
    const tag = frame.type === "number" ? "ol" : "ul";
    const html = `<${tag}>${frame.items.join("")}</${tag}>`;
    const parent = stack[stack.length - 1];
    if (parent && parent.items.length > 0) {
      // Splice the nested list inside the parent's last <li>...</li>, before
      // its closing tag (not appended after it, which would make the nested
      // list a sibling instead of nested content).
      const lastIndex = parent.items.length - 1;
      const last = parent.items[lastIndex];
      parent.items[lastIndex] = `${last.slice(0, -"</li>".length)}${html}</li>`;
    } else {
      roots.push(html);
    }
  };

  for (const entry of entries) {
    while (
      stack.length > 0 &&
      (stack[stack.length - 1].level > entry.level ||
        (stack[stack.length - 1].level === entry.level && stack[stack.length - 1].type !== entry.type))
    ) {
      closeFrame();
    }
    if (stack.length === 0 || stack[stack.length - 1].level < entry.level) {
      stack.push({ level: entry.level, type: entry.type, items: [] });
    }
    stack[stack.length - 1].items.push(`<li>${entry.html}</li>`);
  }

  while (stack.length > 0) closeFrame();
  return roots.join("");
}

/**
 * Serialize a text node's paragraphs to HTML, grouping contiguous list
 * paragraphs into nested `<ul>`/`<ol>` and contiguous plain paragraphs into
 * `<br>`-joined text (matching the pre-lists behavior for non-list content).
 */
function buildTextBodyHtml(node: TextNode): string {
  const lines = splitParagraphs(node.text);
  const markers = computeParagraphMarkerInfos(node);
  const parts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (markers[i]) {
      const entries: ListEntry[] = [];
      while (i < lines.length && markers[i]) {
        const attrs = getParagraphAttrs(node, i);
        entries.push({
          level: attrs.indentLevel,
          type: attrs.listType as "bullet" | "number",
          html: escapeHtml(lines[i]),
        });
        i++;
      }
      parts.push(renderNestedListHtml(entries));
    } else {
      const plainLines: string[] = [];
      while (i < lines.length && !markers[i]) {
        plainLines.push(escapeHtml(lines[i]));
        i++;
      }
      parts.push(plainLines.join("<br>"));
    }
  }

  return parts.join("");
}

function convertTextNode(
  node: TextNode,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
  extraStyles?: Record<string, string>,
): string {
  const styles = {
    ...generateLayoutStyles(node, parentLayout, isRoot),
    ...generateVisualStyles(node),
    ...generateTextStyles(node),
    ...extraStyles,
  };

  if (hasActiveList(node)) {
    // ul/ol are block-level — always wrap in a div (a span can't validly
    // contain them), regardless of textWidthMode/vertical-align.
    return `<div style="${stylesToString(styles)}">${buildTextBodyHtml(node)}</div>`;
  }

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
  extraStyles?: Record<string, string>,
): string {
  const styles = {
    ...generateLayoutStyles(node, parentLayout, isRoot),
    ...generateVisualStyles(node),
    ...extraStyles,
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
  extraStyles?: Record<string, string>,
): string {
  const layoutStyles = generateLayoutStyles(node, parentLayout, isRoot);
  const visualStyles = generateVisualStyles(node);
  for (const key of BACKGROUND_STYLE_KEYS) {
    delete visualStyles[key];
  }
  delete visualStyles.border;
  const wrapperStyles = { ...layoutStyles, ...visualStyles, overflow: "visible", ...extraStyles };
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
