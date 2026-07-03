import type { BaseNode, TextNode, FrameNode, RectNode, ShadowEffect, BlurEffect, GradientFill, ImageFill, PerSideStroke, ColorBinding, SolidPaint, GradientPaint, ImagePaint } from "@/types/scene";
import type { Variable } from "@/types/variable";
import { applyOpacity } from "@/utils/colorUtils";
import { hasPerCornerRadius } from "@/utils/renderUtils";
import { useVariableStore } from "@/store/variableStore";
import { getRenderableFills, getRenderableEffects, getPrimarySolidPaint } from "@/utils/fillUtils";
import { imageModeToCssSize } from "@/lib/cssBackground";

/**
 * CSS properties emitted by `generateFillCss` for a node's background.
 * Owned here so consumers that need to strip the generated background (e.g.
 * SVG shape wrappers in convertNode) cannot drift from what is emitted.
 */
export const BACKGROUND_STYLE_KEYS = [
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "background-blend-mode",
] as const;

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

  // Fill / background — from the paint stack (bottom-to-top).
  Object.assign(styles, generateFillCss(node, variables));

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

  // Effects — from the effect stack (bottom-to-top).
  // CSS box-shadow lists paint the FIRST shadow on top, but our stack is
  // bottom-to-top, so reverse the stack to get correct visual stacking.
  const effects = getRenderableEffects(node);
  const shadowCss = effects
    .filter((e): e is ShadowEffect => e.type === "shadow")
    .slice()
    .reverse()
    .map(generateShadowCss)
    .join(", ");
  if (shadowCss) {
    styles["box-shadow"] = shadowCss;
  }
  // Layer blur: first visible blur with radius > 0 wins (matches the renderer).
  const blurEffect = effects.find(
    (e): e is BlurEffect => e.type === "blur" && e.radius > 0,
  );
  if (blurEffect) {
    styles.filter = `blur(${blurEffect.radius}px)`;
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

/**
 * Build the per-layer CSS properties for an image fill. The `mode` ↔
 * `background-size` mapping is shared with htmlToDesign via
 * `@/lib/cssBackground` so the roundtrip stays in sync (no-repeat always).
 */
function imageFillLayerCss(imageFill: ImageFill): {
  image: string;
  size: string;
  position: string;
  repeat: string;
} {
  return {
    image: `url("${imageFill.url}")`,
    size: imageModeToCssSize(imageFill.mode),
    position: imageFill.mode === "stretch" ? "0% 0%" : "center",
    repeat: "no-repeat",
  };
}

/**
 * Build the CSS fill declarations for a node's renderable paint stack.
 *
 * Ordering: our `fills` array is bottom-to-top (fills[0] is the bottom), but
 * CSS multiple-background lists paint the FIRST item on top. So whenever we
 * emit a `background-image` list we reverse the stack (top-to-bottom).
 *
 * Single-solid stacks collapse to `background-color` (or `color` for text).
 * Per-layer `opacity` is baked into the solid/gradient colors; CSS has no
 * per-layer image opacity, so image-layer opacity is intentionally ignored
 * (documented simplification).
 */
function generateFillCss(node: BaseNode, variables: Variable[]): Record<string, string> {
  const styles: Record<string, string> = {};

  // Text nodes color their glyphs; use the primary solid paint's own
  // opacity/binding. For legacy nodes the derived paint already carries
  // `fillOpacity`/`fillBinding` (see legacyFillsToPaints), so one branch
  // covers both representations.
  if (node.type === "text") {
    const primary = getPrimarySolidPaint(node);
    if (primary) {
      const rawColor = applyOpacity(primary.color, primary.opacity);
      styles.color = resolveBindingToCssVar(primary.colorBinding, rawColor, variables) ?? rawColor;
    }
    return styles;
  }

  const paints = getRenderableFills(node);
  if (paints.length === 0) return styles;

  // Single solid layer → background-color (preserve legacy behavior incl.
  // variable binding resolution from the legacy fillBinding field).
  if (paints.length === 1 && paints[0].type === "solid") {
    const solid = paints[0] as SolidPaint;
    const rawColor = applyOpacity(solid.color, solid.opacity);
    const binding = solid.colorBinding ?? node.fillBinding;
    styles["background-color"] = resolveBindingToCssVar(binding, rawColor, variables) ?? rawColor;
    return styles;
  }

  // Multiple layers / gradients / images → CSS multiple backgrounds.
  // Reverse the stack so CSS list order is top-to-bottom.
  const ordered = paints.slice().reverse();

  const images: string[] = [];
  const sizes: string[] = [];
  const positions: string[] = [];
  const repeats: string[] = [];
  const blendModes: string[] = [];
  let hasBlend = false;
  let bottomColor: string | undefined;

  ordered.forEach((paint, idx) => {
    const isBottommost = idx === ordered.length - 1;
    if (paint.type === "solid") {
      const solid = paint as SolidPaint;
      const binding = solid.colorBinding ?? (isBottommost ? node.fillBinding : undefined);
      const rawColor = applyOpacity(solid.color, solid.opacity);
      const color = resolveBindingToCssVar(binding, rawColor, variables) ?? rawColor;
      // The bottommost solid can be expressed via background-color; any other
      // solid layer becomes a flat linear-gradient so it can sit in the list.
      if (isBottommost) {
        bottomColor = color;
        return;
      }
      images.push(`linear-gradient(${color}, ${color})`);
      sizes.push("auto");
      positions.push("0% 0%");
      repeats.push("repeat");
    } else if (paint.type === "gradient") {
      images.push(generateGradientCss((paint as GradientPaint).gradient, paint.opacity));
      sizes.push("auto");
      positions.push("0% 0%");
      repeats.push("repeat");
    } else {
      const layer = imageFillLayerCss((paint as ImagePaint).image);
      images.push(layer.image);
      sizes.push(layer.size);
      positions.push(layer.position);
      repeats.push(layer.repeat);
    }
    blendModes.push(paint.blendMode ?? "normal");
    if (paint.blendMode && paint.blendMode !== "normal") hasBlend = true;
  });

  if (images.length > 0) {
    styles["background-image"] = images.join(", ");
    styles["background-size"] = sizes.join(", ");
    styles["background-position"] = positions.join(", ");
    styles["background-repeat"] = repeats.join(", ");
    if (hasBlend) {
      styles["background-blend-mode"] = blendModes.join(", ");
    }
  }
  if (bottomColor !== undefined) {
    styles["background-color"] = bottomColor;
  }

  return styles;
}

function generateGradientCss(gradient: GradientFill, layerOpacity?: number): string {
  const factor = layerOpacity ?? 1;
  const stops = gradient.stops
    .map((s) => {
      const stopOpacity = s.opacity !== undefined ? s.opacity : 1;
      const effective = stopOpacity * factor;
      const color = effective < 1 ? applyOpacity(s.color, effective) : s.color;
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
