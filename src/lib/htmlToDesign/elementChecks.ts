/** Extract padding values from computed style */
export function parsePadding(style: CSSStyleDeclaration) {
  return {
    paddingTop: parseFloat(style.paddingTop) || 0,
    paddingRight: parseFloat(style.paddingRight) || 0,
    paddingBottom: parseFloat(style.paddingBottom) || 0,
    paddingLeft: parseFloat(style.paddingLeft) || 0,
  };
}

/** Flatten only plain inline text wrappers. Keep styled or container-like text elements as frames. */
export function shouldFlattenTextOnlyElement(
  style: CSSStyleDeclaration,
  tag: string,
): boolean {
  const semanticTextTag = /^(h[1-6]|p|span|strong|em|small|label)$/i.test(tag);
  if (tag === "a" || tag === "button") return false;
  if (!semanticTextTag && style.display !== "inline") return false;
  if (style.cursor === "pointer") return false;
  if (hasVisualStyling(style)) return false;
  if (!semanticTextTag && hasBoxSpacing(style)) return false;
  if (hasExplicitDimensions(style)) return false;
  return true;
}

/** Check if an element has direct text content (not just whitespace) */
export function hasDirectTextContent(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      return true;
    }
  }
  return false;
}

/** Check if an element has visual styling worth preserving */
export function hasVisualStyling(style: CSSStyleDeclaration): boolean {
  const bg = style.backgroundColor;
  if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return true;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderRight = parseFloat(style.borderRightWidth) || 0;
  const borderBottom = parseFloat(style.borderBottomWidth) || 0;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  if (borderTop > 0 || borderRight > 0 || borderBottom > 0 || borderLeft > 0) return true;
  const shadow = style.boxShadow;
  if (shadow && shadow !== "none") return true;
  return false;
}

/** Check if an element has non-zero margin/padding that should be preserved as a container */
function hasBoxSpacing(style: CSSStyleDeclaration): boolean {
  const pad = parsePadding(style);
  if (pad.paddingTop > 0 || pad.paddingRight > 0 || pad.paddingBottom > 0 || pad.paddingLeft > 0) return true;

  const margins = [
    parseFloat(style.marginTop) || 0,
    parseFloat(style.marginRight) || 0,
    parseFloat(style.marginBottom) || 0,
    parseFloat(style.marginLeft) || 0,
  ];
  return margins.some((v) => v > 0);
}

/** Check if CSS explicitly defines width/height that should keep the node as a frame */
function hasExplicitDimensions(style: CSSStyleDeclaration): boolean {
  const width = style.width?.trim().toLowerCase() ?? "";
  const height = style.height?.trim().toLowerCase() ?? "";
  const hasWidth = width !== "" && width !== "auto";
  const hasHeight = height !== "" && height !== "auto";
  return hasWidth || hasHeight;
}

/** Infer a reasonable name from an HTML element */
export function inferFrameName(el: Element): string {
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
