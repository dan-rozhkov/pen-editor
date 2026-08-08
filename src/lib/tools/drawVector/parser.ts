import type { PathAnchor } from "@/types/scene";
import { anchorsToSVGPath, computeAnchorsBBox } from "@/utils/pathAnchors";
import type { ParsedVectorDraft, VectorParseMode, VectorParseResult } from "./types";

const MAX_COMMAND_CHARS = 32_768;
const MAX_ANCHORS = 512;
const MAX_COORD_MAGNITUDE = 1_000_000;
const MAX_STROKE_WIDTH = 100;

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const COLOR = String.raw`#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?`;
const commandPattern = (name: string, args: string) =>
  new RegExp(String.raw`^${name}\s*\(\s*${args}\s*\)$`);

const M_OR_L = (name: "M" | "L") =>
  commandPattern(name, String.raw`(${NUMBER})\s*,\s*(${NUMBER})`);
const C = commandPattern(
  "C",
  Array.from({ length: 6 }, () => `(${NUMBER})`).join(String.raw`\s*,\s*`),
);
const CLOSE = commandPattern("CLOSE", "");
const FILL = commandPattern("FILL", String.raw`"(${COLOR})"`);
const STROKE = commandPattern(
  "STROKE",
  String.raw`"(${COLOR})"\s*,\s*(${NUMBER})`,
);
const END = commandPattern("END", "");

function clonePoints(points: PathAnchor[]): PathAnchor[] {
  return points.map((point) => ({
    ...point,
    handleIn: point.handleIn ? { ...point.handleIn } : point.handleIn,
    handleOut: point.handleOut ? { ...point.handleOut } : point.handleOut,
  }));
}

function makeDraft(
  points: PathAnchor[],
  closed: boolean,
  fill: string | undefined,
  stroke: { color: string; width: number } | undefined,
  ended: boolean,
): ParsedVectorDraft {
  const ownedPoints = clonePoints(points);
  return {
    points: ownedPoints,
    geometry: anchorsToSVGPath(ownedPoints, closed),
    bounds: computeAnchorsBBox(ownedPoints, closed),
    closed,
    fill,
    stroke: stroke ? { ...stroke } : undefined,
    ended,
  };
}

function failure(error: string, line: number): VectorParseResult {
  return { ok: false, error, line: Math.max(1, line) };
}

function parseNumbers(values: string[], line: number): number[] | VectorParseResult {
  const parsed = values.map(Number);
  if (parsed.some((value) => !Number.isFinite(value))) {
    return failure("Numbers must be finite", line);
  }
  if (parsed.some((value) => Math.abs(value) > MAX_COORD_MAGNITUDE)) {
    return failure("Coordinates exceed the supported range", line);
  }
  return parsed;
}

export function parseVectorCommands(text: string, mode: VectorParseMode): VectorParseResult {
  if (text.length > MAX_COMMAND_CHARS) {
    return failure(`Command text exceeds ${MAX_COMMAND_CHARS} characters`, 1);
  }

  const lines = text.split("\n");
  if (mode === "preview" && !text.endsWith("\n")) lines.pop();

  let points: PathAnchor[] = [];
  let closed = false;
  let fill: string | undefined;
  let stroke: { color: string; width: number } | undefined;
  let ended = false;
  let sawMove = false;
  let endLine = Math.max(1, lines.length);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) continue;
    if (ended) return failure("Commands are not allowed after END", lineNumber);

    let match = line.match(M_OR_L("M"));
    if (match) {
      if (sawMove) return failure("M may appear only once", lineNumber);
      const values = parseNumbers(match.slice(1), lineNumber);
      if (!Array.isArray(values)) return values;
      points = [{ x: values[0], y: values[1] }];
      sawMove = true;
      continue;
    }

    match = line.match(M_OR_L("L"));
    if (match) {
      if (!sawMove) return failure("L requires M", lineNumber);
      if (closed) return failure("Geometry is already closed", lineNumber);
      const values = parseNumbers(match.slice(1), lineNumber);
      if (!Array.isArray(values)) return values;
      if (points.length >= MAX_ANCHORS) return failure(`At most ${MAX_ANCHORS} anchors are allowed`, lineNumber);
      points = [...clonePoints(points), { x: values[0], y: values[1] }];
      continue;
    }

    match = line.match(C);
    if (match) {
      if (!sawMove) return failure("C requires M", lineNumber);
      if (closed) return failure("Geometry is already closed", lineNumber);
      const values = parseNumbers(match.slice(1), lineNumber);
      if (!Array.isArray(values)) return values;
      if (points.length >= MAX_ANCHORS) return failure(`At most ${MAX_ANCHORS} anchors are allowed`, lineNumber);
      const next = clonePoints(points);
      next[next.length - 1] = {
        ...next[next.length - 1],
        handleOut: { x: values[0], y: values[1] },
      };
      next.push({ x: values[4], y: values[5], handleIn: { x: values[2], y: values[3] } });
      points = next;
      continue;
    }

    if (CLOSE.test(line)) {
      if (!sawMove) return failure("CLOSE requires M", lineNumber);
      if (closed) return failure("CLOSE may appear only once", lineNumber);
      closed = true;
      continue;
    }

    match = line.match(FILL);
    if (match) {
      if (!closed) return failure("FILL requires a closed contour", lineNumber);
      if (fill !== undefined) return failure("FILL may appear only once", lineNumber);
      fill = match[1];
      continue;
    }

    match = line.match(STROKE);
    if (match) {
      if (!sawMove) return failure("STROKE requires geometry", lineNumber);
      if (stroke !== undefined) return failure("STROKE may appear only once", lineNumber);
      const width = Number(match[2]);
      if (!Number.isFinite(width) || width <= 0 || width > MAX_STROKE_WIDTH) {
        return failure(`Stroke width must be greater than 0 and at most ${MAX_STROKE_WIDTH}`, lineNumber);
      }
      stroke = { color: match[1], width };
      continue;
    }

    if (END.test(line)) {
      if (!sawMove) return failure("END requires geometry", lineNumber);
      ended = true;
      endLine = lineNumber;
      continue;
    }

    return failure("Unknown command or invalid arguments", lineNumber);
  }

  if (mode === "final") {
    if (!ended) return failure("END is required", Math.max(1, lines.length));
    const minimum = closed ? 3 : 2;
    if (points.length < minimum) {
      return failure(`${closed ? "Closed" : "Open"} contours require at least ${minimum} anchors`, endLine);
    }
  }

  return {
    ok: true,
    draft: makeDraft(points, closed, fill, stroke, ended),
    completeLineCount: lines.length,
  };
}

export function buildVectorReplayFrames(text: string): ParsedVectorDraft[] {
  if (!parseVectorCommands(text, "final").ok) return [];

  const lines = text.split("\n");
  const frames: ParsedVectorDraft[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!/^(?:M|L|C|CLOSE|FILL|STROKE)\s*\(/.test(line)) continue;
    const prefix = `${lines.slice(0, index + 1).join("\n")}\n`;
    const result = parseVectorCommands(prefix, "preview");
    if (result.ok) frames.push(makeDraft(
      result.draft.points,
      result.draft.closed,
      result.draft.fill,
      result.draft.stroke,
      false,
    ));
  }
  return frames;
}
