// src/lib/designTokens/dtcgTypes.ts
import type {
  CollectionId,
  ModeId,
  VariableDeprecation,
  VariableMode,
  VariableScope,
} from "@/types/variable";

/** Which pen-editor store a token round-trips back into. */
export type PenTokenSource = "variable" | "fillStyle" | "effectStyle" | "textStyle";

/** Vendor extension we attach under $extensions["com.peneditor"]. */
export interface PenTokenExtension {
  /** Original store id — restores the exact entity on re-import. */
  id: string;
  source: PenTokenSource;
  /** Legacy dual-write (still READ): a color Theme variable's dark value. Base $value is the light value. */
  themes?: { dark: string };
  /**
   * The variable's collection. Omitted for the standard Theme collection
   * (light/dark): a pen token without it is read as a Theme-collection variable.
   */
  collection?: { id: CollectionId; name: string; modes: VariableMode[]; defaultModeId: ModeId };
  /** Every mode's value (literal or "{path}" alias), default mode included. Only when the collection has >1 mode. */
  modes?: Record<ModeId, string | number>;
  /** Variable name, only when the token path was prefixed with the collection name to avoid a collision. */
  name?: string;
  scopes?: VariableScope[];
  /** `replacedBy` is exported as a "{path}" alias. */
  deprecated?: Omit<VariableDeprecation, "replacedBy"> & { replacedBy?: string };
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
