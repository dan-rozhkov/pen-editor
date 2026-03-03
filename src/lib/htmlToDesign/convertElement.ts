import type {
  SceneNode,
  FrameNode,
  TextNode,
  RectNode,
} from "@/types/scene";
import { generateId } from "@/types/scene";
import { parseSvgToNodes } from "@/utils/svgUtils";
import { applyBaseProps, applyTextProps, applyBasePropsToText, createRectFromStyle } from "./styleApplication";
import { shouldFlattenTextOnlyElement, hasDirectTextContent, hasVisualStyling, inferFrameName } from "./elementChecks";
import { inferAutoLayout, groupGridChildrenIntoRows, inferChildSizing } from "./layoutInference";
import { serializeSvgWithComputedStyles, svgTextToDataUrl, scaleAndOffsetNode, normalizeSvgNodeToViewport } from "./svgHandling";

/** Convert a DOM node (element or text) into a SceneNode, or null if empty/invisible */
export function convertNode(
  domNode: Node,
  containerRect: DOMRect,
  elementNodeMap: Map<Element, SceneNode>,
): SceneNode | null {
  if (domNode.nodeType === Node.TEXT_NODE) {
    return convertTextNode(domNode as Text, containerRect);
  }
  if (domNode.nodeType === Node.ELEMENT_NODE) {
    const node = convertElement(domNode as Element, containerRect, elementNodeMap);
    if (node) elementNodeMap.set(domNode as Element, node);
    return node;
  }
  return null;
}

/** Convert a text-only DOM node into a TextNode */
function convertTextNode(
  textNode: Text,
  containerRect: DOMRect,
): TextNode | null {
  const text = textNode.textContent?.trim();
  if (!text) return null;

  const range = document.createRange();
  range.selectNodeContents(textNode);
  const rects = range.getClientRects();
  if (rects.length === 0) return null;

  // Use bounding rect of all line rects
  const firstRect = rects[0];
  let minX = firstRect.left;
  let minY = firstRect.top;
  let maxX = firstRect.right;
  let maxY = firstRect.bottom;
  for (let i = 1; i < rects.length; i++) {
    minX = Math.min(minX, rects[i].left);
    minY = Math.min(minY, rects[i].top);
    maxX = Math.max(maxX, rects[i].right);
    maxY = Math.max(maxY, rects[i].bottom);
  }

  const parentEl = textNode.parentElement;
  const parentStyle = parentEl
    ? window.getComputedStyle(parentEl)
    : null;

  const isSingleLine = !text.includes('\n') && rects.length <= 1;
  const node: TextNode = {
    id: generateId(),
    type: "text",
    text,
    x: minX - containerRect.left,
    y: minY - containerRect.top,
    width: maxX - minX,
    height: maxY - minY,
    textWidthMode: isSingleLine ? "auto" : "fixed",
  };

  if (parentStyle) {
    applyTextProps(node, parentStyle);
  }

  return node;
}

/** Convert a DOM Element into a FrameNode (with children), TextNode, or RectNode */
function convertElement(
  el: Element,
  containerRect: DOMRect,
  elementNodeMap: Map<Element, SceneNode>,
): SceneNode | null {
  const style = window.getComputedStyle(el);

  // Skip invisible elements
  if (style.display === "none" || style.visibility === "hidden") return null;

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  const x = rect.left - containerRect.left;
  const y = rect.top - containerRect.top;
  const w = rect.width;
  const h = rect.height;
  const tag = el.tagName.toLowerCase();

  // <hr> → RectNode
  if (tag === "hr") {
    return createRectFromStyle(el, style, x, y, w, h);
  }

  // <img> → FrameNode with imageFill
  if (tag === "img") {
    const src = (el as HTMLImageElement).src;
    const frame: FrameNode = {
      id: generateId(),
      type: "frame",
      name: "Image",
      x, y, width: w, height: h,
      children: [],
    };
    if (src) {
      frame.imageFill = { url: src, mode: "fill" };
    }
    applyBaseProps(frame, style);
    return frame;
  }

  // <svg> → placeholder rect
  if (tag === "svg") {
    const svgFrame: FrameNode = {
      id: generateId(),
      type: "frame",
      name: "SVG",
      x, y, width: w, height: h,
      children: [],
    };
    applyBaseProps(svgFrame, style);

    const serializedSvg = serializeSvgWithComputedStyles(el as SVGSVGElement);
    const parsed = serializedSvg ? parseSvgToNodes(serializedSvg) : null;
    if (!parsed) {
      const svgDataUrl = serializedSvg ? svgTextToDataUrl(serializedSvg) : null;
      if (svgDataUrl) {
        svgFrame.imageFill = { url: svgDataUrl, mode: "fill" };
        return svgFrame;
      }

      const rectNode: RectNode = {
        id: generateId(),
        type: "rect",
        name: "SVG",
        x, y, width: w, height: h,
        fill: "#E0E0E0",
      };
      return rectNode;
    }

    const viewportNode = normalizeSvgNodeToViewport(parsed.node, parsed.svgWidth, parsed.svgHeight);
    const sx = parsed.svgWidth > 0 ? w / parsed.svgWidth : 1;
    const sy = parsed.svgHeight > 0 ? h / parsed.svgHeight : 1;
    scaleAndOffsetNode(viewportNode, sx, sy, 0, 0);
    viewportNode.absolutePosition = true;
    svgFrame.children = [viewportNode];
    return svgFrame;
  }

  // Check if this is a text-only element (no element children, only text content)
  const hasElementChildren = el.children.length > 0;
  const hasTextContent = hasDirectTextContent(el);

  if (!hasElementChildren && hasTextContent && shouldFlattenTextOnlyElement(style, tag)) {
    // Pure text element → TextNode
    const elText = el.textContent?.trim() ?? "";
    const range = document.createRange();
    range.selectNodeContents(el);
    const elRects = range.getClientRects();
    const elIsSingleLine = !elText.includes('\n') && elRects.length <= 1;
    const textNode: TextNode = {
      id: generateId(),
      type: "text",
      text: elText,
      x, y, width: w, height: h,
      textWidthMode: elIsSingleLine ? "auto" : "fixed",
    };
    applyTextProps(textNode, style);
    applyBasePropsToText(textNode, style);
    return textNode;
  }

  // Element with children → FrameNode
  const children: SceneNode[] = [];

  for (const child of el.childNodes) {
    const childNode = convertNode(child, containerRect, elementNodeMap);
    if (childNode) {
      children.push(childNode);
    }
  }

  // If no children produced, check if it has visual styling to keep as an empty frame
  if (children.length === 0 && !hasVisualStyling(style)) {
    return null;
  }

  const frame: FrameNode = {
    id: generateId(),
    type: "frame",
    name: inferFrameName(el),
    x, y, width: w, height: h,
    children,
  };

  applyBaseProps(frame, style);

  // Convert children from canvas-absolute to parent-local coordinates.
  const parentX = rect.left - containerRect.left;
  const parentY = rect.top - containerRect.top;
  for (const child of frame.children) {
    child.x -= parentX;
    child.y -= parentY;
  }

  // Mark absolute/fixed positioned children using the element→node map
  // built during child conversion (avoids O(n²) position-based matching).
  const domChildren = el.children;
  for (let i = 0; i < domChildren.length; i++) {
    const childStyle = window.getComputedStyle(domChildren[i]);
    const pos = childStyle.position;
    if (pos === "absolute" || pos === "fixed") {
      const matchingNode = elementNodeMap.get(domChildren[i]);
      if (matchingNode) {
        matchingNode.absolutePosition = true;
      }
    }
  }

  // Infer auto-layout from CSS display/flex
  const autoLayoutResult = inferAutoLayout(style, el);
  if (autoLayoutResult) {
    frame.layout = autoLayoutResult.layout;

    // For multi-column CSS grids, group children into row frames
    if (autoLayoutResult.grid) {
      groupGridChildrenIntoRows(frame, el, autoLayoutResult.grid, elementNodeMap);
    } else {
      // Zero out auto-layout children positions and infer sizing
      const nonAbsCount = frame.children.filter((c) => !c.absolutePosition).length;
      for (const child of frame.children) {
        if (child.absolutePosition) continue;
        child.x = 0;
        child.y = 0;
        inferChildSizing(child, frame, nonAbsCount);
      }
    }
  }

  return frame;
}
