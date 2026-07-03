import type {
  Effect,
  FrameNode,
  TextNode,
  RectNode,
  ShadowEffect,
} from "@/types/scene";
import { generateId } from "@/types/scene";
import { imageModeFromCssSize } from "@/lib/cssBackground";
import { parseColorWithOpacity, cssColorToHex, extractCssUrl } from "./colorParsing";
import { parseCssGradient } from "./gradientParsing";
import { parseBackgroundToPaints } from "./backgroundParsing";
import { splitSelectorList } from "./cssScoping";

/** Apply base visual properties from CSS to a frame/rect node */
export function applyBaseProps(
  node: FrameNode | RectNode,
  style: CSSStyleDeclaration,
): void {
  // Background — prefer a multi-layer paint stack when CSS describes more than
  // one background layer; otherwise fall back to the legacy single-fill fields.
  const multiPaints = parseBackgroundToPaints({
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    backgroundSize: style.backgroundSize,
    backgroundBlendMode: style.backgroundBlendMode,
  });
  if (multiPaints) {
    node.fills = multiPaints;
  }

  // Background color (legacy single-fill path; skipped when fills is set)
  if (!multiPaints) {
    const fill = parseColorWithOpacity(style.backgroundColor);
    if (fill) {
      node.fill = fill.color;
      if (fill.opacity !== undefined) node.fillOpacity = fill.opacity;
    }
  }

  // Corner radius
  const tlr = parseFloat(style.borderTopLeftRadius) || 0;
  const trr = parseFloat(style.borderTopRightRadius) || 0;
  const brr = parseFloat(style.borderBottomRightRadius) || 0;
  const blr = parseFloat(style.borderBottomLeftRadius) || 0;
  if (tlr > 0 || trr > 0 || brr > 0 || blr > 0) {
    if (tlr === trr && trr === brr && brr === blr) {
      node.cornerRadius = tlr;
    } else {
      node.cornerRadiusPerCorner = {
        topLeft: tlr || undefined,
        topRight: trr || undefined,
        bottomRight: brr || undefined,
        bottomLeft: blr || undefined,
      };
    }
  }

  // Border/stroke
  const borderTopWidth = parseFloat(style.borderTopWidth) || 0;
  const borderRightWidth = parseFloat(style.borderRightWidth) || 0;
  const borderBottomWidth = parseFloat(style.borderBottomWidth) || 0;
  const borderLeftWidth = parseFloat(style.borderLeftWidth) || 0;
  const borderTopColor = parseColorWithOpacity(style.borderTopColor);
  const borderRightColor = parseColorWithOpacity(style.borderRightColor);
  const borderBottomColor = parseColorWithOpacity(style.borderBottomColor);
  const borderLeftColor = parseColorWithOpacity(style.borderLeftColor);
  const borderTopStyle = style.borderTopStyle;
  const borderRightStyle = style.borderRightStyle;
  const borderBottomStyle = style.borderBottomStyle;
  const borderLeftStyle = style.borderLeftStyle;

  const hasTop =
    borderTopWidth > 0 &&
    borderTopStyle !== "none" &&
    borderTopStyle !== "hidden" &&
    !!borderTopColor?.color;
  const hasRight =
    borderRightWidth > 0 &&
    borderRightStyle !== "none" &&
    borderRightStyle !== "hidden" &&
    !!borderRightColor?.color;
  const hasBottom =
    borderBottomWidth > 0 &&
    borderBottomStyle !== "none" &&
    borderBottomStyle !== "hidden" &&
    !!borderBottomColor?.color;
  const hasLeft =
    borderLeftWidth > 0 &&
    borderLeftStyle !== "none" &&
    borderLeftStyle !== "hidden" &&
    !!borderLeftColor?.color;

  if (hasTop || hasRight || hasBottom || hasLeft) {
    const activeBorderColors = [
      hasTop ? borderTopColor : null,
      hasRight ? borderRightColor : null,
      hasBottom ? borderBottomColor : null,
      hasLeft ? borderLeftColor : null,
    ].filter((color): color is NonNullable<typeof color> => !!color?.color);
    const firstActiveBorderColor = activeBorderColors[0];

    if (firstActiveBorderColor) {
      node.stroke = firstActiveBorderColor.color;
      if (firstActiveBorderColor.opacity !== undefined) {
        node.strokeOpacity = firstActiveBorderColor.opacity;
      }
    }

    const isUniformStroke =
      hasTop &&
      hasRight &&
      hasBottom &&
      hasLeft &&
      borderTopWidth === borderRightWidth &&
      borderTopWidth === borderBottomWidth &&
      borderTopWidth === borderLeftWidth &&
      borderTopColor?.color === borderRightColor?.color &&
      borderTopColor?.color === borderBottomColor?.color &&
      borderTopColor?.color === borderLeftColor?.color &&
      borderTopColor?.opacity === borderRightColor?.opacity &&
      borderTopColor?.opacity === borderBottomColor?.opacity &&
      borderTopColor?.opacity === borderLeftColor?.opacity;

    if (isUniformStroke) {
      node.strokeWidth = borderTopWidth;
      node.strokeWidthPerSide = undefined;
    } else {
      node.strokeWidth = undefined;
      node.strokeWidthPerSide = {
        top: hasTop ? borderTopWidth : 0,
        right: hasRight ? borderRightWidth : 0,
        bottom: hasBottom ? borderBottomWidth : 0,
        left: hasLeft ? borderLeftWidth : 0,
      };
    }
  }

  // Background image → imageFill (legacy single-fill path; skipped when the
  // multi-layer paint stack already captured the backgrounds).
  const bgImage = style.backgroundImage;
  if (!multiPaints && bgImage && bgImage !== "none") {
    const gradient = parseCssGradient(bgImage);
    if (gradient) {
      node.gradientFill = gradient;
    } else {
      const bgUrl = extractCssUrl(bgImage);
      if (bgUrl) {
        node.imageFill = { url: bgUrl, mode: imageModeFromCssSize(style.backgroundSize) };
      }
    }
  }

  // Opacity
  const opacity = parseFloat(style.opacity);
  if (opacity < 1) node.opacity = opacity;

  // Overflow → clip
  if (node.type === "frame" && (style.overflow === "hidden" || style.overflowX === "hidden")) {
    node.clip = true;
  }

  // Box shadow + filter blur → effect (single shadow) or effects (stack)
  const shadows = parseShadows(style.boxShadow);
  const blurRadius = parseBlurRadius(style.filter);
  const allEffects: Effect[] = blurRadius != null
    ? [...shadows, { type: "blur", radius: blurRadius }]
    : shadows;
  if (allEffects.length === 1 && allEffects[0].type === "shadow") {
    node.effect = allEffects[0];
  } else if (allEffects.length > 0) {
    node.effects = allEffects;
  }
}

/** Apply text-relevant base properties (fill from background, opacity) */
export function applyBasePropsToText(node: TextNode, style: CSSStyleDeclaration): void {
  const opacity = parseFloat(style.opacity);
  if (opacity < 1) node.opacity = opacity;
}

/** Apply typography properties from CSS to a TextNode */
export function applyTextProps(node: TextNode, style: CSSStyleDeclaration): void {
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
  const color = parseColorWithOpacity(style.color);
  if (color) {
    node.fill = color.color;
    if (color.opacity !== undefined) node.fillOpacity = color.opacity;
  }

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

  // Text transform
  const textTransform = style.textTransform;
  if (textTransform && textTransform !== "none") {
    node.textTransform = textTransform as TextNode["textTransform"];
  }
}

/** Parse a single CSS box-shadow segment into a ShadowEffect */
export function parseShadow(boxShadow: string): ShadowEffect | null {
  if (!boxShadow || boxShadow === "none") return null;

  const isInset = /(^|\s)inset(\s|$)/i.test(boxShadow);

  // Parse offsetX offsetY blur spread (blur/spread optional)
  // e.g. "rgb(0, 0, 0) 2px 4px 6px 0px" or "2px 4px 6px 0px rgba(0,0,0,0.25)"
  const match = boxShadow.match(
    /(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+([\d.]+)px)?(?:\s+(-?[\d.]+)px)?/,
  );
  if (!match) return null;

  const offsetX = parseFloat(match[1]) || 0;
  const offsetY = parseFloat(match[2]) || 0;
  const blur = match[3] !== undefined ? parseFloat(match[3]) || 0 : 0;
  const spread = match[4] !== undefined ? parseFloat(match[4]) || 0 : 0;

  // Extract color
  const colorMatch = boxShadow.match(/rgba?\([^)]+\)/);
  const color = colorMatch ? cssColorToHex(colorMatch[0]) : "#000000";

  // Parse alpha from rgba
  const alphaMatch = boxShadow.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
  const alpha = alphaMatch ? Math.round(parseFloat(alphaMatch[1]) * 255) : 64;
  const alphaHex = alpha.toString(16).padStart(2, "0");

  return {
    type: "shadow",
    shadowType: isInset ? "inner" : "outer",
    color: color + alphaHex,
    offset: { x: offsetX, y: offsetY },
    blur,
    spread,
  };
}

/**
 * Parse CSS box-shadow (possibly a comma-separated list) into ShadowEffects.
 *
 * CSS lists the first shadow on top; our effect stack is bottom-to-top, so the
 * returned array reverses the CSS order. Commas inside `rgba(...)` are not
 * treated as list separators.
 */
export function parseShadows(boxShadow: string): ShadowEffect[] {
  if (!boxShadow || boxShadow === "none") return [];
  const segments = splitSelectorList(boxShadow);
  const shadows: Effect[] = [];
  for (const segment of segments) {
    const shadow = parseShadow(segment);
    if (shadow) shadows.push(shadow);
  }
  // CSS top-to-bottom → bottom-to-top stack.
  return (shadows.reverse() as ShadowEffect[]);
}

/** Parse a CSS `filter` value; returns the blur radius in px, or null. */
export function parseBlurRadius(filter: string): number | null {
  if (!filter || filter === "none") return null;
  const match = filter.match(/(?:^|\s)blur\(\s*([\d.]+)px\s*\)/);
  if (!match) return null;
  const radius = parseFloat(match[1]);
  return radius > 0 ? radius : null;
}

/** Create a RectNode from an <hr> element */
export function createRectFromStyle(
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

  const borderColor = parseColorWithOpacity(style.borderTopColor);
  const bgColor = parseColorWithOpacity(style.backgroundColor);
  if (bgColor) {
    node.fill = bgColor.color;
    if (bgColor.opacity !== undefined) node.fillOpacity = bgColor.opacity;
  } else if (borderColor) {
    node.fill = borderColor.color;
    if (borderColor.opacity !== undefined) node.fillOpacity = borderColor.opacity;
  } else {
    node.fill = "#cccccc";
  }

  return node;
}
