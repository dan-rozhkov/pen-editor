import type {
  SceneNode,
  FrameNode,
  TextNode,
  RectNode,
  LayoutProperties,
  FlexDirection,
  AlignItems,
  JustifyContent,
  SizingMode,
  ShadowEffect,
} from "@/types/scene";
import { generateId } from "@/types/scene";

/** Extract url() value from a CSS property string */
export function extractCssUrl(value: string): string | null {
  const match = value.match(/url\(["']?(.*?)["']?\)/);
  return match?.[1] ?? null;
}

/**
 * Convert HTML content into a native design node tree.
 *
 * Uses the same DOM-based pipeline as htmlTextureHelpers.ts:
 * insert HTML into a hidden DOM element, let the browser compute layout,
 * then walk the tree reading getComputedStyle + getBoundingClientRect
 * to produce SceneNodes.
 */
export async function convertHtmlToDesignNodes(
  htmlContent: string,
  width: number,
  height: number,
): Promise<FrameNode> {
  // 1. Create hidden container at embed dimensions
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed;
    left: -99999px;
    top: -99999px;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    pointer-events: none;
  `;
  // Sanitize: strip event handler attributes and script tags to prevent execution
  const sanitized = htmlContent
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "");
  container.innerHTML = sanitized;
  document.body.appendChild(container);

  // Wait for fonts and images to load, then one frame for reflow
  await document.fonts.ready;
  await Promise.all(
    Array.from(container.querySelectorAll("img")).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.onload = img.onerror = () => res();
          }),
    ),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  try {
    const containerRect = container.getBoundingClientRect();
    // Per-call map correlating DOM elements to their converted SceneNodes
    const elementNodeMap = new Map<Element, SceneNode>();

    // Convert the container's children into scene nodes
    const children: SceneNode[] = [];
    for (const child of container.childNodes) {
      const node = convertNode(child, containerRect, elementNodeMap);
      if (node) children.push(node);
    }

    // Create root frame matching embed dimensions
    const rootFrame: FrameNode = {
      id: generateId(),
      type: "frame",
      name: "Converted HTML",
      x: 0,
      y: 0,
      width,
      height,
      clip: true,
      children,
    };

    // If there's a single top-level element, try to infer its layout
    if (container.children.length === 1) {
      const topStyle = window.getComputedStyle(container.children[0]);
      const layout = inferAutoLayout(topStyle);
      if (layout) rootFrame.layout = layout;
      const bg = parseFillColor(topStyle.backgroundColor);
      if (bg) rootFrame.fill = bg;
    }

    return rootFrame;
  } finally {
    document.body.removeChild(container);
  }
}

/** Convert a DOM node (element or text) into a SceneNode, or null if empty/invisible */
function convertNode(
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

  const node: TextNode = {
    id: generateId(),
    type: "text",
    text,
    x: minX - containerRect.left,
    y: minY - containerRect.top,
    width: maxX - minX,
    height: maxY - minY,
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
    const rectNode: RectNode = {
      id: generateId(),
      type: "rect",
      name: "SVG",
      x, y, width: w, height: h,
      fill: "#E0E0E0",
    };
    return rectNode;
  }

  // Check if this is a text-only element (no element children, only text content)
  const hasElementChildren = el.children.length > 0;
  const hasTextContent = hasDirectTextContent(el);

  const keepAsFrameForTextOnly = shouldKeepTextOnlyElementAsFrame(tag);

  if (!hasElementChildren && hasTextContent && !keepAsFrameForTextOnly) {
    // Pure text element → TextNode
    const textNode: TextNode = {
      id: generateId(),
      type: "text",
      text: el.textContent?.trim() ?? "",
      x, y, width: w, height: h,
      textWidthMode: "fixed",
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
  const layout = inferAutoLayout(style);
  if (layout) {
    frame.layout = layout;

    // Convert children to relative positions and infer sizing
    convertChildrenToRelative(frame, el, containerRect);
  }

  return frame;
}

/** Preserve some text-only elements as frames instead of flattening to a single text node */
function shouldKeepTextOnlyElementAsFrame(tag: string): boolean {
  return tag === "div";
}

/** Check if an element has direct text content (not just whitespace) */
function hasDirectTextContent(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      return true;
    }
  }
  return false;
}

/** Check if an element has visual styling worth preserving */
function hasVisualStyling(style: CSSStyleDeclaration): boolean {
  const bg = style.backgroundColor;
  if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return true;
  const border = parseFloat(style.borderTopWidth) || 0;
  if (border > 0) return true;
  const shadow = style.boxShadow;
  if (shadow && shadow !== "none") return true;
  return false;
}

/** Infer a reasonable name from an HTML element */
function inferFrameName(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const className = el.className;
  if (typeof className === "string" && className.trim()) {
    const first = className.trim().split(/\s+/)[0];
    // Clean up common CSS class prefixes
    return first.length > 30 ? tag : first;
  }
  const nameMap: Record<string, string> = {
    div: "Frame",
    section: "Section",
    header: "Header",
    footer: "Footer",
    nav: "Nav",
    main: "Main",
    article: "Article",
    aside: "Aside",
    ul: "List",
    ol: "List",
    li: "List Item",
    a: "Link",
    button: "Button",
    form: "Form",
    span: "Span",
    p: "Paragraph",
    h1: "Heading 1",
    h2: "Heading 2",
    h3: "Heading 3",
    h4: "Heading 4",
    h5: "Heading 5",
    h6: "Heading 6",
  };
  return nameMap[tag] ?? "Frame";
}

/** Parse a CSS color, returning hex or null if transparent */
function parseFillColor(cssColor: string): string | null {
  if (!cssColor || cssColor === "rgba(0, 0, 0, 0)" || cssColor === "transparent") {
    return null;
  }
  return cssColorToHex(cssColor);
}

/** Convert a CSS color string to hex */
function cssColorToHex(color: string): string {
  // If already hex, return as-is
  if (color.startsWith("#")) return color;

  // Parse rgb/rgba
  const match = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (match) {
    const r = Math.round(parseFloat(match[1]));
    const g = Math.round(parseFloat(match[2]));
    const b = Math.round(parseFloat(match[3]));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  return color;
}

/** Apply base visual properties from CSS to a frame/rect node */
function applyBaseProps(
  node: FrameNode | RectNode,
  style: CSSStyleDeclaration,
): void {
  // Background color
  const fill = parseFillColor(style.backgroundColor);
  if (fill) node.fill = fill;

  // Corner radius
  const radius = parseFloat(style.borderRadius) || 0;
  if (radius > 0) node.cornerRadius = radius;

  // Border/stroke
  const borderWidth = parseFloat(style.borderTopWidth) || 0;
  if (borderWidth > 0) {
    const borderColor = parseFillColor(style.borderTopColor);
    if (borderColor) {
      node.stroke = borderColor;
      node.strokeWidth = borderWidth;
    }
  }

  // Background image → imageFill
  const bgImage = style.backgroundImage;
  if (bgImage && bgImage !== "none") {
    const bgUrl = extractCssUrl(bgImage);
    if (bgUrl) {
      const bgSize = style.backgroundSize;
      const mode = bgSize === "contain" ? "fit" : "fill";
      node.imageFill = { url: bgUrl, mode };
    }
  }

  // Opacity
  const opacity = parseFloat(style.opacity);
  if (opacity < 1) node.opacity = opacity;

  // Overflow → clip
  if (node.type === "frame" && (style.overflow === "hidden" || style.overflowX === "hidden")) {
    node.clip = true;
  }

  // Box shadow → effect
  const shadow = parseShadow(style.boxShadow);
  if (shadow) node.effect = shadow;
}

/** Apply text-relevant base properties (fill from background, opacity) */
function applyBasePropsToText(node: TextNode, style: CSSStyleDeclaration): void {
  const opacity = parseFloat(style.opacity);
  if (opacity < 1) node.opacity = opacity;
}

/** Apply typography properties from CSS to a TextNode */
function applyTextProps(node: TextNode, style: CSSStyleDeclaration): void {
  // Font size
  const fontSize = parseFloat(style.fontSize);
  if (fontSize) node.fontSize = fontSize;

  // Font family (first family)
  const fontFamily = style.fontFamily;
  if (fontFamily) {
    const first = fontFamily.split(",")[0].trim().replace(/['"]/g, "");
    node.fontFamily = first;
  }

  // Font weight
  const fontWeight = style.fontWeight;
  if (fontWeight && fontWeight !== "400" && fontWeight !== "normal") {
    node.fontWeight = fontWeight;
  }

  // Font style
  if (style.fontStyle === "italic") {
    node.fontStyle = "italic";
  }

  // Text color → fill
  const color = parseFillColor(style.color);
  if (color) node.fill = color;

  // Text align
  const textAlign = style.textAlign;
  if (textAlign === "center" || textAlign === "right") {
    node.textAlign = textAlign;
  }

  // Line height
  const lineHeight = parseFloat(style.lineHeight);
  if (lineHeight && fontSize && !isNaN(lineHeight)) {
    const ratio = lineHeight / fontSize;
    if (ratio > 0 && ratio !== 1.2 && isFinite(ratio)) {
      node.lineHeight = Math.round(ratio * 100) / 100;
    }
  }

  // Letter spacing
  const letterSpacing = parseFloat(style.letterSpacing);
  if (letterSpacing && !isNaN(letterSpacing) && letterSpacing !== 0) {
    node.letterSpacing = letterSpacing;
  }

  // Text decoration
  const decoration = style.textDecorationLine || style.textDecoration;
  if (decoration?.includes("underline")) {
    node.underline = true;
  }
  if (decoration?.includes("line-through")) {
    node.strikethrough = true;
  }
}

/** Infer auto-layout properties from CSS display/flex */
function inferAutoLayout(
  style: CSSStyleDeclaration,
): LayoutProperties | undefined {
  const display = style.display;

  if (display === "flex" || display === "inline-flex") {
    const flexDirection =
      style.flexDirection === "row" || style.flexDirection === "row-reverse"
        ? "row"
        : "column";

    const mainAxisGap =
      flexDirection === "row"
        ? parseFloat(style.columnGap) || parseFloat(style.gap) || 0
        : parseFloat(style.rowGap) || parseFloat(style.gap) || 0;

    const layout: LayoutProperties = {
      autoLayout: true,
      flexDirection: flexDirection as FlexDirection,
      gap: mainAxisGap,
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingRight: parseFloat(style.paddingRight) || 0,
      paddingBottom: parseFloat(style.paddingBottom) || 0,
      paddingLeft: parseFloat(style.paddingLeft) || 0,
    };

    // Align items
    const alignItems = style.alignItems;
    const alignMap: Record<string, AlignItems> = {
      "flex-start": "flex-start",
      "start": "flex-start",
      "flex-end": "flex-end",
      "end": "flex-end",
      "center": "center",
      "stretch": "stretch",
    };
    if (alignItems && alignMap[alignItems]) {
      layout.alignItems = alignMap[alignItems];
    }

    // Justify content
    const justifyContent = style.justifyContent;
    const justifyMap: Record<string, JustifyContent> = {
      "flex-start": "flex-start",
      "start": "flex-start",
      "flex-end": "flex-end",
      "end": "flex-end",
      "center": "center",
      "space-between": "space-between",
      "space-around": "space-around",
      "space-evenly": "space-evenly",
    };
    if (justifyContent && justifyMap[justifyContent]) {
      layout.justifyContent = justifyMap[justifyContent];
    }

    return layout;
  }

  // CSS Grid → infer direction from columns
  if (display === "grid" || display === "inline-grid") {
    const cols = style.gridTemplateColumns;
    // Count columns: if >1 resolved column track, treat as row layout
    const colCount = cols ? cols.trim().split(/\s+/).length : 1;
    const flexDirection: FlexDirection = colCount > 1 ? "row" : "column";
    const gap =
      parseFloat(flexDirection === "row" ? style.columnGap : style.rowGap) ||
      parseFloat(style.gap) ||
      0;

    const layout: LayoutProperties = {
      autoLayout: true,
      flexDirection,
      gap,
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingRight: parseFloat(style.paddingRight) || 0,
      paddingBottom: parseFloat(style.paddingBottom) || 0,
      paddingLeft: parseFloat(style.paddingLeft) || 0,
    };

    // For equal-width grid columns (like repeat(3, 1fr)), mark as flexWrap
    if (flexDirection === "row" && colCount > 1) {
      layout.alignItems = "stretch";
    }

    return layout;
  }

  // Block-level → vertical auto-layout
  if (display === "block" || display === "inline-block" || display === "list-item") {
    return {
      autoLayout: true,
      flexDirection: "column",
      gap: 0,
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingRight: parseFloat(style.paddingRight) || 0,
      paddingBottom: parseFloat(style.paddingBottom) || 0,
      paddingLeft: parseFloat(style.paddingLeft) || 0,
    };
  }

  return undefined;
}

/** Convert children to relative positions when parent has auto-layout */
function convertChildrenToRelative(
  frame: FrameNode,
  parentEl: Element,
  containerRect: DOMRect,
): void {
  if (!frame.layout?.autoLayout) return;

  const parentRect = parentEl.getBoundingClientRect();
  const padLeft = frame.layout.paddingLeft ?? 0;
  const padTop = frame.layout.paddingTop ?? 0;

  // Pre-compute non-absolute child count for row sizing inference (avoids O(n²))
  const nonAbsCount = frame.children.filter((c) => !c.absolutePosition).length;

  for (const child of frame.children) {
    // Skip absolute-positioned children — they keep their relative coords
    if (child.absolutePosition) {
      child.x = child.x - (parentRect.left - containerRect.left) - padLeft;
      child.y = child.y - (parentRect.top - containerRect.top) - padTop;
      continue;
    }

    // For auto-layout children, zero out both axes
    // (the layout engine recomputes all positions from gap/padding/justify)
    child.x = 0;
    child.y = 0;

    // Infer sizing mode
    inferChildSizing(child, frame, nonAbsCount);
  }
}

/** Infer sizing mode for a child inside an auto-layout parent */
function inferChildSizing(
  child: SceneNode,
  parentFrame: FrameNode,
  nonAbsCount: number,
): void {
  // Check if child width matches parent content width (fill_container)
  const parentContentWidth =
    parentFrame.width -
    (parentFrame.layout?.paddingLeft ?? 0) -
    (parentFrame.layout?.paddingRight ?? 0);
  const parentContentHeight =
    parentFrame.height -
    (parentFrame.layout?.paddingTop ?? 0) -
    (parentFrame.layout?.paddingBottom ?? 0);

  const widthRatio = child.width / parentContentWidth;
  const heightRatio = child.height / parentContentHeight;

  let widthMode: SizingMode = "fixed";
  let heightMode: SizingMode = "fixed";

  if (parentFrame.layout?.flexDirection === "column") {
    // If child width is ~100% of parent content width, use fill_container
    if (widthRatio > 0.95) {
      widthMode = "fill_container";
    }
  } else if (parentFrame.layout?.flexDirection === "row") {
    // For row layouts, check if children are equal-width (grid-like)
    if (nonAbsCount > 1) {
      const gap = parentFrame.layout?.gap ?? 0;
      const expectedChildWidth = (parentContentWidth - gap * (nonAbsCount - 1)) / nonAbsCount;
      // If this child's width is close to the expected equal share, use fill_container
      if (expectedChildWidth > 0 && Math.abs(child.width - expectedChildWidth) / expectedChildWidth < 0.1) {
        widthMode = "fill_container";
      }
    }
    if (heightRatio > 0.95) {
      heightMode = "fill_container";
    }
  }

  if (widthMode !== "fixed" || heightMode !== "fixed") {
    child.sizing = { widthMode, heightMode };
  }
}

/** Parse CSS box-shadow into a ShadowEffect */
function parseShadow(boxShadow: string): ShadowEffect | null {
  if (!boxShadow || boxShadow === "none") return null;

  // Parse first shadow: offsetX offsetY blur spread color
  // e.g. "rgb(0, 0, 0) 2px 4px 6px 0px" or "2px 4px 6px 0px rgba(0,0,0,0.25)"
  const match = boxShadow.match(
    /(?:(-?[\d.]+)px)\s+(?:(-?[\d.]+)px)\s+(?:([\d.]+)px)(?:\s+([\d.]+)px)?/,
  );
  if (!match) return null;

  const offsetX = parseFloat(match[1]) || 0;
  const offsetY = parseFloat(match[2]) || 0;
  const blur = parseFloat(match[3]) || 0;
  const spread = parseFloat(match[4]) || 0;

  // Extract color
  const colorMatch = boxShadow.match(/rgba?\([^)]+\)/);
  const color = colorMatch ? cssColorToHex(colorMatch[0]) : "#000000";

  // Parse alpha from rgba
  const alphaMatch = boxShadow.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
  const alpha = alphaMatch ? Math.round(parseFloat(alphaMatch[1]) * 255) : 64;
  const alphaHex = alpha.toString(16).padStart(2, "0");

  return {
    type: "shadow",
    shadowType: "outer",
    color: color + alphaHex,
    offset: { x: offsetX, y: offsetY },
    blur,
    spread,
  };
}

/** Create a RectNode from an <hr> element */
function createRectFromStyle(
  _el: Element,
  style: CSSStyleDeclaration,
  x: number,
  y: number,
  w: number,
  h: number,
): RectNode {
  const node: RectNode = {
    id: generateId(),
    type: "rect",
    name: "Divider",
    x, y, width: w, height: Math.max(h, 1),
  };

  const borderColor = parseFillColor(style.borderTopColor);
  const bgColor = parseFillColor(style.backgroundColor);
  node.fill = bgColor ?? borderColor ?? "#cccccc";

  return node;
}
