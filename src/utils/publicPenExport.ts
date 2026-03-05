import type {
  AlignItems,
  DescendantOverride,
  DescendantOverrides,
  FrameNode,
  GroupNode,
  JustifyContent,
  SceneNode,
  TextNode,
} from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";

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

type PenFill = string | PenColorFill | PenGradientFill | PenImageFill;

interface PenStroke {
  align?: "inside" | "center" | "outside";
  thickness?: number | { top?: number; right?: number; bottom?: number; left?: number };
  fill?: PenFill;
}

interface PenShadowEffect {
  type: "shadow";
  shadowType?: "inner" | "outer";
  offset?: { x: number; y: number };
  spread?: number;
  blur?: number;
  color?: string;
}

interface PenBaseNode {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  width?: PenSize;
  height?: PenSize;
  fill?: PenFill;
  stroke?: PenStroke;
  effect?: PenShadowEffect[];
  opacity?: number;
  enabled?: boolean;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  reusable?: boolean;
  theme?: PenTheme;
}

interface PenFrameNode extends PenBaseNode {
  type: "frame";
  children: PenNode[];
  layout?: "none" | "vertical" | "horizontal";
  gap?: number;
  padding?: number | [number, number] | [number, number, number, number];
  justifyContent?: "start" | "center" | "end" | "space_between" | "space_around";
  alignItems?: "start" | "center" | "end";
  clip?: boolean;
  cornerRadius?: number;
}

interface PenRectangleNode extends PenBaseNode {
  type: "rectangle";
  cornerRadius?: number;
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
}

interface PenRefNode extends PenBaseNode {
  type: "ref";
  ref: string;
  descendants?: Record<string, Record<string, unknown>>;
}

type PenNode = PenFrameNode | PenRectangleNode | PenEllipseNode | PenPathNode | PenTextNode | PenRefNode;

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
  "fill" | "fillBinding" | "fillOpacity" | "imageFill" | "gradientFill"
>;

type StrokeSource = Pick<
  SceneNode,
  "stroke" | "strokeBinding" | "strokeOpacity" | "strokeWidth" | "strokeWidthPerSide" | "strokeAlign"
>;

type TextOverride = DescendantOverride & Partial<TextNode>;

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

function exportFill(node: FillSource, context: ExportContext): PenFill | undefined {
  if (node.imageFill) {
    return {
      type: "image",
      url: node.imageFill.url,
      mode: node.imageFill.mode,
      ...(node.fillOpacity != null ? { opacity: node.fillOpacity } : {}),
    };
  }

  if (node.gradientFill) {
    return {
      type: "gradient",
      gradientType: node.gradientFill.type,
      colors: node.gradientFill.stops.map((stop) => ({
        color:
          stop.opacity == null || stop.opacity === 1
            ? stop.color
            : applyOpacityToHex(stop.color, stop.opacity),
        position: stop.position,
      })),
      center: {
        x: (node.gradientFill.startX + node.gradientFill.endX) / 2,
        y: (node.gradientFill.startY + node.gradientFill.endY) / 2,
      },
      size:
        node.gradientFill.type === "radial"
          ? {
              width: Math.abs(node.gradientFill.endX - node.gradientFill.startX) * 2,
              height: Math.abs(node.gradientFill.endY - node.gradientFill.startY) * 2,
            }
          : {
              height: Math.hypot(
                node.gradientFill.endX - node.gradientFill.startX,
                node.gradientFill.endY - node.gradientFill.startY,
              ),
            },
      ...(node.fillOpacity != null ? { opacity: node.fillOpacity } : {}),
    };
  }

  return exportSolidFill(node.fill, node.fillBinding?.variableId, node.fillOpacity, context);
}

function exportStroke(node: StrokeSource, context: ExportContext): PenStroke | undefined {
  const fill = exportSolidFill(
    node.stroke,
    node.strokeBinding?.variableId,
    node.strokeOpacity,
    context,
  );
  const thickness = node.strokeWidthPerSide ?? node.strokeWidth;

  if (!fill && thickness == null && !node.strokeAlign) return undefined;

  return {
    ...(node.strokeAlign ? { align: node.strokeAlign } : {}),
    ...(thickness != null ? { thickness } : {}),
    ...(fill ? { fill } : {}),
  };
}

function exportEffects(node: SceneNode): PenShadowEffect[] | undefined {
  if (!node.effect) return undefined;
  return [
    {
      type: "shadow",
      shadowType: node.effect.shadowType,
      offset: node.effect.offset,
      spread: node.effect.spread,
      blur: node.effect.blur,
      color: node.effect.color,
    },
  ];
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
  const fill = exportFill(node, context);
  const stroke = exportStroke(node, context);
  const effect = exportEffects(node);

  return {
    id: node.id,
    ...(node.name ? { name: node.name } : {}),
    ...(!parentUsesLayout || node.absolutePosition ? { x: node.x, y: node.y } : {}),
    ...exportSize(node, parentUsesLayout),
    ...(fill ? { fill } : {}),
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

function exportOverride(override: DescendantOverride, context: ExportContext): Record<string, unknown> {
  const exported: Record<string, unknown> = {};
  const textOverride = override as TextOverride;

  if (override.name) exported.name = override.name;
  if (override.x != null) exported.x = override.x;
  if (override.y != null) exported.y = override.y;
  if (override.width != null) exported.width = override.width;
  if (override.height != null) exported.height = override.height;
  if (override.opacity != null) exported.opacity = override.opacity;
  if (override.enabled === false) exported.enabled = false;
  if (override.rotation != null) exported.rotation = override.rotation;
  if (override.flipX) exported.flipX = true;
  if (override.flipY) exported.flipY = true;
  if (override.fill || override.fillBinding || override.imageFill || override.gradientFill) {
    const fill = exportFill(override as FillSource, context);
    if (fill) exported.fill = fill;
  }
  if (override.stroke || override.strokeBinding || override.strokeWidth != null || override.strokeWidthPerSide) {
    const stroke = exportStroke(override as StrokeSource, context);
    if (stroke) exported.stroke = stroke;
  }
  if ("cornerRadius" in override && override.cornerRadius != null) {
    exported.cornerRadius = override.cornerRadius;
  }
  if (override.text != null) exported.content = override.text;
  if (textOverride.fontFamily) exported.fontFamily = textOverride.fontFamily;
  if (textOverride.fontSize != null) exported.fontSize = textOverride.fontSize;
  if (textOverride.fontWeight) exported.fontWeight = textOverride.fontWeight;
  if (textOverride.fontStyle) exported.fontStyle = textOverride.fontStyle;
  if (textOverride.textAlign) exported.textAlign = textOverride.textAlign;
  if (textOverride.textAlignVertical) exported.textAlignVertical = textOverride.textAlignVertical;
  if (textOverride.lineHeight != null) exported.lineHeight = textOverride.lineHeight;
  if (textOverride.letterSpacing != null) exported.letterSpacing = textOverride.letterSpacing;
  if (textOverride.underline) exported.underline = true;
  if (textOverride.strikethrough) exported.strikethrough = true;
  if (textOverride.textWidthMode) {
    exported.textGrowth = mapTextGrowth(textOverride.textWidthMode);
  }

  return exported;
}

function flattenDescendantOverrides(
  overrides: DescendantOverrides | undefined,
  context: ExportContext,
  prefix = "",
): Record<string, Record<string, unknown>> | undefined {
  if (!overrides) return undefined;

  const exported: Record<string, Record<string, unknown>> = {};
  for (const [id, override] of Object.entries(overrides)) {
    const path = prefix ? `${prefix}/${id}` : id;
    const own = exportOverride(override, context);
    if (Object.keys(own).length > 0) exported[path] = own;

    const nested = flattenDescendantOverrides(override.descendants, context, path);
    if (nested) Object.assign(exported, nested);
  }

  return Object.keys(exported).length > 0 ? exported : undefined;
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

  return {
    ...exportNodeBase(node, context, parentUsesLayout),
    type: "frame",
    children: node.children.map((child) => exportNode(child, context, usesLayout)),
    ...(usesLayout
      ? {
          layout: node.layout?.flexDirection === "column" ? "vertical" : "horizontal",
          ...(node.layout?.gap != null ? { gap: node.layout.gap } : {}),
          ...(padding != null ? { padding } : {}),
          ...(justifyContent ? { justifyContent } : {}),
          ...(alignItems ? { alignItems } : {}),
        }
      : { layout: "none" }),
    ...(node.type === "frame" && node.clip ? { clip: true } : {}),
    ...(node.type === "frame" && node.cornerRadius != null ? { cornerRadius: node.cornerRadius } : {}),
  };
}

function exportRefNode(
  node: Extract<SceneNode, { type: "ref" }>,
  context: ExportContext,
  parentUsesLayout: boolean,
): PenRefNode {
  const descendants = flattenDescendantOverrides(node.descendants, context);

  return {
    ...exportNodeBase(node, context, parentUsesLayout),
    type: "ref",
    ref: node.componentId,
    ...(descendants ? { descendants } : {}),
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
    case "ref":
      return exportRefNode(node, context, parentUsesLayout);
    case "embed":
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
