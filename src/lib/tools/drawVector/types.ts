import type { PathAnchor } from "@/types/scene";

export interface ParsedVectorDraft {
  points: PathAnchor[];
  geometry: string;
  bounds: { x: number; y: number; width: number; height: number };
  closed: boolean;
  fill?: string;
  stroke?: { color: string; width: number };
  ended: boolean;
}

export type VectorParseResult =
  | { ok: true; draft: ParsedVectorDraft; completeLineCount: number }
  | { ok: false; error: string; line: number };

export type VectorParseMode = "preview" | "final";
