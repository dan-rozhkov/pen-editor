import type {
  AlignItems,
  FrameNode,
  GroupNode,
  JustifyContent,
  Paint,
  PathStroke,
  SceneNode,
  ShaderConfig,
  TextNode,
} from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import { getEffects, getFills, getRenderableStrokes } from "@/utils/fillUtils";
import { anchorsToSVGPath } from "@/utils/pathAnchors";

type PenTheme = Record<string, string>;
type PenSize = number | "fill_container" | "fit_content";

type PenVariableScalar = string | number | boolean;

interface PenVariableDefinition {
  type: "color" | "number" | "string" | "boolean";
  value:
    | PenVariableScalar
    | { value: PenVariableScalar; theme?: PenTheme }[];
}

interface PenColorFill {
  type: "color";
  color: string;
}

interface PenGradientFill {
  type: "gradient";
  gradientType: "linear" | "radial";
  colors: { color: string; position: number }[];
  center?: { x?: number; y?: number };
  size?: { width?: number; height?: number };
  opacity?: number;
}

interface PenImageFill {
  type: "image";
  url: string;
  mode?: "stretch" | "fill" | "fit";
  opacity?: number;
}

interface PenPatternFill {
  type: "pattern";
  url: string;
  scale?: number;
  spacingX?: number;
  spacingY?: number;
  offsetX?: number;
  offsetY?: number;
  rowOffset?: number;
  opacity?: number;
}

type PenFill = string | PenColorFill | PenGradientFill | PenImageFill | PenPatternFill;

interface PenStroke {
  align?: "inside" | "center" | "outside";
  thickness?: number | { top?: number; right?: number; bottom?: number; left?: number };
  fill?: PenFill;
  // Paint stack, bottom-to-top; present instead of "fill" when a node has 2+
  // visible stroke paints (gradient/multi-paint stroke). Mirrors
  // PenBaseNode.fill/fills.
  fills?: PenFill[];
}

interface PenShadowEffect {
  type: "shadow";
  shadowType?: "inner" | "outer";
  offset?: { x: number; y: number };
  spread?: number;
  blur?: number;
  color?: string;
  visible?: boolean;
}

interface PenBlurEffect {
  type: "blur";
  radius: number;
  visible?: boolean;
}

interface PenBackgroundBlurEffect {
  type: "background-blur";
  radius: number;
  visible?: boolean;
}

type PenEffect = PenShadowEffect | PenBlurEffect | PenBackgroundBlurEffect;

interface PenBaseNode {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  width?: PenSize;
  height?: PenSize;
  fill?: PenFill;
  // Paint stack, bottom-to-top; present instead of "fill" when a node has 2+ fills
  fills?: PenFill[];
  stroke?: PenStroke;
  effect?: PenEffect[];
  opacity?: number;
  enabled?: boolean;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  reusable?: boolean;
  theme?: PenTheme;
  shader?: ShaderConfig;
  // Figma-style layer mask: clips siblings rendered above this node within
  // the same parent. See `BaseNode.isMask` in `@/types/scene`.
  isMask?: boolean;
  // Min/max clamps applied to the resolved width/height inside an auto-layout
  // parent, regardless of sizing mode.
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

interface PenFrameNode extends PenBaseNode {
  type: "frame";
  children: PenNode[];
  layout?: "none" | "vertical" | "horizontal";
  wrap?: boolean;
  gap?: number;
  // Present instead of `gap` when row/column gaps diverge.
  rowGap?: number;
  columnGap?: number;
  padding?: number | [number, number] | [number, number, number, number];
  justifyContent?: "start" | "center" | "end" | "space_between" | "space_around";
  alignItems?: "start" | "center" | "end";
  clip?: boolean;
  cornerRadius?: number;
  cornerRadiusPerCorner?: { topLeft?: number; topRight?: number; bottomRight?: number; bottomLeft?: number };
  cornerSmoothing?: number;
}

interface PenRectangleNode extends PenBaseNode {
  type: "rectangle";
  cornerRadius?: number;
  cornerRadiusPerCorner?: { topLeft?: number; topRight?: number; bottomRight?: number; bottomLeft?: number };
  cornerSmoothing?: number;
}

interface PenEllipseNode extends PenBaseNode {
  type: "ellipse";
}

interface PenPathNode extends PenBaseNode {
  type: "path";
  geometry?: string;
  fillRule?: "nonzero" | "evenodd";
}

interface PenTextNode extends PenBaseNode {
  type: "text";
  content: string;
  textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  underline?: boolean;
  strikethrough?: boolean;
  textAlign?: "left" | "center" | "right" | "justify";
  textAlignVertical?: "top" | "middle" | "bottom";
  lineHeight?: number;
  letterSpacing?: number;
  /**
   * Text-on-a-path (mirrors `TextNode.textPath` in `@/types/scene`). This
   * hand-written exporter has its own schema (`PenTextNode`) separate from
   * the internal `SceneNode` shape, so — unlike `serializeDocument`'s bare
   * `JSON.stringify` round-trip, which carries `textPath` for free — it must
   * be mapped explicitly or a public-export consumer would silently see
   * straight text. `path` is the same SVG `d` string convention as
   * `PenPathNode.geometry` (built via `anchorsToSVGPath`).
   */
  path?: string;
  pathStartOffset?: number;
  pathSide?: "left" | "right";
  pathFlip?: boolean;
}

type PenNode = PenFrameNode | PenRectangleNode | PenEllipseNode | PenPathNode | PenTextNode;

interface PenDocument {
  version: string;
  themes?: Record<string, string[]>;
  variables?: Record<string, PenVariableDefinition>;
  children: PenNode[];
}

interface ExportContext {
  variableNamesById: Map<string, string>;
}

const THEME_AXIS = "mode";
const PUBLIC_PEN_VERSION = "2.6";

type FillSource = Pick<
  SceneNode,
  "fill" | "fillBinding" | "fillOpacity" | "imageFill" | "gradientFill" | "fills"
>;

type StrokeSource = Pick<
  SceneNode,
  | "stroke"
  | "strokeBinding"
  | "strokeOpacity"
  | "strokeWidth"
  | "strokeWidthPerSide"
  | "strokeAlign"
  | "strokes"
> & { pathStroke?: PathStroke };

function sanitizeVariableName(name: string, fallbackId: string): string {
  const normalized = name
    .trim()
    .replace(/[:]/g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallbackId;
}

function buildVariableNameMap(variables: Variable[]): Map<string, string> {
  const names = new Set<string>();
  const mapped = new Map<string, string>();

  for (const variable of variables) {
    const base = sanitizeVariableName(variable.name, variable.id);
    let next = base;
    let suffix = 2;
    while (names.has(next)) {
      next = `${base}-${suffix}`;
      suffix += 1;
    }
    names.add(next);
    mapped.set(variable.id, next);
  }

  return mapped;
}

function parseVariableValue(type: Variable["type"], raw: string): string | number {
  if (type !== "number") return raw;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function exportVariables(variables: Variable[], variableNamesById: Map<string, string>) {
  if (variables.length === 0) return undefined;

  const exported: Record<string, PenVariableDefinition> = {};

  for (const variable of variables) {
    const variableName = variableNamesById.get(variable.id);
    if (!variableName) continue;

    const lightValue = parseVariableValue(
      variable.type,
      variable.themeValues?.light ?? variable.value,
    );
    const darkValue = parseVariableValue(
      variable.type,
      variable.themeValues?.dark ?? variable.value,
    );

    exported[variableName] =
      lightValue === darkValue
        ? { type: variable.type, value: lightValue }
        : {
            type: variable.type,
            value: [
              { value: lightValue, theme: { [THEME_AXIS]: "light" } },
              { value: darkValue, theme: { [THEME_AXIS]: "dark" } },
            ],
          };
  }

  return exported;
}

function applyOpacityToHex(color: string, opacity = 1): string {
  if (!color.startsWith("#")) return color;

  let hex = color.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  if (hex.length !== 6 && hex.length !== 8) return color;

  const rgb = hex.slice(0, 6);
  const baseAlpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  const nextAlpha = Math.max(0, Math.min(1, baseAlpha * opacity));
  const alpha = Math.round(nextAlpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${rgb}${alpha}`;
}

function getVariableRef(variableId: string | undefined, context: ExportContext): string | undefined {
  if (!variableId) return undefined;
  const variableName = context.variableNamesById.get(variableId);
  return variableName ? `$${variableName}` : undefined;
}

function exportSolidFill(
  color: string | undefined,
  variableId: string | undefined,
  opacity: number | undefined,
  context: ExportContext,
): PenFill | undefined {
  const variableRef = getVariableRef(variableId, context);
  if (variableRef) return variableRef;
  if (!color) return undefined;
  if (opacity == null || opacity === 1) return color;
  return { type: "color", color: applyOpacityToHex(color, opacity) };
}

function exportPaint(
  paint: Paint,
  context: ExportContext,
  fallbackOpacity?: number,
): PenFill | undefined {
  if (paint.visible === false) return undefined;
  const layerOpacity = paint.opacity ?? fallbackOpacity;
  if (paint.type === "image") {
    return {
      type: "image",
      url: paint.image.url,
      mode: paint.image.mode,
      ...(layerOpacity != null ? { opacity: layerOpacity } : {}),
    };
  }
  if (paint.type === "pattern") {
    const p = paint.pattern;
    return {
      type: "pattern",
      url: p.url,
      ...(p.scale != null ? { scale: p.scale } : {}),
      ...(p.spacingX != null ? { spacingX: p.spacingX } : {}),
      ...(p.spacingY != null ? { spacingY: p.spacingY } : {}),
      ...(p.offsetX != null ? { offsetX: p.offsetX } : {}),
      ...(p.offsetY != null ? { offsetY: p.offsetY } : {}),
      ...(p.rowOffset != null ? { rowOffset: p.rowOffset } : {}),
      ...(layerOpacity != null ? { opacity: layerOpacity } : {}),
    };
  }
  if (paint.type === "gradient") {
    const g = paint.gradient;
    return {
      type: "gradient",
      gradientType: g.type,
      colors: g.stops.map((stop) => ({
        color:
          stop.opacity == null || stop.opacity === 1
            ? stop.color
            : applyOpacityToHex(stop.color, stop.opacity),
        position: stop.position,
      })),
      center: { x: (g.startX + g.endX) / 2, y: (g.startY + g.endY) / 2 },
      size:
        g.type === "radial"
          ? {
              width: Math.abs(g.endX - g.startX) * 2,
              height: Math.abs(g.endY - g.startY) * 2,
            }
          : { height: Math.hypot(g.endX - g.startX, g.endY - g.startY) },
      ...(layerOpacity != null ? { opacity: layerOpacity } : {}),
    };
  }
  // Video fills have no equivalent in the public .pen export format — drop them
  // (documented out-of-scope simplification; the live editor + HTML export
  // handle video, but this static export format has no video paint variant).
  if (paint.type === "video") return undefined;
  return exportSolidFill(paint.color, paint.colorBinding?.variableId, layerOpacity, context);
}

function exportFills(
  node: FillSource,
  context: ExportContext,
): { fill?: PenFill; fills?: PenFill[] } {
  const paints = getFills(node).filter((p) => p.visible !== false);
  // Legacy-derived stacks (no `fills` on the node): legacyFillsToPaints only
  // copies `fillOpacity` onto solid paints, but the pre-stack exporter applied
  // it to gradient/image fills too — keep that output identical via fallback.
  const fallbackOpacity = node.fills ? undefined : node.fillOpacity;
  const exported = paints
    .map((p) => exportPaint(p, context, fallbackOpacity))
    .filter((f): f is PenFill => f !== undefined);
  if (exported.length === 0) return {};
  if (exported.length === 1) return { fill: exported[0] };
  return { fills: exported };
}

function exportStroke(node: StrokeSource, context: ExportContext): PenStroke | undefined {
  const paints = getRenderableStrokes(node);
  // Legacy-derived stroke stacks (no `strokes` on the node) fold `strokeOpacity`
  // into the single solid paint already (see legacyStrokesToPaints), so no
  // separate fallback-opacity plumbing is needed here (unlike exportFills).
  const exported = paints
    .map((p) => exportPaint(p, context))
    .filter((f): f is PenFill => f !== undefined);
  const thickness = node.strokeWidthPerSide ?? node.strokeWidth;

  if (exported.length === 0 && thickness == null && !node.strokeAlign) return undefined;

  return {
    ...(node.strokeAlign ? { align: node.strokeAlign } : {}),
    ...(thickness != null ? { thickness } : {}),
    ...(exported.length === 1 ? { fill: exported[0] } : {}),
    ...(exported.length > 1 ? { fills: exported } : {}),
  };
}

function exportEffects(node: SceneNode): PenEffect[] | undefined {
  const effects = getEffects(node);
  if (effects.length === 0) return undefined;
  return effects.map((e): PenEffect => {
    if (e.type === "blur" || e.type === "background-blur") {
      return {
        type: e.type,
        radius: e.radius,
        ...(e.visible === false ? { visible: false } : {}),
      };
    }
    return {
      type: "shadow",
      shadowType: e.shadowType,
      offset: e.offset,
      spread: e.spread,
      blur: e.blur,
      color: e.color,
      ...(e.visible === false ? { visible: false } : {}),
    };
  });
}

function mapAlignItems(value: AlignItems | undefined) {
  switch (value) {
    case "flex-start":
      return "start" as const;
    case "center":
      return "center" as const;
    case "flex-end":
      return "end" as const;
    default:
      return undefined;
  }
}

function mapJustifyContent(value: JustifyContent | undefined) {
  switch (value) {
    case "flex-start":
      return "start" as const;
    case "center":
      return "center" as const;
    case "flex-end":
      return "end" as const;
    case "space-between":
      return "space_between" as const;
    case "space-around":
    case "space-evenly":
      return "space_around" as const;
    default:
      return undefined;
  }
}

function exportPadding(layout: FrameNode["layout"]) {
  if (!layout) return undefined;
  const top = layout.paddingTop ?? 0;
  const right = layout.paddingRight ?? 0;
  const bottom = layout.paddingBottom ?? 0;
  const left = layout.paddingLeft ?? 0;

  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && right === left) return [top, right] as [number, number];
  return [top, right, bottom, left] as [number, number, number, number];
}

function exportSize(node: SceneNode, parentUsesLayout: boolean): Pick<PenBaseNode, "width" | "height"> {
  const widthMode = node.sizing?.widthMode;
  const heightMode = node.sizing?.heightMode;

  return {
    width: parentUsesLayout && widthMode && widthMode !== "fixed" ? widthMode : node.width,
    height: parentUsesLayout && heightMode && heightMode !== "fixed" ? heightMode : node.height,
  };
}

function exportNodeBase(node: SceneNode, context: ExportContext, parentUsesLayout: boolean): PenBaseNode {
  const { fill, fills } = exportFills(node, context);
  const stroke = exportStroke(node, context);
  const effect = exportEffects(node);

  return {
    id: node.id,
    ...(node.name ? { name: node.name } : {}),
    ...(!parentUsesLayout || node.absolutePosition ? { x: node.x, y: node.y } : {}),
    ...exportSize(node, parentUsesLayout),
    ...(fill !== undefined ? { fill } : {}),
    ...(fills ? { fills } : {}),
    ...(stroke ? { stroke } : {}),
    ...(effect ? { effect } : {}),
    ...(node.opacity != null && node.opacity !== 1 ? { opacity: node.opacity } : {}),
    ...(node.visible === false || node.enabled === false ? { enabled: false } : {}),
    ...(node.rotation != null && node.rotation !== 0 ? { rotation: node.rotation } : {}),
    ...(node.flipX ? { flipX: true } : {}),
    ...(node.flipY ? { flipY: true } : {}),
    ...(node.type === "frame" && node.reusable ? { reusable: true } : {}),
    ...(node.type === "frame" && node.themeOverride
      ? { theme: { [THEME_AXIS]: node.themeOverride } }
      : {}),
    ...(node.shader ? { shader: node.shader } : {}),
    ...(node.isMask ? { isMask: true } : {}),
    ...(node.sizing?.minWidth != null ? { minWidth: node.sizing.minWidth } : {}),
    ...(node.sizing?.maxWidth != null ? { maxWidth: node.sizing.maxWidth } : {}),
    ...(node.sizing?.minHeight != null ? { minHeight: node.sizing.minHeight } : {}),
    ...(node.sizing?.maxHeight != null ? { maxHeight: node.sizing.maxHeight } : {}),
  };
}

function mapTextGrowth(mode: TextNode["textWidthMode"]): PenTextNode["textGrowth"] {
  switch (mode) {
    case "fixed":
      return "fixed-width";
    case "fixed-height":
      return "fixed-width-height";
    case "auto":
    default:
      return "auto";
  }
}

function exportTextNode(node: TextNode, context: ExportContext, parentUsesLayout: boolean): PenTextNode {
  const base = exportNodeBase(node, context, parentUsesLayout);
  const textGrowth = mapTextGrowth(node.textWidthMode);
  const tp = node.textPath;

  return {
    ...base,
    type: "text",
    content: node.text,
    textGrowth,
    ...(node.fontFamily ? { fontFamily: node.fontFamily } : {}),
    ...(node.fontSize != null ? { fontSize: node.fontSize } : {}),
    ...(node.fontWeight ? { fontWeight: node.fontWeight } : {}),
    ...(node.fontStyle ? { fontStyle: node.fontStyle } : {}),
    ...(node.underline ? { underline: true } : {}),
    ...(node.strikethrough ? { strikethrough: true } : {}),
    ...(node.textAlign ? { textAlign: node.textAlign } : {}),
    ...(node.textAlignVertical ? { textAlignVertical: node.textAlignVertical } : {}),
    ...(node.lineHeight != null ? { lineHeight: node.lineHeight } : {}),
    ...(node.letterSpacing != null ? { letterSpacing: node.letterSpacing } : {}),
    ...(tp
      ? {
          path: anchorsToSVGPath(tp.points, tp.closed ?? false),
          pathStartOffset: tp.startOffset,
          pathSide: tp.side,
          ...(tp.flip ? { pathFlip: true } : {}),
        }
      : {}),
  };
}

function pointsToPath(points: number[], close: boolean): string | undefined {
  if (points.length < 4) return undefined;

  const commands: string[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    commands.push(`${i === 0 ? "M" : "L"} ${x} ${y}`);
  }
  if (close) commands.push("Z");
  return commands.join(" ");
}

function exportFrameNode(
  node: FrameNode | GroupNode,
  context: ExportContext,
  parentUsesLayout: boolean,
): PenFrameNode {
  const usesLayout = node.type === "frame" && !!node.layout?.autoLayout;
  const padding = node.type === "frame" ? exportPadding(node.layout) : undefined;
  const justifyContent = node.type === "frame" ? mapJustifyContent(node.layout?.justifyContent) : undefined;
  const alignItems = node.type === "frame" ? mapAlignItems(node.layout?.alignItems) : undefined;
  const flexWrap = node.type === "frame" && node.layout?.flexWrap;
  const gap = node.type === "frame" ? node.layout?.gap : undefined;
  const rawRowGap = node.type === "frame" ? node.layout?.rowGap : undefined;
  const rawColumnGap = node.type === "frame" ? node.layout?.columnGap : undefined;
  // Mirror the engine's resolution (buildContainer in yogaLayout.ts): each
  // per-axis gap falls back to the shared `gap` when unset, so a rowGap-only
  // override (e.g. { rowGap: 24, gap: 8 }) must still export a resolved
  // columnGap of 8 — not silently collapse to { gap: 8 }.
  const resolvedRowGap = rawRowGap ?? gap;
  const resolvedColumnGap = rawColumnGap ?? gap;
  const gapDiverges =
    resolvedRowGap != null &&
    resolvedColumnGap != null &&
    resolvedRowGap !== resolvedColumnGap;

  return {
    ...exportNodeBase(node, context, parentUsesLayout),
    type: "frame",
    children: node.children.map((child) => exportNode(child, context, usesLayout)),
    ...(usesLayout
      ? {
          layout: node.layout?.flexDirection === "column" ? "vertical" : "horizontal",
          ...(flexWrap ? { wrap: true } : {}),
          ...(gapDiverges
            ? { rowGap: resolvedRowGap, columnGap: resolvedColumnGap }
            : gap != null || resolvedRowGap != null
              ? { gap: gap ?? resolvedRowGap }
              : {}),
          ...(padding != null ? { padding } : {}),
          ...(justifyContent ? { justifyContent } : {}),
          ...(alignItems ? { alignItems } : {}),
        }
      : { layout: "none" }),
    ...(node.type === "frame" && node.clip ? { clip: true } : {}),
    ...(node.type === "frame" && node.isSlot ? { isSlot: true } : {}),
    ...(node.type === "frame" && node.cornerRadius != null ? { cornerRadius: node.cornerRadius } : {}),
    ...(node.type === "frame" && node.cornerRadiusPerCorner != null ? { cornerRadiusPerCorner: node.cornerRadiusPerCorner } : {}),
    ...(node.type === "frame" && node.cornerSmoothing != null ? { cornerSmoothing: node.cornerSmoothing } : {}),
  };
}

function exportNode(node: SceneNode, context: ExportContext, parentUsesLayout: boolean): PenNode {
  switch (node.type) {
    case "frame":
    case "group":
      return exportFrameNode(node, context, parentUsesLayout);
    case "rect":
      return {
        ...exportNodeBase(node, context, parentUsesLayout),
        type: "rectangle",
        ...(node.cornerRadius != null ? { cornerRadius: node.cornerRadius } : {}),
        ...(node.cornerRadiusPerCorner != null ? { cornerRadiusPerCorner: node.cornerRadiusPerCorner } : {}),
        ...(node.cornerSmoothing != null ? { cornerSmoothing: node.cornerSmoothing } : {}),
      };
    case "ellipse":
      return {
        ...exportNodeBase(node, context, parentUsesLayout),
        type: "ellipse",
      };
    case "text":
      return exportTextNode(node, context, parentUsesLayout);
    case "path":
      return {
        ...exportNodeBase(node, context, parentUsesLayout),
        type: "path",
        geometry: node.geometry,
        ...(node.fillRule ? { fillRule: node.fillRule } : {}),
      };
    case "line":
      return {
        ...exportNodeBase(node, context, parentUsesLayout),
        type: "path",
        geometry: pointsToPath(node.points, false),
      };
    case "polygon":
      return {
        ...exportNodeBase(node, context, parentUsesLayout),
        type: "path",
        geometry: pointsToPath(node.points, true),
      };
    case "embed":
    case "ref":
    case "connector":
      return {
        ...exportNodeBase(node, context, parentUsesLayout),
        type: "frame",
        layout: "none",
        children: [],
      };
  }
}

export function serializePublicPenDocument(
  nodes: SceneNode[],
  variables: Variable[],
  _activeTheme: ThemeName,
): string {
  const variableNamesById = buildVariableNameMap(variables);
  const exportedVariables = exportVariables(variables, variableNamesById);
  const context: ExportContext = { variableNamesById };

  const document: PenDocument = {
    version: PUBLIC_PEN_VERSION,
    ...(exportedVariables ? { themes: { [THEME_AXIS]: ["light", "dark"] } } : {}),
    ...(exportedVariables ? { variables: exportedVariables } : {}),
    children: nodes.map((node) => exportNode(node, context, false)),
  };

  return JSON.stringify(document, null, 2);
}
