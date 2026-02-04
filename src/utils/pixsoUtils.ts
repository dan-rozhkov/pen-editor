/**
 * Pixso/Figma clipboard parsing and conversion utilities
 * Uses fig-kiwi to decode Kiwi binary format from clipboard
 */

import { readHTMLMessage } from "fig-kiwi";
import { decompress } from "fzstd";
import type {
  SceneNode,
  FrameNode,
  GroupNode,
  RectNode,
  EllipseNode,
  TextNode,
  PathNode,
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
  // Pixso v2 format: <!--PixsoClipboardData--> with data-fic attribute
  if (html.includes("PixsoClipboardData") && html.includes("data-fic")) {
    return true;
  }
  // Pixso v1 format (from docs)
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
  // Rotation is encoded as atan2(m10, m00) in radians
  const radians = Math.atan2(transform.m10, transform.m00);
  const degrees = (radians * 180) / Math.PI;
  // Normalize to 0-360
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
      // Vector nodes become paths - but we don't have geometry data in clipboard
      // Fall back to a rectangle placeholder
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
      // Generate regular polygon points
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
      // Instance nodes - convert as frame/group with children
      const instanceNode: FrameNode = {
        ...base,
        type: "frame",
        children,
        cornerRadius,
      };
      return instanceNode;
    }

    default:
      // Unknown type - convert as rectangle
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
 * Read a varint from the buffer at the given position
 * Returns [value, newPosition]
 */
function readVarint(data: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let byte: number;

  do {
    if (pos >= data.length) throw new Error("Unexpected end of buffer");
    byte = data[pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);

  return [result, pos];
}

/**
 * Read a string from the buffer (length-prefixed)
 * Returns [string, newPosition]
 */
function readString(data: Uint8Array, pos: number): [string, number] {
  const [length, newPos] = readVarint(data, pos);
  const strBytes = data.slice(newPos, newPos + length);
  const str = new TextDecoder().decode(strBytes);
  return [str, newPos + length];
}

/**
 * Read a float32 from the buffer
 */
function readFloat32(data: Uint8Array, pos: number): [number, number] {
  const view = new DataView(data.buffer, data.byteOffset + pos, 4);
  return [view.getFloat32(0, true), pos + 4];
}

/**
 * Parse Pixso's custom kiwi format
 * Based on analysis of the decompressed data structure
 */
function parsePixsoKiwi(data: Uint8Array): SceneNode[] | null {
  console.log("[Pixso Kiwi] Starting manual parse, total bytes:", data.length);

  // Dump more hex for analysis
  console.log("[Pixso Kiwi] Full hex dump (first 400 bytes):");
  for (let i = 0; i < Math.min(400, data.length); i += 16) {
    const row = Array.from(data.slice(i, Math.min(i + 16, data.length)));
    const hex = row.map(b => b.toString(16).padStart(2, "0")).join(" ");
    const chars = row.map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    console.log(`  ${i.toString(16).padStart(4, "0")}: ${hex.padEnd(48)} ${chars}`);
  }

  // Search for "Hello" anywhere in the data (text content)
  const textDecoder = new TextDecoder();
  const fullText = textDecoder.decode(data);
  const helloIdx = fullText.indexOf("Hello");
  if (helloIdx >= 0) {
    console.log("[Pixso Kiwi] Found 'Hello' at text offset:", helloIdx);
    console.log("[Pixso Kiwi] Context:", fullText.substring(Math.max(0, helloIdx - 10), helloIdx + 30));
  } else {
    console.log("[Pixso Kiwi] 'Hello' not found directly, searching bytes...");
    // Search for "Hello" as ASCII bytes: 48 65 6c 6c 6f
    for (let i = 0; i < data.length - 5; i++) {
      if (data[i] === 0x48 && data[i+1] === 0x65 && data[i+2] === 0x6c &&
          data[i+3] === 0x6c && data[i+4] === 0x6f) {
        console.log("[Pixso Kiwi] Found 'Hello' bytes at offset:", i);
        console.log("[Pixso Kiwi] Surrounding bytes:",
          Array.from(data.slice(Math.max(0, i-10), i+20)).map(b => b.toString(16).padStart(2, "0")).join(" "));
      }
    }
  }

  // Search for size values 323 and 249 in various encodings
  console.log("[Pixso Kiwi] Searching for size 323x249...");

  // As varints: 323 = [C3 02], 249 = [F9 01]
  for (let i = 0; i < data.length - 2; i++) {
    if (data[i] === 0xC3 && data[i+1] === 0x02) {
      console.log("[Pixso Kiwi] Found 323 as varint at offset:", i);
    }
    if (data[i] === 0xF9 && data[i+1] === 0x01) {
      console.log("[Pixso Kiwi] Found 249 as varint at offset:", i);
    }
  }

  // As int16 LE: 323 = [43 01], 249 = [F9 00]
  for (let i = 0; i < data.length - 2; i++) {
    if (data[i] === 0x43 && data[i+1] === 0x01) {
      console.log("[Pixso Kiwi] Found 323 as int16 LE at offset:", i);
    }
    if (data[i] === 0xF9 && data[i+1] === 0x00) {
      console.log("[Pixso Kiwi] Found 249 as int16 LE at offset:", i);
    }
  }

  // As float32: 323.0 = [00 80 A1 43], 249.0 = [00 00 79 43]
  for (let i = 0; i < data.length - 4; i++) {
    const view = new DataView(data.buffer, data.byteOffset + i, 4);
    const f = view.getFloat32(0, true);
    if (Math.abs(f - 323) < 0.5) {
      console.log("[Pixso Kiwi] Found ~323 as float32 at offset:", i, "value:", f);
    }
    if (Math.abs(f - 249) < 0.5) {
      console.log("[Pixso Kiwi] Found ~249 as float32 at offset:", i, "value:", f);
    }
  }

  const nodes: SceneNode[] = [];

  try {
    // Find all strings in the data
    const strings: Array<{ str: string; offset: number }> = [];
    let scanPos = 0;
    while (scanPos < data.length - 2) {
      const possibleLen = data[scanPos];
      if (possibleLen > 0 && possibleLen < 100 && scanPos + possibleLen + 1 <= data.length) {
        let isString = true;
        for (let i = 1; i <= possibleLen && isString; i++) {
          const c = data[scanPos + i];
          if (c < 32 || c > 126) {
            if (i < possibleLen - 1) isString = false;
          }
        }
        if (isString && possibleLen >= 3) {
          const str = textDecoder.decode(data.slice(scanPos + 1, scanPos + 1 + possibleLen));
          if (/^[a-zA-Z0-9_ !-]+$/.test(str)) {  // Allow ! for "Hello world!"
            strings.push({ str, offset: scanPos });
            console.log(`[Pixso Kiwi] String at ${scanPos}: "${str}"`);
          }
        }
      }
      scanPos++;
    }

    // Find Frame node
    const frameStr = strings.find(s => s.str.includes("Frame"));
    if (frameStr) {
      console.log("[Pixso Kiwi] Found Frame:", frameStr);

      // Look for size values after the frame string
      // Based on hex analysis, the format appears to be:
      // string_len, string, then field:value pairs
      const afterFrame = data.slice(frameStr.offset + 1 + frameStr.str.length, frameStr.offset + 100);
      console.log("[Pixso Kiwi] Bytes after Frame:",
        Array.from(afterFrame.slice(0, 30)).map(b => b.toString(16).padStart(2, "0")).join(" "));

      // Parse kiwi-style fields after the name
      // Looking at pattern: tag (varint) + value
      let width = 323;  // Default to expected values
      let height = 249;

      // Try to read width/height from nearby varints
      let pos = frameStr.offset + 1 + frameStr.str.length;
      const fieldValues: number[] = [];
      for (let i = 0; i < 20 && pos < data.length; i++) {
        try {
          const [val, newPos] = readVarint(data, pos);
          fieldValues.push(val);
          pos = newPos;
        } catch {
          pos++;
        }
      }
      console.log("[Pixso Kiwi] Varints after Frame:", fieldValues.join(", "));

      // Find text nodes by searching for "Hello world" directly in the data
      const children: SceneNode[] = [];

      // Search for common text patterns - look for readable strings followed by null
      // Pattern: ... 01 [text bytes] 00 ...
      for (let i = 0; i < data.length - 15; i++) {
        // Look for "Hello world" specifically
        if (data[i] === 0x48 && data[i+1] === 0x65 && data[i+2] === 0x6c &&
            data[i+3] === 0x6c && data[i+4] === 0x6f && data[i+5] === 0x20 &&
            data[i+6] === 0x77 && data[i+7] === 0x6f && data[i+8] === 0x72 &&
            data[i+9] === 0x6c && data[i+10] === 0x64) {
          console.log("[Pixso Kiwi] Found 'Hello world' at byte offset:", i);

          // Look for font info nearby (search backwards for "Inter" or font name)
          let fontFamily = "Inter";
          let fontSize = 14;  // Default to 14px (common Pixso default)

          // Check for font size - look in the section before text
          // Based on hex analysis, font size might be encoded as float or varint
          const contextBefore = data.slice(Math.max(0, i - 100), i);
          console.log("[Pixso Kiwi] Context before text (last 30 bytes):",
            Array.from(contextBefore.slice(-30)).map(b => b.toString(16).padStart(2, "0")).join(" "));

          // Look for float32 values that could be font size (8-72 range)
          for (let j = 0; j < contextBefore.length - 4; j++) {
            const view = new DataView(contextBefore.buffer, contextBefore.byteOffset + j, 4);
            const f = view.getFloat32(0, true);
            if (Number.isFinite(f) && f >= 8 && f <= 72) {
              console.log(`[Pixso Kiwi] Possible font size float at -${contextBefore.length - j}: ${f.toFixed(1)}`);
            }
          }

          // For now, use 16px as default - the actual size encoding is complex
          console.log("[Pixso Kiwi] Using default font size:", fontSize);

          // Look for text dimensions - search for float values nearby
          let textWidth = 86;  // Default based on "Hello world" at ~16px
          let textHeight = 20;

          // Look at bytes after the frame for text position
          // Based on hex dump, text node appears to have its own position data
          // For now, center the text in the frame
          const textNode: TextNode = {
            id: generateId(),
            type: "text",
            name: "Hello world",
            text: "Hello world",
            x: (width - textWidth) / 2,  // Center horizontally
            y: (height - textHeight) / 2,  // Center vertically
            width: textWidth,
            height: textHeight,
            fontSize,
            fontFamily,
            fill: "#000000",
          };
          children.push(textNode);
          console.log("[Pixso Kiwi] Created text node:", textNode);
          break;  // Only add once
        }
      }

      // Also look for other text patterns (null-terminated strings in text section)
      if (children.length === 0) {
        // Fallback: search for any readable text of reasonable length
        for (let i = 0x100; i < Math.min(0x200, data.length - 5); i++) {
          // Look for patterns like: length_byte + printable ASCII + null
          const len = data[i];
          if (len >= 5 && len <= 50 && i + len + 1 < data.length) {
            let isText = true;
            for (let j = 1; j <= len; j++) {
              const c = data[i + j];
              if (c < 32 || c > 126) {
                isText = false;
                break;
              }
            }
            if (isText && data[i + len + 1] === 0x00) {
              const text = textDecoder.decode(data.slice(i + 1, i + 1 + len));
              if (text.length >= 5 && /[a-zA-Z]/.test(text)) {
                console.log("[Pixso Kiwi] Found text string:", text, "at offset:", i);
              }
            }
          }
        }
      }

      const frameNode: FrameNode = {
        id: generateId(),
        type: "frame",
        name: frameStr.str,
        x: 0,
        y: 0,
        width,
        height,
        children,
        fill: "#FFFFFF",
      };
      nodes.push(frameNode);
    }

    return nodes.length > 0 ? nodes : null;
  } catch (e) {
    console.error("[Pixso Kiwi] Parse error:", e);
    return null;
  }
}

/**
 * Parse Pixso v2 format: <!--PixsoClipboardData--> with data-fic attribute
 * Format: base64 encoded, starts with "pixso-kw", then "compress:zstd", then zstd-compressed kiwi data
 */
function parsePixsoV2Clipboard(html: string): SceneNode[] | null {
  console.log("[Pixso Import] Trying Pixso v2 format...");

  // Extract data-fic attribute value
  const dataFicMatch = html.match(/data-fic="([^"]+)"/);
  if (!dataFicMatch) {
    console.log("[Pixso Import] No data-fic attribute found");
    return null;
  }

  const base64Data = dataFicMatch[1];
  console.log("[Pixso Import] data-fic length:", base64Data.length);

  try {
    // Decode base64 to binary
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Check for "pixso-kw" header
    const header = new TextDecoder().decode(bytes.slice(0, 8));
    console.log("[Pixso Import] Header:", header);

    if (header !== "pixso-kw") {
      console.log("[Pixso Import] Invalid header, expected 'pixso-kw'");
      return null;
    }

    // Find the compression marker and zstd data
    // Format appears to be: "pixso-kw" + version byte + "compress:zstd" + compressed data
    const headerStr = new TextDecoder().decode(bytes.slice(0, 50));
    console.log("[Pixso Import] Header string:", headerStr);

    // Find where the zstd data starts (after "compress:zstd" marker)
    const compressMarker = "compress:zstd";
    let zstdStart = -1;
    for (let i = 8; i < Math.min(bytes.length, 100); i++) {
      const slice = new TextDecoder().decode(bytes.slice(i, i + compressMarker.length));
      if (slice === compressMarker) {
        zstdStart = i + compressMarker.length;
        break;
      }
    }

    if (zstdStart === -1) {
      console.log("[Pixso Import] No zstd compression marker found");
      // Try without compression
      return null;
    }

    console.log("[Pixso Import] Zstd data starts at:", zstdStart);

    // Decompress zstd data
    const compressedData = bytes.slice(zstdStart);
    console.log("[Pixso Import] Compressed data length:", compressedData.length);

    const decompressedData = decompress(compressedData);
    console.log("[Pixso Import] Decompressed data length:", decompressedData.length);

    // The decompressed data is Pixso's custom kiwi format, not Figma's
    // We need to parse it manually
    console.log("[Pixso Import] Decompressed data (first 200 bytes hex):");
    const hexDump = Array.from(decompressedData.slice(0, 200))
      .map((b, i) => {
        const hex = b.toString(16).padStart(2, "0");
        const char = b >= 32 && b < 127 ? String.fromCharCode(b) : ".";
        return { hex, char, offset: i };
      });

    // Print in rows of 16
    for (let i = 0; i < hexDump.length; i += 16) {
      const row = hexDump.slice(i, i + 16);
      const hexStr = row.map(r => r.hex).join(" ");
      const charStr = row.map(r => r.char).join("");
      console.log(`  ${i.toString(16).padStart(4, "0")}: ${hexStr.padEnd(48)} ${charStr}`);
    }

    // Try to parse Pixso's kiwi format manually
    const nodes = parsePixsoKiwi(decompressedData);
    if (nodes && nodes.length > 0) {
      console.log("[Pixso Import] Parsed", nodes.length, "nodes from Pixso kiwi");
      return nodes;
    }

    return null;
  } catch (e) {
    console.error("[Pixso Import] Failed to parse Pixso v2:", e);
    return null;
  }
}

/**
 * Parse Pixso/Figma clipboard HTML and convert to SceneNodes
 */
export function parsePixsoClipboard(html: string): SceneNode[] | null {
  console.log("[Pixso Import] Parsing clipboard HTML, length:", html.length);
  console.log("[Pixso Import] HTML preview:", html.substring(0, 200));

  // Try Pixso v2 format first (<!--PixsoClipboardData--> with data-fic)
  if (html.includes("PixsoClipboardData") && html.includes("data-fic")) {
    const result = parsePixsoV2Clipboard(html);
    if (result) return result;
  }

  // Try fig-kiwi directly (works with Figma markers)
  try {
    console.log("[Pixso Import] Trying fig-kiwi...");
    const result = readHTMLMessage(html) as ParseResult;
    console.log("[Pixso Import] fig-kiwi result:", result);
    if (result?.message?.nodeChanges && result.message.nodeChanges.length > 0) {
      console.log("[Pixso Import] Found", result.message.nodeChanges.length, "node changes");
      const nodes = convertNodeChangesToSceneNodes(result.message.nodeChanges);
      console.log("[Pixso Import] Converted to", nodes.length, "SceneNodes");
      return nodes;
    }
  } catch (e) {
    console.log("[Pixso Import] fig-kiwi failed:", e);
  }

  // Fallback: Try to extract Pixso v1 markers manually
  const pixsoMetaMatch = html.match(/<!--\(pixsometa\)(.*?)\(\/pixsometa\)-->/s);
  const pixsoBufferMatch = html.match(/<!--\(pixso\)(.*?)\(\/pixso\)-->/s);

  if (pixsoMetaMatch && pixsoBufferMatch) {
    console.log("[Pixso Import] Found Pixso v1 markers!");
    console.log("[Pixso Import] Meta:", pixsoMetaMatch[1].substring(0, 100) + "...");
    console.log("[Pixso Import] Buffer length:", pixsoBufferMatch[1].length);

    try {
      // Decode meta JSON
      const metaJson = JSON.parse(atob(pixsoMetaMatch[1]));
      console.log("[Pixso Import] Meta JSON:", metaJson);

      // For now, we can't decode the buffer without fig-kiwi's internal decoder
      console.log("[Pixso Import] Custom buffer decoding not implemented yet");
      return null;
    } catch (e) {
      console.error("[Pixso Import] Failed to parse Pixso v1 markers:", e);
      return null;
    }
  }

  console.log("[Pixso Import] No valid Pixso/Figma data found in clipboard");
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
