// Test fixture builder: encodes a synthetic Figma clipboard payload using the
// same building blocks as the real one (kiwi binary schema + raw-deflate
// chunks inside a fig-kiwi archive, base64-wrapped in clipboard HTML).
// The schema below is a trimmed-down version of Figma's — it only declares the
// fields our parser reads, which is fine because the schema travels with the
// payload and field IDs are resolved from it.

import { compileSchema, encodeBinarySchema, parseSchema } from 'kiwi-schema'
import { deflateSync } from 'fflate'
import type { FigMessage } from '../figTypes'

const TEST_SCHEMA = `
enum MessageType {
  NODE_CHANGES = 1;
}

enum NodeType {
  DOCUMENT = 1;
  CANVAS = 2;
  FRAME = 3;
  RECTANGLE = 4;
  ELLIPSE = 5;
  TEXT = 6;
  VECTOR = 7;
  LINE = 8;
  GROUP = 9;
  SYMBOL = 10;
  INSTANCE = 11;
  ROUNDED_RECTANGLE = 12;
  BOOLEAN_OPERATION = 13;
  STAR = 14;
  REGULAR_POLYGON = 15;
  SECTION = 16;
}

enum PaintType {
  SOLID = 1;
  GRADIENT_LINEAR = 2;
  GRADIENT_RADIAL = 3;
  IMAGE = 4;
}

enum ImageScaleMode {
  STRETCH = 1;
  FIT = 2;
  FILL = 3;
  TILE = 4;
}

enum EffectType {
  INNER_SHADOW = 1;
  DROP_SHADOW = 2;
}

enum WindingRule {
  NONZERO = 1;
  ODD = 2;
}

enum NumberUnits {
  RAW = 1;
  PIXELS = 2;
  PERCENT = 3;
}

enum TextAlignHorizontal {
  LEFT = 1;
  CENTER = 2;
  RIGHT = 3;
  JUSTIFIED = 4;
}

enum TextAlignVertical {
  TOP = 1;
  CENTER = 2;
  BOTTOM = 3;
}

enum TextCase {
  ORIGINAL = 1;
  UPPER = 2;
  LOWER = 3;
  TITLE = 4;
}

enum TextDecoration {
  NONE = 1;
  UNDERLINE = 2;
  STRIKETHROUGH = 3;
}

enum TextAutoResize {
  NONE = 1;
  WIDTH_AND_HEIGHT = 2;
  HEIGHT = 3;
}

enum StrokeAlign {
  CENTER = 1;
  INSIDE = 2;
  OUTSIDE = 3;
}

enum StackMode {
  NONE = 1;
  HORIZONTAL = 2;
  VERTICAL = 3;
}

enum StackJustify {
  MIN = 1;
  CENTER = 2;
  MAX = 3;
  SPACE_EVENLY = 4;
  SPACE_BETWEEN = 5;
}

enum StackAlign {
  MIN = 1;
  CENTER = 2;
  MAX = 3;
  BASELINE = 4;
}

enum StackCounterAlign {
  MIN = 1;
  CENTER = 2;
  MAX = 3;
  STRETCH = 4;
  AUTO = 5;
  BASELINE = 6;
}

enum StackSize {
  FIXED = 1;
  RESIZE_TO_FIT = 2;
  RESIZE_TO_FIT_WITH_IMPLICIT_SIZE = 3;
}

enum StackPositioning {
  AUTO = 1;
  ABSOLUTE = 2;
}

struct GUID {
  uint sessionID;
  uint localID;
}

struct Color {
  float r;
  float g;
  float b;
  float a;
}

struct Vector {
  float x;
  float y;
}

struct Matrix {
  float m00;
  float m01;
  float m02;
  float m10;
  float m11;
  float m12;
}

struct ColorStop {
  Color color;
  float position;
}

struct ParentIndex {
  GUID guid;
  string position;
}

struct Number {
  float value;
  NumberUnits units;
}

struct FontName {
  string family;
  string style;
  string postscript;
}

message Image {
  byte[] hash = 1;
  string name = 2;
  uint dataBlob = 3;
}

message Paint {
  PaintType type = 1;
  Color color = 2;
  float opacity = 3;
  bool visible = 4;
  ColorStop[] stops = 5;
  Matrix transform = 6;
  Image image = 7;
  ImageScaleMode imageScaleMode = 8;
}

message Effect {
  EffectType type = 1;
  Color color = 2;
  Vector offset = 3;
  float radius = 4;
  bool visible = 5;
  float spread = 6;
}

message Path {
  WindingRule windingRule = 1;
  uint commandsBlob = 2;
  uint styleID = 3;
}

message TextData {
  string characters = 1;
  uint[] characterStyleIDs = 2;
  NodeChange[] styleOverrideTable = 3;
}

message GUIDPath {
  GUID[] guids = 1;
}

message SymbolData {
  GUID symbolID = 1;
  NodeChange[] symbolOverrides = 2;
}

message ArcData {
  float startingAngle = 1;
  float endingAngle = 2;
  float innerRadius = 3;
}

message VectorData {
  uint vectorNetworkBlob = 1;
  Vector normalizedSize = 2;
}

message NodeChange {
  GUID guid = 1;
  ParentIndex parentIndex = 2;
  NodeType type = 3;
  string name = 4;
  bool visible = 5;
  float opacity = 6;
  Vector size = 7;
  Matrix transform = 8;
  bool mask = 9;
  float cornerRadius = 10;
  float strokeWeight = 11;
  StrokeAlign strokeAlign = 12;
  Paint[] fillPaints = 13;
  Paint[] strokePaints = 14;
  Effect[] effects = 15;
  Path[] fillGeometry = 16;
  Path[] strokeGeometry = 17;
  float fontSize = 18;
  FontName fontName = 19;
  TextData textData = 20;
  TextAlignHorizontal textAlignHorizontal = 21;
  TextAlignVertical textAlignVertical = 22;
  TextCase textCase = 23;
  TextDecoration textDecoration = 24;
  TextAutoResize textAutoResize = 25;
  Number lineHeight = 26;
  Number letterSpacing = 27;
  bool resizeToFit = 28;
  bool frameMaskDisabled = 29;
  SymbolData symbolData = 30;
  NodeChange[] derivedSymbolData = 31;
  GUIDPath guidPath = 32;
  bool internalOnly = 33;
  float rectangleTopLeftCornerRadius = 34;
  float rectangleTopRightCornerRadius = 35;
  float rectangleBottomLeftCornerRadius = 36;
  float rectangleBottomRightCornerRadius = 37;
  bool rectangleCornerRadiiIndependent = 38;
  ArcData arcData = 39;
  StackMode stackMode = 40;
  float stackSpacing = 41;
  float stackVerticalPadding = 42;
  float stackHorizontalPadding = 43;
  float stackPaddingRight = 44;
  float stackPaddingBottom = 45;
  StackJustify stackPrimaryAlignItems = 46;
  StackAlign stackCounterAlignItems = 47;
  StackSize stackPrimarySizing = 48;
  StackSize stackCounterSizing = 49;
  float stackChildPrimaryGrow = 50;
  StackCounterAlign stackChildAlignSelf = 51;
  StackPositioning stackPositioning = 52;
  VectorData vectorData = 53;
  uint styleID = 54;
  float borderTopWeight = 55;
  float borderRightWeight = 56;
  float borderBottomWeight = 57;
  float borderLeftWeight = 58;
  bool borderStrokeWeightsIndependent = 59;
}

message Blob {
  byte[] bytes = 1;
}

message Message {
  MessageType type = 1;
  NodeChange[] nodeChanges = 2;
  Blob[] blobs = 3;
  uint blobBaseIndex = 4;
}
`

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Encode a FigMessage into a fig-kiwi archive (schema chunk + data chunk). */
export function encodeFigArchive(message: FigMessage): Uint8Array {
  const schema = parseSchema(TEST_SCHEMA)
  const compiled = compileSchema(schema)
  const schemaChunk = deflateSync(encodeBinarySchema(schema))
  const dataChunk = deflateSync(compiled.encodeMessage(message))

  const prelude = 'fig-kiwi'
  const total = prelude.length + 4 + 4 + schemaChunk.length + 4 + dataChunk.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let offset = 0
  for (let i = 0; i < prelude.length; i++) out[offset++] = prelude.charCodeAt(i)
  view.setUint32(offset, 15, true)
  offset += 4
  view.setUint32(offset, schemaChunk.length, true)
  offset += 4
  out.set(schemaChunk, offset)
  offset += schemaChunk.length
  view.setUint32(offset, dataChunk.length, true)
  offset += 4
  out.set(dataChunk, offset)
  return out
}

/** Wrap a FigMessage in clipboard HTML exactly like Figma does. */
export function buildFigmaClipboardHtml(message: FigMessage, meta: object = { dataType: 'scene' }): string {
  const metaB64 = btoa(JSON.stringify(meta))
  const dataB64 = bytesToBase64(encodeFigArchive(message))
  return (
    '<meta charset="utf-8" />' +
    `<span data-metadata="<!--(figmeta)${metaB64}(/figmeta)-->"></span>` +
    `<span data-buffer="<!--(figma)${dataB64}(/figma)-->"></span>` +
    '<span style="white-space: pre-wrap"></span>'
  )
}

/** Little-endian byte writer shared by the binary blob encoders below. */
function createByteWriter() {
  const bytes: number[] = []
  const buf = new DataView(new ArrayBuffer(4))
  const push4 = () => bytes.push(buf.getUint8(0), buf.getUint8(1), buf.getUint8(2), buf.getUint8(3))
  return {
    u8: (value: number) => bytes.push(value & 0xff),
    u32: (value: number) => {
      buf.setUint32(0, value, true)
      push4()
    },
    f32: (value: number) => {
      buf.setFloat32(0, value, true)
      push4()
    },
    toBytes: () => new Uint8Array(bytes),
  }
}

/** Encode an SVG-like command list into a Figma path-commands blob. */
export function encodePathCommandsBlob(commands: (string | number)[]): Uint8Array {
  const writer = createByteWriter()
  let i = 0
  while (i < commands.length) {
    const op = commands[i++] as string
    const argCount = op === 'Z' ? 0 : op === 'M' || op === 'L' ? 2 : op === 'Q' ? 4 : 6
    const verb = op === 'Z' ? 0 : op === 'M' ? 1 : op === 'L' ? 2 : op === 'Q' ? 3 : 4
    writer.u8(verb)
    for (const value of commands.slice(i, i + argCount) as number[]) {
      writer.f32(value)
    }
    i += argCount
  }
  return writer.toBytes()
}

export interface FixtureNetworkSegment {
  start: number
  end: number
  t1?: [number, number]
  t2?: [number, number]
}

export interface FixtureNetwork {
  vertices: [number, number][]
  segments: FixtureNetworkSegment[]
  regions?: { windingRule?: 'NONZERO' | 'ODD'; loops: number[][] }[]
}

/** Encode a vector network into Figma's vectorNetworkBlob binary format. */
export function encodeVectorNetworkBlob(network: FixtureNetwork): Uint8Array {
  const regions = network.regions ?? []
  const writer = createByteWriter()

  writer.u32(network.vertices.length)
  writer.u32(network.segments.length)
  writer.u32(regions.length)
  for (const [x, y] of network.vertices) {
    writer.u32(0) // styleID
    writer.f32(x)
    writer.f32(y)
  }
  for (const segment of network.segments) {
    writer.u32(0) // styleID
    writer.u32(segment.start)
    writer.f32(segment.t1?.[0] ?? 0)
    writer.f32(segment.t1?.[1] ?? 0)
    writer.u32(segment.end)
    writer.f32(segment.t2?.[0] ?? 0)
    writer.f32(segment.t2?.[1] ?? 0)
  }
  for (const region of regions) {
    // bit0 = NONZERO winding; the remaining styleID bits stay 0
    writer.u32((region.windingRule ?? 'NONZERO') === 'NONZERO' ? 1 : 0)
    writer.u32(region.loops.length)
    for (const loop of region.loops) {
      writer.u32(loop.length)
      for (const index of loop) writer.u32(index)
    }
  }
  return writer.toBytes()
}

// Convenience builders ------------------------------------------------------

export function guid(localID: number, sessionID = 1): { sessionID: number; localID: number } {
  return { sessionID, localID }
}

export function identityTransform(x = 0, y = 0) {
  return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y }
}

export function solidPaint(r: number, g: number, b: number, a = 1, opacity = 1) {
  return {
    type: 'SOLID' as const,
    color: { r, g, b, a },
    opacity,
    visible: true,
  }
}
