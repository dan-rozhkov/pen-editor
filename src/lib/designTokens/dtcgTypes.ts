// src/lib/designTokens/dtcgTypes.ts

/** Which pen-editor store a token round-trips back into. */
export type PenTokenSource = "variable" | "fillStyle" | "effectStyle" | "textStyle";

/** Vendor extension we attach under $extensions["com.peneditor"]. */
export interface PenTokenExtension {
  /** Original store id — restores the exact entity on re-import. */
  id: string;
  source: PenTokenSource;
  /** Present only for a color variable that carries themeValues. Base $value is the light value. */
  themes?: { dark: string };
  /** Gradient geometry (DTCG `gradient` carries none). */
  gradient?: {
    type: "linear" | "radial";
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    startRadius?: number;
    endRadius?: number;
  };
  /** Typography extras with no DTCG home. */
  textTransform?: string;
  fontVariations?: Record<string, number>;
  fontFeatures?: Record<string, number>;
  /** PaintBase extras (opacity/visible/blendMode) with no DTCG home. Only defined fields are set. */
  paint?: { opacity?: number; visible?: boolean; blendMode?: string };
}

export interface DtcgTokenExtensions {
  "com.peneditor"?: PenTokenExtension;
}

export interface DtcgToken {
  $value: unknown;
  $type?: string;
  $description?: string;
  $extensions?: DtcgTokenExtensions;
}

export interface DtcgGroup {
  [key: string]: DtcgNode | string | DtcgTokenExtensions | undefined;
  $type?: string;
  $description?: string;
}

export type DtcgNode = DtcgToken | DtcgGroup;
export type DtcgDocument = DtcgGroup;

/** A node is a token iff it carries a $value. */
export function isToken(node: DtcgNode): node is DtcgToken {
  return node != null && typeof node === "object" && "$value" in node;
}

export function readPenExt(token: DtcgToken): PenTokenExtension | undefined {
  return token.$extensions?.["com.peneditor"];
}
