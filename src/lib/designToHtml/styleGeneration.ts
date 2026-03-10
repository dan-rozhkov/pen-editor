import type { BaseNode, TextNode, FrameNode, RectNode, ShadowEffect, GradientFill, ImageFill, PerSideStroke, ColorBinding } from "@/types/scene";
import type { Variable } from "@/types/variable";
import { applyOpacity } from "@/utils/colorUtils";
import { hasPerCornerRadius } from "@/utils/renderUtils";
import { useVariableStore } from "@/store/variableStore";

/**
 * Resolve a color binding to a CSS variable reference, e.g. `var(--primary, #ff0000)`.
 * Returns null if no binding or variable not found.
 */
function resolveBindingToCssVar(
  binding: ColorBinding | undefined,
  fallbackColor: string,
  variables: Variable[],
): string | null {
  if (!binding) return null;
  const variable = variables.find((v) => v.id === binding.variableId);
  if (!variable) return null;
  return `var(${variable.name}, ${fallbackColor})`;
}

/**
 * Generate inline CSS for visual properties (fill, stroke, effects, etc.)
 */
export function generateVisualStyles(node: BaseNode): Record<string, string> {
  const styles: Record<string, string> = {};
  const { variables } = useVariableStore.getState();

  // Fill / background
  if (node.gradientFill) {
    styles.background = generateGradientCss(node.gradientFill);
  } else if (node.imageFill) {
    Object.assign(styles, generateImageFillCss(node.imageFill));
  } else if (node.fill) {
    const rawColor = applyOpacity(node.fill, node.fillOpacity);
    const color = resolveBindingToCssVar(node.fillBinding, rawColor, variables) ?? rawColor;
    if (node.type === "text") {
      styles.color = color;
    } else {
      styles["background-color"] = color;
    }
  }

  // Stroke / border
  if (node.stroke && (node.strokeWidth || node.strokeWidthPerSide)) {
    const rawStrokeColor = applyOpacity(node.stroke, node.strokeOpacity);
    const strokeColor = resolveBindingToCssVar(node.strokeBinding, rawStrokeColor, variables) ?? rawStrokeColor;
    if (node.strokeWidthPerSide) {
      Object.assign(styles, generatePerSideBorderCss(node.strokeWidthPerSide, strokeColor));
    } else if (node.strokeWidth) {
      if (node.strokeAlign === "outside") {
        styles.outline = `${node.strokeWidth}px solid ${strokeColor}`;
      } else {
        styles.border = `${node.strokeWidth}px solid ${strokeColor}`;
        if (node.strokeAlign === "inside") {
          styles["box-sizing"] = "border-box";
        }
      }
    }
  }

  // Corner radius (only on frame and rect nodes)
  if (node.type === "frame" || node.type === "rect") {
    const pcr = (node as FrameNode | RectNode).cornerRadiusPerCorner;
    const cornerRadius = (node as FrameNode | RectNode).cornerRadius;
    if (pcr && hasPerCornerRadius(pcr)) {
      styles["border-radius"] = `${pcr.topLeft ?? 0}px ${pcr.topRight ?? 0}px ${pcr.bottomRight ?? 0}px ${pcr.bottomLeft ?? 0}px`;
    } else if (cornerRadius !== undefined && cornerRadius > 0) {
      styles["border-radius"] = `${cornerRadius}px`;
    }
  }

  // Ellipse special case
  if (node.type === "ellipse") {
    styles["border-radius"] = "50%";
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity < 1) {
    styles.opacity = String(node.opacity);
  }

  // Shadow effects
  if (node.effect) {
    styles["box-shadow"] = generateShadowCss(node.effect);
  }

  // Rotation and flip transforms
  const transforms: string[] = [];
  if (node.rotation) {
    transforms.push(`rotate(${node.rotation}deg)`);
  }
  if (node.flipX || node.flipY) {
    const sx = node.flipX ? -1 : 1;
    const sy = node.flipY ? -1 : 1;
    transforms.push(`scale(${sx}, ${sy})`);
  }
  if (transforms.length > 0) {
    styles.transform = transforms.join(" ");
  }

  return styles;
}

/**
 * Generate inline CSS for text-specific properties
 */
export function generateTextStyles(node: TextNode): Record<string, string> {
  const styles: Record<string, string> = {};

  if (node.fontSize) {
    styles["font-size"] = `${node.fontSize}px`;
  }
  if (node.fontFamily) {
    styles["font-family"] = `'${node.fontFamily}'`;
  }
  if (node.fontWeight && node.fontWeight !== "normal") {
    styles["font-weight"] = node.fontWeight;
  }
  if (node.fontStyle === "italic") {
    styles["font-style"] = "italic";
  }
  if (node.textAlign) {
    styles["text-align"] = node.textAlign;
  }
  if (node.lineHeight !== undefined) {
    styles["line-height"] = String(node.lineHeight);
  }
  if (node.letterSpacing !== undefined && node.letterSpacing !== 0) {
    styles["letter-spacing"] = `${node.letterSpacing}px`;
  }

  // Text decoration
  const decorations: string[] = [];
  if (node.underline) decorations.push("underline");
  if (node.strikethrough) decorations.push("line-through");
  if (decorations.length > 0) {
    styles["text-decoration"] = decorations.join(" ");
  }

  if (node.textTransform && node.textTransform !== "none") {
    styles["text-transform"] = node.textTransform;
  }

  // Auto-width text should not wrap
  if (node.textWidthMode === "auto") {
    styles["white-space"] = "nowrap";
  }

  // Vertical alignment via align-content for block text
  if (node.textAlignVertical && node.textAlignVertical !== "top") {
    const map: Record<string, string> = {
      middle: "center",
      bottom: "end",
    };
    styles["align-content"] = map[node.textAlignVertical] ?? node.textAlignVertical;
  }

  return styles;
}

function generateGradientCss(gradient: GradientFill): string {
  const stops = gradient.stops
    .map((s) => {
      const color = s.opacity !== undefined && s.opacity < 1
        ? applyOpacity(s.color, s.opacity)
        : s.color;
      return `${color} ${Math.round(s.position * 100)}%`;
    })
    .join(", ");

  if (gradient.type === "radial") {
    return `radial-gradient(${stops})`;
  }

  // Linear gradient: compute angle from start/end points
  const dx = gradient.endX - gradient.startX;
  const dy = gradient.endY - gradient.startY;
  const angle = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
  return `linear-gradient(${angle}deg, ${stops})`;
}

function generateImageFillCss(imageFill: ImageFill): Record<string, string> {
  const styles: Record<string, string> = {};
  styles["background-image"] = `url("${imageFill.url}")`;
  styles["background-repeat"] = "no-repeat";

  switch (imageFill.mode) {
    case "fill":
      styles["background-size"] = "cover";
      styles["background-position"] = "center";
      break;
    case "fit":
      styles["background-size"] = "contain";
      styles["background-position"] = "center";
      break;
    case "stretch":
      styles["background-size"] = "100% 100%";
      break;
  }

  return styles;
}

function generatePerSideBorderCss(
  perSide: PerSideStroke,
  color: string,
): Record<string, string> {
  const styles: Record<string, string> = {};
  if (perSide.top) styles["border-top"] = `${perSide.top}px solid ${color}`;
  if (perSide.right) styles["border-right"] = `${perSide.right}px solid ${color}`;
  if (perSide.bottom) styles["border-bottom"] = `${perSide.bottom}px solid ${color}`;
  if (perSide.left) styles["border-left"] = `${perSide.left}px solid ${color}`;
  return styles;
}

function generateShadowCss(effect: ShadowEffect): string {
  const inset = effect.shadowType === "inner" ? "inset " : "";
  return `${inset}${effect.offset.x}px ${effect.offset.y}px ${effect.blur}px ${effect.spread}px ${effect.color}`;
}
