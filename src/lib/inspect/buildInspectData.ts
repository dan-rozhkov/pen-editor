import type {
  FlatSceneNode,
  PerCornerRadius,
  ShadowEffect,
  BlurEffect,
  BackgroundBlurEffect,
  PathStroke,
} from "@/types/scene";
import type { Variable, ThemeName } from "@/types/variable";
import type { FillStyle, EffectStyle } from "@/types/style";
import type { TextStyle } from "@/types/textStyle";
import type { InspectUnits } from "@/store/devModeStore";
import {
  getFills,
  getRenderableFills,
  resolveFillStylePaint,
  resolveEffectStack,
} from "@/utils/fillUtils";
import { resolveVariableValue } from "@/utils/colorUtils";
import { buildCSSGradient } from "@/utils/gradientUtils";
import { formatLength } from "./units";

export interface InspectValue {
  label: string;
  value: string;
  copyValue?: string;
  token?: { name: string; light: string; dark: string };
  /** CSS background used for a compact color or gradient preview. */
  swatchBackground?: string;
}

export interface InspectSection {
  title: string;
  rows: InspectValue[];
}

export interface InspectData {
  header: {
    name: string;
    type: string;
    componentInfo?: { componentId: string; propertyValues?: Record<string, string | boolean> };
  };
  box: {
    width: number;
    height: number;
    borderTop: number;
    borderRight: number;
    borderBottom: number;
    borderLeft: number;
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    cornerRadius?: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
    gap?: number;
  };
  sections: InspectSection[];
}

export interface BuildInspectDataInput {
  nodeId: string;
  nodesById: Record<string, FlatSceneNode>;
  rect: { x: number; y: number; width: number; height: number };
  variables: Variable[];
  fillStyles: FillStyle[];
  effectStyles: EffectStyle[];
  textStyles: TextStyle[];
  units: InspectUnits;
  remBase: number;
  /**
   * The node's effective theme (innermost ancestor `themeOverride`, or the
   * global active theme) — used to resolve variable-bound color values to
   * the theme actually rendered for this node, instead of hardcoding
   * "light". See `getEffectiveThemeForNode` (src/utils/nodeThemeUtils.ts).
   */
  effectiveTheme: ThemeName;
}

function fmt(px: number, units: InspectUnits, remBase: number): string {
  return formatLength(px, units, remBase);
}

/**
 * Shorthand a 4-value box (CSS top/right/bottom/left order): one value when
 * uniform, two when top===bottom && right===left, otherwise all four.
 * Mirrors `generatePaddingCss` (src/lib/designToHtml/layoutStyleGeneration.ts).
 */
function shorthand(top: number, right: number, bottom: number, left: number, units: InspectUnits, remBase: number): string {
  if (top === right && right === bottom && bottom === left) {
    return fmt(top, units, remBase);
  }
  if (top === bottom && right === left) {
    return `${fmt(top, units, remBase)} ${fmt(right, units, remBase)}`;
  }
  return [top, right, bottom, left].map((v) => fmt(v, units, remBase)).join(" ");
}

interface BoxMetrics {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  gap?: number;
}

interface BoxBorderMetrics {
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  borderLeft: number;
}

/** Derive box-model border widths from the node's shared or per-side stroke. */
function computeBoxBorderMetrics(node: FlatSceneNode): BoxBorderMetrics {
  if (node.strokeWidthPerSide) {
    const { top = 0, right = 0, bottom = 0, left = 0 } = node.strokeWidthPerSide;
    return { borderTop: top, borderRight: right, borderBottom: bottom, borderLeft: left };
  }

  const pathStroke: PathStroke | undefined = node.type === "path" ? node.pathStroke : undefined;
  const width = node.strokeWidth ?? pathStroke?.thickness ?? 0;
  return { borderTop: width, borderRight: width, borderBottom: width, borderLeft: width };
}

function computeBoxCornerRadius(
  node: FlatSceneNode,
): { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number } | undefined {
  if (node.type !== "frame" && node.type !== "rect") return undefined;

  if (node.cornerRadiusPerCorner) {
    const { topLeft = 0, topRight = 0, bottomRight = 0, bottomLeft = 0 } = node.cornerRadiusPerCorner;
    return { topLeft, topRight, bottomRight, bottomLeft };
  }

  const radius = node.cornerRadius ?? 0;
  return { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius };
}

/**
 * Derive padding + gap from a node's auto-layout config (0/undefined for
 * non-auto-layout frames). Shared by `buildLayoutSection` (rows) and
 * `buildInspectData` (the box-model diagram) so the two never drift.
 */
function computeBoxMetrics(node: FlatSceneNode): BoxMetrics {
  const layout = node.type === "frame" ? node.layout : undefined;
  if (!layout?.autoLayout) {
    return { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 };
  }
  const gap =
    layout.flexDirection === "column"
      ? layout.rowGap ?? layout.gap ?? 0
      : layout.columnGap ?? layout.gap ?? 0;
  return {
    paddingTop: layout.paddingTop ?? 0,
    paddingRight: layout.paddingRight ?? 0,
    paddingBottom: layout.paddingBottom ?? 0,
    paddingLeft: layout.paddingLeft ?? 0,
    gap,
  };
}

function buildLayoutSection(node: FlatSceneNode, units: InspectUnits, remBase: number): InspectSection | undefined {
  if (node.type !== "frame" || !node.layout?.autoLayout) return undefined;
  const layout = node.layout;
  const rows: InspectValue[] = [];

  rows.push({ label: "Direction", value: layout.flexDirection ?? "row" });

  const { paddingTop, paddingRight, paddingBottom, paddingLeft, gap } = computeBoxMetrics(node);
  rows.push({ label: "Gap", value: fmt(gap ?? 0, units, remBase) });

  rows.push({
    label: "Padding",
    value: shorthand(paddingTop, paddingRight, paddingBottom, paddingLeft, units, remBase),
  });

  if (layout.alignItems) {
    rows.push({ label: "Align", value: layout.alignItems });
  }
  if (layout.justifyContent) {
    rows.push({ label: "Justify", value: layout.justifyContent });
  }

  return { title: "Layout", rows };
}

function buildTypographySection(
  node: FlatSceneNode,
  textStyles: TextStyle[],
  units: InspectUnits,
  remBase: number,
): InspectSection | undefined {
  if (node.type !== "text") return undefined;
  const rows: InspectValue[] = [];

  if (node.fontFamily !== undefined) {
    rows.push({ label: "Family", value: node.fontFamily });
  }
  if (node.fontWeight !== undefined) {
    rows.push({ label: "Weight", value: node.fontWeight });
  }
  if (node.fontSize !== undefined) {
    rows.push({ label: "Size", value: fmt(node.fontSize, units, remBase) });
  }
  if (node.lineHeight !== undefined) {
    rows.push({ label: "Line height", value: String(node.lineHeight) });
  }
  if (node.letterSpacing !== undefined) {
    rows.push({ label: "Letter spacing", value: fmt(node.letterSpacing, units, remBase) });
  }
  if (node.textAlign !== undefined) {
    rows.push({ label: "Align", value: node.textAlign });
  }
  if (node.textStyleId) {
    const style = textStyles.find((s) => s.id === node.textStyleId);
    if (style) {
      rows.push({ label: "Style", value: style.name });
    }
  }
  rows.push({ label: "Text", value: node.text });

  return { title: "Typography", rows };
}

/** Build the light/dark token summary shown on an expandable variable-bound row. */
function buildToken(variable: Variable): { name: string; light: string; dark: string } {
  return {
    name: variable.name,
    light: variable.themeValues?.light ?? variable.value,
    dark: variable.themeValues?.dark ?? variable.value,
  };
}

function getPaintSwatchBackground(paint: ReturnType<typeof getFills>[number]): string | undefined {
  if (paint.type === "solid") return paint.color;
  if (paint.type === "gradient") {
    if (paint.gradient.type === "radial") {
      const stops = [...paint.gradient.stops]
        .sort((a, b) => a.position - b.position)
        .map((stop) => `${stop.color} ${Math.round(stop.position * 100)}%`)
        .join(", ");
      return `radial-gradient(circle, ${stops})`;
    }
    return buildCSSGradient(paint.gradient.stops);
  }
  return undefined;
}

function describeFillPaint(
  paint: ReturnType<typeof getFills>[number],
  variables: Variable[],
  fillStyles: FillStyle[],
  effectiveTheme: ThemeName,
): InspectValue {
  if (paint.styleId) {
    const style = fillStyles.find((s) => s.id === paint.styleId);
    if (style) {
      const resolved = resolveFillStylePaint(paint, fillStyles);
      const copyValue = resolved.type === "solid" ? resolved.color : style.name;
      return {
        label: "Fill",
        value: style.name,
        copyValue,
        swatchBackground: getPaintSwatchBackground(resolved),
      };
    }
  }

  if (paint.type === "solid") {
    const displayValue = resolveVariableValue(paint.color, paint.colorBinding, variables, effectiveTheme) ?? paint.color;
    if (paint.colorBinding) {
      const variable = variables.find((v) => v.id === paint.colorBinding!.variableId);
      if (variable) {
        return {
          label: "Fill",
          value: displayValue,
          token: buildToken(variable),
          swatchBackground: displayValue,
        };
      }
    }
    return { label: "Fill", value: displayValue, swatchBackground: displayValue };
  }

  if (paint.type === "gradient") {
    return {
      label: "Fill",
      value: `Gradient (${paint.gradient.type})`,
      swatchBackground: getPaintSwatchBackground(paint),
    };
  }
  if (paint.type === "image") return { label: "Fill", value: "Image" };
  if (paint.type === "pattern") return { label: "Fill", value: "Pattern" };
  return { label: "Fill", value: "Video" };
}

function buildFillsSection(
  node: FlatSceneNode,
  variables: Variable[],
  fillStyles: FillStyle[],
  effectiveTheme: ThemeName,
): InspectSection | undefined {
  const fills = getRenderableFills(node);
  if (!fills.length) return undefined;
  const rows = fills.map((paint, i) => {
    const row = describeFillPaint(paint, variables, fillStyles, effectiveTheme);
    if (fills.length > 1) row.label = `Fill ${i + 1}`;
    return row;
  });
  return { title: "Fills", rows };
}

function buildStrokesSection(
  node: FlatSceneNode,
  variables: Variable[],
  units: InspectUnits,
  remBase: number,
  effectiveTheme: ThemeName,
): InspectSection | undefined {
  const pathStroke: PathStroke | undefined = node.type === "path" ? node.pathStroke : undefined;
  const strokeColor = node.stroke ?? pathStroke?.fill;
  const strokeWidth = node.strokeWidth ?? pathStroke?.thickness;
  const strokeAlign = node.strokeAlign ?? pathStroke?.align;

  const hasStroke =
    strokeColor !== undefined || strokeWidth !== undefined || node.strokeWidthPerSide !== undefined;
  if (!hasStroke) return undefined;
  const rows: InspectValue[] = [];

  if (strokeColor !== undefined) {
    const displayValue = resolveVariableValue(strokeColor, node.strokeBinding, variables, effectiveTheme) ?? strokeColor;
    if (node.strokeBinding) {
      const variable = variables.find((v) => v.id === node.strokeBinding!.variableId);
      if (variable) {
        rows.push({
          label: "Color",
          value: displayValue,
          token: buildToken(variable),
          swatchBackground: displayValue,
        });
      } else {
        rows.push({ label: "Color", value: displayValue, swatchBackground: displayValue });
      }
    } else {
      rows.push({ label: "Color", value: displayValue, swatchBackground: displayValue });
    }
  }

  if (node.strokeWidthPerSide !== undefined) {
    const { top = 0, right = 0, bottom = 0, left = 0 } = node.strokeWidthPerSide;
    rows.push({ label: "Width", value: shorthand(top, right, bottom, left, units, remBase) });
  } else if (strokeWidth !== undefined) {
    rows.push({ label: "Width", value: fmt(strokeWidth, units, remBase) });
  }
  if (strokeAlign !== undefined) {
    rows.push({ label: "Align", value: strokeAlign });
  }

  return { title: "Strokes", rows };
}

function describeEffect(effect: ShadowEffect | BlurEffect | BackgroundBlurEffect, units: InspectUnits, remBase: number): InspectValue {
  if (effect.type === "shadow") {
    const label = effect.shadowType === "inner" ? "Inner shadow" : "Shadow";
    const value = `${fmt(effect.offset.x, units, remBase)} ${fmt(effect.offset.y, units, remBase)} ${fmt(effect.blur, units, remBase)} ${fmt(effect.spread, units, remBase)} ${effect.color}`;
    return { label, value, swatchBackground: effect.color };
  }
  if (effect.type === "blur") {
    return { label: "Blur", value: fmt(effect.radius, units, remBase) };
  }
  return { label: "Background blur", value: fmt(effect.radius, units, remBase) };
}

function buildEffectsSection(
  node: FlatSceneNode,
  effectStyles: EffectStyle[],
  units: InspectUnits,
  remBase: number,
): InspectSection | undefined {
  const effects = resolveEffectStack(node, effectStyles);
  if (!effects.length) return undefined;
  return { title: "Effects", rows: effects.map((e) => describeEffect(e, units, remBase)) };
}

function buildRadiusSection(node: FlatSceneNode, units: InspectUnits, remBase: number): InspectSection | undefined {
  if (node.type !== "frame" && node.type !== "rect") return undefined;
  const perCorner: PerCornerRadius | undefined = node.cornerRadiusPerCorner;
  if (perCorner) {
    const tl = perCorner.topLeft ?? 0;
    const tr = perCorner.topRight ?? 0;
    const br = perCorner.bottomRight ?? 0;
    const bl = perCorner.bottomLeft ?? 0;
    if (tl === tr && tr === br && br === bl) {
      return { title: "Radius", rows: [{ label: "Radius", value: fmt(tl, units, remBase) }] };
    }
    const value = [tl, tr, br, bl].map((v) => fmt(v, units, remBase)).join(" ");
    return { title: "Radius", rows: [{ label: "Radius", value }] };
  }
  if (node.cornerRadius !== undefined) {
    return { title: "Radius", rows: [{ label: "Radius", value: fmt(node.cornerRadius, units, remBase) }] };
  }
  return undefined;
}

export function buildInspectData(input: BuildInspectDataInput): InspectData | null {
  const { nodeId, nodesById, rect, variables, fillStyles, effectStyles, textStyles, units, remBase, effectiveTheme } = input;
  const node = nodesById[nodeId];
  if (!node) return null;

  const { paddingTop, paddingRight, paddingBottom, paddingLeft, gap } = computeBoxMetrics(node);
  const { borderTop, borderRight, borderBottom, borderLeft } = computeBoxBorderMetrics(node);
  const cornerRadius = computeBoxCornerRadius(node);

  const header: InspectData["header"] = {
    name: node.name ?? node.type,
    type: node.type,
  };
  if (node.type === "ref") {
    header.componentInfo = { componentId: node.componentId, propertyValues: node.propertyValues };
  }

  const sections: InspectSection[] = [];
  const layoutSection = buildLayoutSection(node, units, remBase);
  if (layoutSection) sections.push(layoutSection);

  const typographySection = buildTypographySection(node, textStyles, units, remBase);
  if (typographySection) sections.push(typographySection);

  const fillsSection = buildFillsSection(node, variables, fillStyles, effectiveTheme);
  if (fillsSection) sections.push(fillsSection);

  const strokesSection = buildStrokesSection(node, variables, units, remBase, effectiveTheme);
  if (strokesSection) sections.push(strokesSection);

  const effectsSection = buildEffectsSection(node, effectStyles, units, remBase);
  if (effectsSection) sections.push(effectsSection);

  const radiusSection = buildRadiusSection(node, units, remBase);
  if (radiusSection) sections.push(radiusSection);

  return {
    header,
    box: {
      width: rect.width,
      height: rect.height,
      borderTop,
      borderRight,
      borderBottom,
      borderLeft,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      cornerRadius,
      gap,
    },
    sections,
  };
}
