import type { PathAnchor } from "@/types/scene";

/** One subcontour of a parsed vector script — usually there is exactly one. */
export interface VectorContour {
  points: PathAnchor[];
  closed: boolean;
}

export interface ParsedVectorDraft {
  /**
   * Anchors of every contour concatenated, in encounter order. Used for
   * anchor-count reporting and for drawing preview markers across all
   * subcontours — callers that only care about a single contour's points
   * should read `contours[0].points` instead.
   */
  points: PathAnchor[];
  /** One entry per subcontour produced by the script (usually one). */
  contours: VectorContour[];
  geometry: string;
  bounds: { x: number; y: number; width: number; height: number };
  /** True only when there is exactly one contour and it is closed. */
  closed: boolean;
  /** Set to "evenodd" when the geometry has more than one subcontour. */
  fillRule?: "evenodd";
  fill?: string;
  stroke?: { color: string; width: number };
  ended: boolean;
  /** Human-readable notes about recoverable issues that were auto-fixed. */
  warnings: string[];
}

export type VectorParseResult =
  | { ok: true; draft: ParsedVectorDraft; completeLineCount: number }
  | { ok: false; error: string; line: number };

export type VectorParseMode = "preview" | "final";
