/**
 * Pixso/Figma clipboard parsing and conversion utilities
 * Uses fig-kiwi to decode Kiwi binary format from clipboard
 */

import { readHTMLMessage } from "fig-kiwi";
import type {
  SceneNode,
  FrameNode,
  GroupNode,
  RectNode,
  EllipseNode,
  TextNode,
  LineNode,
  PolygonNode,
  GradientFill,
  GradientColorStop,
  ShadowEffect,
  LayoutProperties,
} from "@/types/scene";
import { generateId } from "@/types/scene";

// Type definitions based on fig-kiwi
type NodeType =
  | "FRAME"
  | "GROUP"
  | "RECTANGLE"
  | "ELLIPSE"
  | "TEXT"
  | "VECTOR"
  | "LINE"
  | "REGULAR_POLYGON"
  | "STAR"
  | "ROUNDED_RECTANGLE"
  | "BOOLEAN_OPERATION"
  | "INSTANCE"
  | "SYMBOL"
  | "CANVAS"
  | "DOCUMENT"
  | "SLICE"
  | "CONNECTOR"
  | "SECTION"
  | "STICKY"
  | "SHAPE_WITH_TEXT";

type PaintType =
  | "SOLID"
  | "GRADIENT_LINEAR"
  | "GRADIENT_RADIAL"
  | "GRADIENT_ANGULAR"
  | "GRADIENT_DIAMOND"
  | "IMAGE";

type EffectType = "DROP_SHADOW" | "INNER_SHADOW" | "FOREGROUND_BLUR" | "BACKGROUND_BLUR";

type StackMode = "NONE" | "HORIZONTAL" | "VERTICAL";

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Vector {
  x: number;
  y: number;
}

interface Matrix {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

interface ColorStop {
  color: Color;
  position: number;
}

interface Paint {
  type?: PaintType;
  color?: Color;
  opacity?: number;
  visible?: boolean;
  stops?: ColorStop[];
  transform?: Matrix;
}

interface Effect {
  type?: EffectType;
  color?: Color;
  offset?: Vector;
  radius?: number;
  spread?: number;
  visible?: boolean;
}

interface FontName {
  family: string;
  style: string;
}

interface TextData {
  characters?: string;
}

interface GUID {
  sessionID: number;
  localID: number;
}

interface ParentIndex {
  guid: GUID;
  position: string;
}

interface NodeChange {
  guid?: GUID;
  parentIndex?: ParentIndex;
  type?: NodeType;
  name?: string;
  visible?: boolean;
  opacity?: number;
  size?: Vector;
  transform?: Matrix;
  cornerRadius?: number;
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;
  fillPaints?: Paint[];
  strokePaints?: Paint[];
  strokeWeight?: number;
  effects?: Effect[];
  fontName?: FontName;
  fontSize?: number;
  textData?: TextData;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  stackMode?: StackMode;
  stackSpacing?: number;
  stackPadding?: number;
  stackHorizontalPadding?: number;
  stackVerticalPadding?: number;
  stackPaddingRight?: number;
  stackPaddingBottom?: number;
  frameMaskDisabled?: boolean;
}

interface Message {
  type?: string;
  nodeChanges?: NodeChange[];
}

interface ParseResult {
  message: Message;
  meta: {
    fileKey?: string;
    pasteID?: number;
    dataType?: string;
  };
}

/**
 * Detect if HTML clipboard contains Pixso or Figma data
 */
export function detectPixsoClipboard(html: string): boolean {
  // Pixso v1 format
  if (html.includes("pixsometa") || html.includes("pixso)")) {
    return true;
  }
  // Figma format
  if (html.includes("figmeta") || html.includes("figma)")) {
    return true;
  }
  return false;
}

/**
 * Convert RGBA color (0-1 range) to hex string
 */
function rgbaToHex(color: Color, includeAlpha = false): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;

  if (includeAlpha && color.a < 1) {
    const a = Math.round(color.a * 255);
    return hex + a.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Extract rotation angle from transform matrix
 */
function extractRotation(transform?: Matrix): number | undefined {
  if (!transform) return undefined;
  const radians = Math.atan2(transform.m10, transform.m00);
  const degrees = (radians * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

/**
 * Extract X position from transform matrix
 */
function extractX(transform?: Matrix): number {
  return transform?.m02 ?? 0;
}

/**
 * Extract Y position from transform matrix
 */
function extractY(transform?: Matrix): number {
  return transform?.m12 ?? 0;
}

/**
 * Convert fig-kiwi gradient to pen-editor GradientFill
 */
function convertGradient(paint: Paint): GradientFill | undefined {
  if (!paint.stops || paint.stops.length < 2) return undefined;

  const stops: GradientColorStop[] = paint.stops.map((stop) => ({
    color: rgbaToHex(stop.color),
    position: stop.position,
    opacity: stop.color.a,
  }));

  const isRadial = paint.type === "GRADIENT_RADIAL";

  return {
    type: isRadial ? "radial" : "linear",
    stops,
    startX: 0,
    startY: 0.5,
    endX: 1,
    endY: 0.5,
    ...(isRadial && { startRadius: 0, endRadius: 0.5 }),
  };
}

/**
 * Convert fig-kiwi effect to pen-editor ShadowEffect
 */
function convertShadow(effect: Effect): ShadowEffect | undefined {
  if (effect.type !== "DROP_SHADOW" && effect.type !== "INNER_SHADOW") {
    return undefined;
  }

  return {
    type: "shadow",
    shadowType: effect.type === "DROP_SHADOW" ? "outer" : "inner",
    color: effect.color ? rgbaToHex(effect.color, true) : "#00000040",
    offset: {
      x: effect.offset?.x ?? 0,
      y: effect.offset?.y ?? 0,
    },
    blur: effect.radius ?? 0,
    spread: effect.spread ?? 0,
  };
}

/**
 * Convert fig-kiwi NodeChange to pen-editor SceneNode
 */
function convertNodeChange(
  nc: NodeChange,
  guidToId: Map<string, string>,
  nodeChanges: NodeChange[]
): SceneNode | null {
  const type = nc.type;
  if (!type) return null;

  // Generate deterministic ID from GUID
  const guidKey = nc.guid ? `${nc.guid.sessionID}-${nc.guid.localID}` : generateId();
  const id = generateId();
  guidToId.set(guidKey, id);

  // Base properties
  const base = {
    id,
    name: nc.name,
    x: extractX(nc.transform),
    y: extractY(nc.transform),
    width: nc.size?.x ?? 100,
    height: nc.size?.y ?? 100,
    rotation: extractRotation(nc.transform),
    opacity: nc.opacity,
    visible: nc.visible ?? true,
  };

  // Apply fill
  const fill = nc.fillPaints?.find((p) => p.visible !== false);
  if (fill?.type === "SOLID" && fill.color) {
    Object.assign(base, {
      fill: rgbaToHex(fill.color),
      fillOpacity: fill.opacity ?? fill.color.a,
    });
  } else if (fill?.type?.startsWith("GRADIENT")) {
    const gradientFill = convertGradient(fill);
    if (gradientFill) {
      Object.assign(base, { gradientFill });
    }
  }

  // Apply stroke
  const stroke = nc.strokePaints?.find((p) => p.visible !== false);
  if (stroke?.color) {
    Object.assign(base, {
      stroke: rgbaToHex(stroke.color),
      strokeWidth: nc.strokeWeight ?? 1,
      strokeOpacity: stroke.opacity ?? stroke.color.a,
    });
  }

  // Apply shadow effect
  const shadowEffect = nc.effects?.find(
    (e) => e.visible !== false && (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW")
  );
  if (shadowEffect) {
    const effect = convertShadow(shadowEffect);
    if (effect) {
      Object.assign(base, { effect });
    }
  }

  // Corner radius (use individual or single value)
  const cornerRadius =
    nc.cornerRadius ??
    nc.rectangleTopLeftCornerRadius ??
    nc.rectangleTopRightCornerRadius ??
    nc.rectangleBottomLeftCornerRadius ??
    nc.rectangleBottomRightCornerRadius;

  // Find children by matching parentIndex
  const children: SceneNode[] = [];
  if (nc.guid) {
    const childChanges = nodeChanges.filter(
      (child) =>
        child.parentIndex?.guid?.sessionID === nc.guid?.sessionID &&
        child.parentIndex?.guid?.localID === nc.guid?.localID
    );

    // Sort by position string if available
    childChanges.sort((a, b) => {
      const posA = a.parentIndex?.position ?? "";
      const posB = b.parentIndex?.position ?? "";
      return posA.localeCompare(posB);
    });

    for (const child of childChanges) {
      const converted = convertNodeChange(child, guidToId, nodeChanges);
      if (converted) {
        // Adjust child position relative to parent
        converted.x -= base.x;
        converted.y -= base.y;
        children.push(converted);
      }
    }
  }

  // Convert based on type
  switch (type) {
    case "FRAME":
    case "SYMBOL": {
      const layout = convertLayout(nc);
      const frameNode: FrameNode = {
        ...base,
        type: "frame",
        children,
        cornerRadius,
        clip: !nc.frameMaskDisabled,
        ...(layout && { layout }),
      };
      return frameNode;
    }

    case "GROUP":
    case "BOOLEAN_OPERATION": {
      const groupNode: GroupNode = {
        ...base,
        type: "group",
        children,
      };
      return groupNode;
    }

    case "RECTANGLE":
    case "ROUNDED_RECTANGLE": {
      const rectNode: RectNode = {
        ...base,
        type: "rect",
        cornerRadius,
      };
      return rectNode;
    }

    case "ELLIPSE": {
      const ellipseNode: EllipseNode = {
        ...base,
        type: "ellipse",
      };
      return ellipseNode;
    }

    case "TEXT": {
      const textNode: TextNode = {
        ...base,
        type: "text",
        text: nc.textData?.characters ?? "",
        fontSize: nc.fontSize ?? 14,
        fontFamily: nc.fontName?.family ?? "Arial",
        fontWeight: nc.fontName?.style?.includes("Bold") ? "bold" : "normal",
        fontStyle: nc.fontName?.style?.includes("Italic") ? "italic" : "normal",
        textAlign:
          nc.textAlignHorizontal === "CENTER"
            ? "center"
            : nc.textAlignHorizontal === "RIGHT"
              ? "right"
              : "left",
        textAlignVertical:
          nc.textAlignVertical === "CENTER"
            ? "middle"
            : nc.textAlignVertical === "BOTTOM"
              ? "bottom"
              : "top",
      };
      return textNode;
    }

    case "VECTOR": {
      const pathNode: RectNode = {
        ...base,
        type: "rect",
        name: nc.name ?? "Vector",
      };
      return pathNode;
    }

    case "LINE": {
      const lineNode: LineNode = {
        ...base,
        type: "line",
        points: [0, 0, base.width, base.height],
      };
      return lineNode;
    }

    case "REGULAR_POLYGON":
    case "STAR": {
      const sides = type === "STAR" ? 10 : 6;
      const points = generatePolygonPoints(base.width, base.height, sides);
      const polygonNode: PolygonNode = {
        ...base,
        type: "polygon",
        points,
        sides,
      };
      return polygonNode;
    }

    case "INSTANCE": {
      const instanceNode: FrameNode = {
        ...base,
        type: "frame",
        children,
        cornerRadius,
      };
      return instanceNode;
    }

    default:
      console.warn(`Unknown Pixso node type: ${type}`);
      const fallbackNode: RectNode = {
        ...base,
        type: "rect",
      };
      return fallbackNode;
  }
}

/**
 * Convert auto-layout properties
 */
function convertLayout(nc: NodeChange): LayoutProperties | undefined {
  if (!nc.stackMode || nc.stackMode === "NONE") {
    return undefined;
  }

  return {
    autoLayout: true,
    flexDirection: nc.stackMode === "HORIZONTAL" ? "row" : "column",
    gap: nc.stackSpacing ?? 0,
    paddingTop: nc.stackVerticalPadding ?? nc.stackPadding ?? 0,
    paddingRight: nc.stackPaddingRight ?? nc.stackHorizontalPadding ?? nc.stackPadding ?? 0,
    paddingBottom: nc.stackPaddingBottom ?? nc.stackVerticalPadding ?? nc.stackPadding ?? 0,
    paddingLeft: nc.stackHorizontalPadding ?? nc.stackPadding ?? 0,
  };
}

/**
 * Generate regular polygon points inscribed in bounding box
 */
function generatePolygonPoints(width: number, height: number, sides: number): number[] {
  const points: number[] = [];
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;

  for (let i = 0; i < sides; i++) {
    const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    points.push(x, y);
  }

  return points;
}

/**
 * Unescape HTML entities that browsers may add when sanitizing clipboard HTML.
 * Needed because browsers may escape < > in attribute values when storing text/html.
 */
function unescapeClipboardHtml(html: string): string {
  return html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * Rewrite Pixso v1 clipboard markers to Figma markers
 * so fig-kiwi's parseHTMLString() can parse them
 */
function rewritePixsoMarkers(html: string): string {
  if (html.includes("pixsometa") || html.includes("(/pixso)")) {
    return html
      .replace("<!--(pixsometa)", "<!--(figmeta)")
      .replace("(/pixsometa)-->", "(/figmeta)-->")
      .replace("<!--(pixso)", "<!--(figma)")
      .replace("(/pixso)-->", "(/figma)-->");
  }
  return html;
}

/**
 * Parse Pixso/Figma clipboard HTML and convert to SceneNodes
 */
export function parsePixsoClipboard(html: string): SceneNode[] | null {
  // Unescape HTML entities that browsers add when sanitizing clipboard content
  html = unescapeClipboardHtml(html);
  // Rewrite Pixso v1 markers to Figma markers for fig-kiwi compatibility
  html = rewritePixsoMarkers(html);

  try {
    const result = readHTMLMessage(html) as ParseResult;
    if (result?.message?.nodeChanges && result.message.nodeChanges.length > 0) {
      return convertNodeChangesToSceneNodes(result.message.nodeChanges);
    }
  } catch {
    // fig-kiwi could not parse the clipboard data
  }

  return null;
}

/**
 * Convert array of NodeChanges to SceneNodes
 * Builds the tree structure from flat list using parentIndex references
 */
function convertNodeChangesToSceneNodes(nodeChanges: NodeChange[]): SceneNode[] {
  if (!nodeChanges || nodeChanges.length === 0) return [];

  const guidToId = new Map<string, string>();
  const result: SceneNode[] = [];

  // Find root nodes (nodes without parent or with CANVAS/DOCUMENT parent)
  const rootChanges = nodeChanges.filter((nc) => {
    if (!nc.parentIndex) return true;

    // Check if parent is a CANVAS or DOCUMENT (not a real parent)
    const parentGuid = nc.parentIndex.guid;
    const parent = nodeChanges.find(
      (p) =>
        p.guid?.sessionID === parentGuid.sessionID &&
        p.guid?.localID === parentGuid.localID
    );

    return !parent || parent.type === "CANVAS" || parent.type === "DOCUMENT";
  });

  // Convert each root node (which recursively converts children)
  for (const rootChange of rootChanges) {
    // Skip CANVAS and DOCUMENT nodes themselves
    if (rootChange.type === "CANVAS" || rootChange.type === "DOCUMENT") {
      continue;
    }

    const converted = convertNodeChange(rootChange, guidToId, nodeChanges);
    if (converted) {
      result.push(converted);
    }
  }

  return result;
}

/**
 * Main entry point for parsing and converting Pixso clipboard
 */
export function parseAndConvertPixso(html: string): SceneNode[] {
  const nodes = parsePixsoClipboard(html);
  return nodes ?? [];
}
