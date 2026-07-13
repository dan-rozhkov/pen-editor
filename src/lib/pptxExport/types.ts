/**
 * Intermediate representation consumed by `assemblePptx`. Fully resolved and
 * pure data: slide-relative px coordinates, hex colors already flattened from
 * variables/styles, media as raw bytes. All Pixi/store logic stays in the
 * builder (`buildSlidesInput.ts`) and the Pixi layer (`exportPptxUtils.ts`).
 */

export interface PptxRect {
  x: number; // px, slide-relative (already scaled/offset to deck size)
  y: number;
  width: number;
  height: number;
}

export interface SolidFillInput {
  kind: "solid";
  rgb: string; // uppercase 6-char hex, no '#'
  alpha: number; // 0-1, all opacity sources pre-multiplied
}

export interface GradientStopInput {
  rgb: string;
  alpha: number;
  position: number; // 0-1
}

export interface GradientFillInput {
  kind: "gradient";
  gradientType: "linear" | "radial";
  stops: GradientStopInput[]; // sorted by position ascending
  angleDeg: number; // linear only: direction of the start→end vector
}

export type FillInput = SolidFillInput | GradientFillInput;

export interface StrokeInput {
  rgb: string;
  alpha: number;
  widthPx: number;
}

export interface ShadowInput {
  variant: "outer" | "inner";
  rgb: string;
  alpha: number;
  offsetX: number; // px
  offsetY: number; // px
  blurPx: number;
}

interface BaseShapeInput {
  name?: string;
  rect: PptxRect;
  rotationDeg?: number; // clockwise; leaf nodes only
}

export interface RectShapeInput extends BaseShapeInput {
  kind: "rect";
  /** [topLeft, topRight, bottomRight, bottomLeft] px; omit for sharp corners. */
  cornerRadii?: [number, number, number, number];
  fill?: FillInput;
  stroke?: StrokeInput;
  shadows?: ShadowInput[];
}

export interface EllipseShapeInput extends BaseShapeInput {
  kind: "ellipse";
  fill?: FillInput;
  stroke?: StrokeInput;
  shadows?: ShadowInput[];
}

export type LineCap = "none" | "arrow" | "triangle" | "circle" | "bar";

export interface LineShapeInput {
  kind: "line";
  name?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number; // px, slide-relative
  stroke: StrokeInput;
  startCap?: LineCap;
  endCap?: LineCap;
}

export interface TextFontInput {
  family: string;
  sizePx: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  rgb: string;
  alpha: number;
  lineHeight?: number; // multiplier, e.g. 1.2
  letterSpacingPx?: number;
  paragraphSpacingPx?: number; // gap after each paragraph
}

export interface ParagraphInput {
  text: string; // one hard-break paragraph, transform already applied
  align: "l" | "ctr" | "r";
}

export interface TextShapeInput extends BaseShapeInput {
  kind: "text";
  paragraphs: ParagraphInput[];
  font: TextFontInput;
  anchor: "t" | "ctr" | "b"; // vertical alignment
}

export interface MediaInput {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
}

export interface PictureShapeInput extends BaseShapeInput {
  kind: "picture";
  media: MediaInput;
}

export type ShapeInput =
  | RectShapeInput
  | EllipseShapeInput
  | LineShapeInput
  | TextShapeInput
  | PictureShapeInput;

export interface SlideShapes {
  shapes: ShapeInput[]; // z-ordered bottom-to-top (spTree document order)
}

export interface PptxDocInput {
  widthPx: number; // deck slide size (from the first slide frame)
  heightPx: number;
  slides: SlideShapes[];
}
