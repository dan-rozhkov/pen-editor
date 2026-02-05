import {
  generateId,
  type SceneNode,
  type FrameNode,
  type GroupNode,
  type RectNode,
  type EllipseNode,
  type TextNode,
  type LineNode,
  type PolygonNode,
  type LayoutProperties,
  type SizingProperties,
} from "../types/scene";
import { generatePolygonPoints } from "./polygonUtils";

// --- Pixso JSON types (subset of exportTypes.ts) ---

interface PixsoColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface PixsoSolidPaint {
  type: "SOLID";
  color: PixsoColor;
  opacity?: number;
  visible?: boolean;
}

interface PixsoImagePaint {
  type: "IMAGE";
  imageHash: string;
  scaleMode: string;
  visible?: boolean;
}

type PixsoPaint = PixsoSolidPaint | PixsoImagePaint;

interface PixsoFontName {
  family: string;
  style: string;
}

interface PixsoLineHeight {
  value: number;
  unit: "PIXELS" | "PERCENT";
}

interface PixsoLetterSpacing {
  value: number;
  unit: "PIXELS" | "PERCENT";
}

interface PixsoNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;

  // Shape props
  fills?: PixsoPaint[];
  strokes?: PixsoPaint[];
  strokeWeight?: number;
  strokeAlign?: string;
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomLeftRadius?: number;
  bottomRightRadius?: number;

  // Container props
  children?: PixsoNode[];

  // Auto-layout props
  layoutMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  layoutWrap?: string;

  // Text props
  characters?: string;
  fontSize?: number;
  fontFamily?: string;
  fontName?: PixsoFontName | string;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  lineHeight?: PixsoLineHeight | number;
  letterSpacing?: PixsoLetterSpacing | number;
  textCase?: string;
  textDecoration?: string;

  // Component/instance props
  componentProperties?: Record<string, unknown>;
  componentId?: string;
  overrides?: unknown[];
  isMasterComponent?: boolean;
}

// --- Helpers ---

function pixsoColorToHex(color: PixsoColor): string {
  const r = Math.round(color.r * 255)
    .toString(16)
    .padStart(2, "0");
  const g = Math.round(color.g * 255)
    .toString(16)
    .padStart(2, "0");
  const b = Math.round(color.b * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${b}`;
}

function extractFill(fills?: PixsoPaint[]): {
  fill?: string;
  fillOpacity?: number;
} {
  if (!fills) return {};
  const solid = fills.find(
    (p) => p.type === "SOLID" && p.visible !== false
  ) as PixsoSolidPaint | undefined;
  if (!solid) return {};
  const result: { fill: string; fillOpacity?: number } = {
    fill: pixsoColorToHex(solid.color),
  };
  if (solid.opacity !== undefined && solid.opacity < 1) {
    result.fillOpacity = solid.opacity;
  }
  return result;
}

function extractStroke(
  strokes?: PixsoPaint[],
  strokeWeight?: number
): { stroke?: string; strokeWidth?: number } {
  if (!strokes || !strokeWeight) return {};
  const solid = strokes.find(
    (p) => p.type === "SOLID" && p.visible !== false
  ) as PixsoSolidPaint | undefined;
  if (!solid) return {};
  return {
    stroke: pixsoColorToHex(solid.color),
    strokeWidth: strokeWeight,
  };
}

function extractCornerRadius(node: PixsoNode): number | undefined {
  if (node.cornerRadius && node.cornerRadius > 0) return node.cornerRadius;
  const radii = [
    node.topLeftRadius,
    node.topRightRadius,
    node.bottomLeftRadius,
    node.bottomRightRadius,
  ].filter((r) => r !== undefined && r > 0);
  if (radii.length > 0) return Math.max(...radii);
  return undefined;
}

function mapJustifyContent(
  value?: string
): LayoutProperties["justifyContent"] {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "SPACE_BETWEEN":
      return "space-between";
    default:
      return undefined;
  }
}

function mapAlignItems(value?: string): LayoutProperties["alignItems"] {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    default:
      return undefined;
  }
}

function extractLayout(node: PixsoNode): {
  layout?: LayoutProperties;
  sizing?: SizingProperties;
} {
  if (!node.layoutMode || node.layoutMode === "NONE") return {};

  const isHorizontal = node.layoutMode === "HORIZONTAL";
  const layout: LayoutProperties = {
    autoLayout: true,
    flexDirection: isHorizontal ? "row" : "column",
    gap: node.itemSpacing ?? 0,
    paddingTop: node.paddingTop ?? 0,
    paddingRight: node.paddingRight ?? 0,
    paddingBottom: node.paddingBottom ?? 0,
    paddingLeft: node.paddingLeft ?? 0,
    justifyContent: mapJustifyContent(node.primaryAxisAlignItems),
    alignItems: mapAlignItems(node.counterAxisAlignItems),
  };

  const sizing: SizingProperties = {};
  if (node.primaryAxisSizingMode === "AUTO") {
    if (isHorizontal) {
      sizing.widthMode = "fit_content";
    } else {
      sizing.heightMode = "fit_content";
    }
  }
  if (node.counterAxisSizingMode === "AUTO") {
    if (isHorizontal) {
      sizing.heightMode = "fit_content";
    } else {
      sizing.widthMode = "fit_content";
    }
  }

  return {
    layout,
    sizing:
      sizing.widthMode || sizing.heightMode ? sizing : undefined,
  };
}

function extractTextProps(node: PixsoNode): Partial<TextNode> {
  const props: Partial<TextNode> = {};

  props.text = node.characters ?? "";
  if (node.fontSize) props.fontSize = node.fontSize;

  // Font family
  if (node.fontFamily) {
    props.fontFamily = node.fontFamily;
  } else if (node.fontName) {
    if (typeof node.fontName === "string") {
      props.fontFamily = node.fontName;
    } else {
      props.fontFamily = node.fontName.family;
      const style = node.fontName.style?.toLowerCase() ?? "";
      if (style.includes("bold")) props.fontWeight = "bold";
      if (style.includes("italic")) props.fontStyle = "italic";
    }
  }

  // Text alignment
  switch (node.textAlignHorizontal) {
    case "LEFT":
      props.textAlign = "left";
      break;
    case "CENTER":
      props.textAlign = "center";
      break;
    case "RIGHT":
      props.textAlign = "right";
      break;
  }

  switch (node.textAlignVertical) {
    case "TOP":
      props.textAlignVertical = "top";
      break;
    case "CENTER":
      props.textAlignVertical = "middle";
      break;
    case "BOTTOM":
      props.textAlignVertical = "bottom";
      break;
  }

  // Line height
  if (node.lineHeight !== undefined) {
    if (typeof node.lineHeight === "number") {
      props.lineHeight = node.lineHeight;
    } else if (node.lineHeight.unit === "PIXELS" && node.fontSize) {
      props.lineHeight = node.lineHeight.value / node.fontSize;
    } else if (node.lineHeight.unit === "PERCENT") {
      props.lineHeight = node.lineHeight.value / 100;
    }
  }

  // Letter spacing
  if (node.letterSpacing !== undefined) {
    if (typeof node.letterSpacing === "number") {
      props.letterSpacing = node.letterSpacing;
    } else if (node.letterSpacing.unit === "PIXELS") {
      props.letterSpacing = node.letterSpacing.value;
    } else if (
      node.letterSpacing.unit === "PERCENT" &&
      node.fontSize
    ) {
      props.letterSpacing = (node.letterSpacing.value / 100) * node.fontSize;
    }
  }

  // Text decoration
  if (node.textDecoration === "UNDERLINE") props.underline = true;
  if (node.textDecoration === "STRIKETHROUGH") props.strikethrough = true;

  // Use fill for text color
  const { fill, fillOpacity } = extractFill(node.fills);
  if (fill) props.fill = fill;
  if (fillOpacity !== undefined) props.fillOpacity = fillOpacity;

  return props;
}

// --- Main conversion ---

export function convertPixsoNode(node: PixsoNode): SceneNode | null {
  if (!node || !node.type) return null;

  const id = generateId();
  const base = {
    id,
    name: node.name || undefined,
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width ?? 100,
    height: node.height ?? 100,
    visible: node.visible !== false ? undefined : false,
    rotation: node.rotation && node.rotation !== 0 ? node.rotation : undefined,
  };

  const { fill, fillOpacity } = extractFill(node.fills);
  const { stroke, strokeWidth } = extractStroke(
    node.strokes,
    node.strokeWeight
  );

  const appearance = {
    fill,
    fillOpacity,
    stroke,
    strokeWidth,
  };

  switch (node.type) {
    case "FRAME":
    case "COMPONENT":
    case "INSTANCE":
    case "SECTION": {
      const children = (node.children ?? [])
        .map(convertPixsoNode)
        .filter((n): n is SceneNode => n !== null);
      const { layout, sizing } = extractLayout(node);
      const cornerRadius = extractCornerRadius(node);
      const frame: FrameNode = {
        ...base,
        ...appearance,
        type: "frame",
        children,
        cornerRadius,
        layout,
        sizing,
        reusable: node.type === "COMPONENT" ? true : undefined,
      };
      return frame;
    }

    case "GROUP": {
      const children = (node.children ?? [])
        .map(convertPixsoNode)
        .filter((n): n is SceneNode => n !== null);
      const group: GroupNode = {
        ...base,
        ...appearance,
        type: "group",
        children,
      };
      return group;
    }

    case "RECTANGLE": {
      const cornerRadius = extractCornerRadius(node);
      const rect: RectNode = {
        ...base,
        ...appearance,
        type: "rect",
        cornerRadius,
      };
      return rect;
    }

    case "ELLIPSE": {
      const ellipse: EllipseNode = {
        ...base,
        ...appearance,
        type: "ellipse",
      };
      return ellipse;
    }

    case "POLYGON":
    case "STAR": {
      const sides = node.type === "STAR" ? 10 : 6;
      const points = generatePolygonPoints(sides, base.width, base.height);
      const polygon: PolygonNode = {
        ...base,
        ...appearance,
        type: "polygon",
        points,
        sides,
      };
      return polygon;
    }

    case "VECTOR": {
      const rect: RectNode = {
        ...base,
        ...appearance,
        type: "rect",
      };
      return rect;
    }

    case "LINE": {
      const line: LineNode = {
        ...base,
        ...appearance,
        type: "line",
        points: [0, 0, base.width, 0],
      };
      return line;
    }

    case "TEXT": {
      const textProps = extractTextProps(node);
      const text: TextNode = {
        ...base,
        type: "text",
        text: textProps.text ?? "",
        fontSize: textProps.fontSize,
        fontFamily: textProps.fontFamily,
        fontWeight: textProps.fontWeight,
        fontStyle: textProps.fontStyle,
        textAlign: textProps.textAlign,
        textAlignVertical: textProps.textAlignVertical,
        lineHeight: textProps.lineHeight,
        letterSpacing: textProps.letterSpacing,
        underline: textProps.underline,
        strikethrough: textProps.strikethrough,
        fill: textProps.fill,
        fillOpacity: textProps.fillOpacity,
      };
      return text;
    }

    default:
      return null;
  }
}

/**
 * Parse a Pixso JSON string and convert to SceneNode.
 * Accepts either a raw ExportedNode or an ExportFrameJsonResult wrapper.
 */
export function parsePixsoJson(jsonString: string): SceneNode {
  const parsed = JSON.parse(jsonString);
  const nodeData = parsed.data ?? parsed;
  const result = convertPixsoNode(nodeData);
  if (!result) {
    throw new Error("Failed to convert: unsupported node type or empty data");
  }
  return result;
}
