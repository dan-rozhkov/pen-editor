import type { PathAnchor } from "@/types/scene";
import { anchorsToSVGPath, computeAnchorsBBox } from "@/utils/pathAnchors";
import type {
  ParsedVectorDraft,
  VectorContour,
  VectorParseMode,
  VectorParseResult,
} from "./types";

const MAX_COMMAND_CHARS = 32_768;
const MAX_ANCHORS = 512;
const MAX_COORD_MAGNITUDE = 1_000_000;
const MAX_STROKE_WIDTH = 100;
const MIN_STROKE_WIDTH = 0.1;
const MIN_EXTENT = 1e-3;

// Matches a whole command line in the parenthesized form: NAME(args). Args
// are parsed leniently by the per-command handlers below (numbers separated
// by spaces and/or commas, quoted color strings) rather than by a
// per-command regex, so odd-but-legible spacing never turns into a hard
// failure.
const COMMAND_LINE = /^([A-Za-z]+)\s*\(([\s\S]*)\)$/;

// Matches the bareword form some models default to out of plain-SVG habit —
// `NAME` followed by whitespace-separated args, or no args at all (e.g. `m
// 120 320`, or a bare `Z`/`CLOSE`/`END`). This is purely a different way to
// slice a line into { name, argsRaw }: splitArgs already treats whitespace
// and commas as interchangeable separators, so argsRaw feeds the exact same
// per-command handlers as the parenthesized form above — there is no second,
// parallel parsing path per command.
const BARE_COMMAND_LINE = /^([A-Za-z]+)(?:\s+([\s\S]*))?$/;

function clonePoints(points: PathAnchor[]): PathAnchor[] {
  return points.map((point) => ({
    ...point,
    handleIn: point.handleIn ? { ...point.handleIn } : point.handleIn,
    handleOut: point.handleOut ? { ...point.handleOut } : point.handleOut,
  }));
}

function failure(error: string, line: number): VectorParseResult {
  return { ok: false, error, line: Math.max(1, line) };
}

/**
 * Splits a command's argument text into tokens, keeping quoted strings and
 * unquoted `name(...)` calls (e.g. `rgb(255, 0, 0)`) intact as single
 * tokens — otherwise the function-call alternative would never be tried and
 * the commas inside it would be sliced apart by the generic fallback.
 */
function splitArgs(argsRaw: string): string[] {
  const tokens: string[] = [];
  const re = /"[^"]*"|'[^']*'|[A-Za-z]+\([^()]*\)|[^\s,]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(argsRaw)) !== null) tokens.push(match[0]);
  return tokens;
}

function parseNumberArgs(
  argsRaw: string,
  expected: number,
  lineNumber: number,
): number[] | VectorParseResult {
  const tokens = splitArgs(argsRaw);
  if (tokens.length !== expected) {
    return failure("Unknown command or invalid arguments", lineNumber);
  }
  const parsed = tokens.map(Number);
  if (parsed.some((value) => !Number.isFinite(value))) {
    return failure("Numbers must be finite", lineNumber);
  }
  if (parsed.some((value) => Math.abs(value) > MAX_COORD_MAGNITUDE)) {
    return failure("Coordinates exceed the supported range", lineNumber);
  }
  return parsed;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Normalizes a color token to `#RRGGBB`/`#RRGGBBAA`. Accepts `#RGB`,
 * `#RGBA`, `#RRGGBB`, `#RRGGBBAA` (case preserved as written — only the
 * shorthand forms are expanded), `rgb()`/`rgba()`, and `none`/`transparent`
 * (which mean "no paint", represented as `value: undefined`). Anything else
 * is not recognized and the caller should treat it as fatal — there is no
 * safe guess for an arbitrary color keyword or malformed function call.
 */
function normalizeColor(raw: string): { ok: true; value: string | undefined } | { ok: false } {
  const unquoted = raw.replace(/^["']|["']$/g, "").trim();
  const lower = unquoted.toLowerCase();
  if (lower === "none" || lower === "transparent") return { ok: true, value: undefined };

  const hexMatch = unquoted.match(/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      const expanded = hex
        .split("")
        .map((c) => c + c)
        .join("");
      return { ok: true, value: `#${expanded}` };
    }
    return { ok: true, value: `#${hex}` };
  }

  // Components accept a leading sign (out-of-range values like `rgb(300,
  // -5, 0)` are meant to be clamped, not rejected — `clampByte` exists
  // precisely for that) but each one is validated with `Number.isFinite`
  // below: the character class alone would happily match a malformed
  // component like "1.2.3" (multiple embedded dots), and `Number("1.2.3")`
  // is `NaN` — clamping a `NaN` produces `#NaN0000`, silently committing
  // garbage into the scene instead of failing as the docstring promises.
  const rgbMatch = unquoted.match(
    /^rgba?\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(?:,\s*(-?[\d.]+)\s*)?\)$/i,
  );
  if (rgbMatch) {
    const components = [rgbMatch[1], rgbMatch[2], rgbMatch[3]].map(Number);
    if (rgbMatch[4] !== undefined) components.push(Number(rgbMatch[4]));
    if (components.some((value) => !Number.isFinite(value))) return { ok: false };

    const [r, g, b] = components.slice(0, 3).map(clampByte);
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    let hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    if (rgbMatch[4] !== undefined) {
      hex += toHex(Math.round(clamp01(components[3]) * 255));
    }
    return { ok: true, value: hex };
  }

  return { ok: false };
}

type ColorArgResult =
  | { ok: true; value: string | undefined }
  | { ok: false; failure: VectorParseResult };

function parseColorArg(argsRaw: string, lineNumber: number): ColorArgResult {
  const tokens = splitArgs(argsRaw);
  if (tokens.length !== 1) {
    return { ok: false, failure: failure("Unknown command or invalid arguments", lineNumber) };
  }
  const normalized = normalizeColor(tokens[0]);
  if (!normalized.ok) {
    return { ok: false, failure: failure("Unrecognized color format", lineNumber) };
  }
  return { ok: true, value: normalized.value };
}

type StrokeArgResult =
  | { ok: true; value: { color: string; width: number } | undefined }
  | { ok: false; failure: VectorParseResult };

function parseStrokeArg(argsRaw: string, lineNumber: number, warnings: string[]): StrokeArgResult {
  const tokens = splitArgs(argsRaw);
  if (tokens.length !== 2) {
    return { ok: false, failure: failure("Unknown command or invalid arguments", lineNumber) };
  }
  const colorResult = normalizeColor(tokens[0]);
  if (!colorResult.ok) {
    return { ok: false, failure: failure("Unrecognized color format", lineNumber) };
  }
  if (colorResult.value === undefined) {
    // STROKE("none"/"transparent", w) means "no stroke at all".
    return { ok: true, value: undefined };
  }
  const rawWidth = Number(tokens[1]);
  if (!Number.isFinite(rawWidth)) {
    return { ok: false, failure: failure("Stroke width must be a finite number", lineNumber) };
  }
  let width = rawWidth;
  // Anything below MIN_STROKE_WIDTH — not just <= 0 — is clamped up: a
  // vanishingly small positive width (e.g. 1e-9) is just as invisible on
  // screen as zero, and would otherwise sail past this check and commit an
  // unpaintable stroke (see the fill/pathStroke visibility guard in index.ts).
  if (width < MIN_STROKE_WIDTH || width > MAX_STROKE_WIDTH) {
    const clamped = Math.min(MAX_STROKE_WIDTH, Math.max(MIN_STROKE_WIDTH, width));
    warnings.push(
      `Line ${lineNumber}: stroke width ${rawWidth} was out of the (0, ${MAX_STROKE_WIDTH}] range and was clamped to ${clamped}.`,
    );
    width = clamped;
  }
  return { ok: true, value: { color: colorResult.value, width } };
}

function mergeBounds(
  boxes: { x: number; y: number; width: number; height: number }[],
): { x: number; y: number; width: number; height: number } {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  if (boxes.length === 1) return boxes[0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(MIN_EXTENT, maxX - minX),
    height: Math.max(MIN_EXTENT, maxY - minY),
  };
}

function makeDraft(
  contours: VectorContour[],
  fill: string | undefined,
  stroke: { color: string; width: number } | undefined,
  ended: boolean,
  warnings: string[],
): ParsedVectorDraft {
  const ownedContours = contours.map((contour) => ({
    points: clonePoints(contour.points),
    closed: contour.closed,
  }));
  const flatPoints = ownedContours.flatMap((contour) => contour.points);
  const geometry = ownedContours
    .map((contour) => anchorsToSVGPath(contour.points, contour.closed))
    .join(" ");
  const bounds = mergeBounds(
    ownedContours.map((contour) => computeAnchorsBBox(contour.points, contour.closed)),
  );
  const multi = ownedContours.length > 1;

  return {
    points: flatPoints,
    contours: ownedContours,
    geometry,
    bounds,
    closed: !multi && ownedContours[0]?.closed === true,
    ...(multi ? { fillRule: "evenodd" as const } : {}),
    fill,
    stroke: stroke ? { ...stroke } : undefined,
    ended,
    warnings,
  };
}

export function parseVectorCommands(text: string, mode: VectorParseMode): VectorParseResult {
  if (text.length > MAX_COMMAND_CHARS) {
    return failure(`Command text exceeds ${MAX_COMMAND_CHARS} characters`, 1);
  }

  const rawLines = text.split("\n");
  const lines = mode === "preview" && !text.endsWith("\n") ? rawLines.slice(0, -1) : rawLines;

  const contours: VectorContour[] = [];
  let current: VectorContour | null = null;
  let fill: string | undefined;
  let fillSet = false;
  let stroke: { color: string; width: number } | undefined;
  let strokeSet = false;
  let ended = false;
  let sawMove = false;
  let totalAnchors = 0;
  let anchorLimitWarned = false;
  let trailingWarned = false;
  const warnings: string[] = [];
  let endLine = Math.max(1, lines.length);

  const finalizeCurrentContour = (): void => {
    if (current) {
      contours.push(current);
      current = null;
    }
  };

  const canAddAnchor = (lineNumber: number): boolean => {
    if (totalAnchors < MAX_ANCHORS) return true;
    if (!anchorLimitWarned) {
      warnings.push(
        `Line ${lineNumber}: reached the ${MAX_ANCHORS}-anchor limit; further points were dropped.`,
      );
      anchorLimitWarned = true;
    }
    return false;
  };

  const anyOpenContour = (): boolean => {
    if (current && !current.closed && current.points.length > 0) return true;
    return contours.some((contour) => !contour.closed);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trim().replace(/;+\s*$/, "");
    if (!line) continue;
    if (/^```/.test(line)) continue; // markdown code-fence delimiter, e.g. "```" or "```text"

    if (ended) {
      if (!trailingWarned) {
        warnings.push(`Line ${lineNumber}: content after END() was ignored.`);
        trailingWarned = true;
      }
      continue;
    }

    // Try the parenthesized form first; only fall back to the bareword form
    // when the line isn't `NAME(...)` at all (e.g. `NAME(1,2) trailing junk`
    // must still fail, not get reinterpreted as bareword with a garbage
    // argsRaw). Argument-count/format validation for the bareword form is
    // handled by the same per-command switch below, not here — e.g. bare
    // `CLOSE extra` reaches the CLOSE case with a non-empty argsRaw and is
    // rejected there exactly like `CLOSE(extra)` would be.
    const parenMatch = line.match(COMMAND_LINE);
    const bareMatch = parenMatch ? null : line.match(BARE_COMMAND_LINE);
    let rawName: string;
    let argsRaw: string;
    if (parenMatch) {
      rawName = parenMatch[1].toUpperCase();
      argsRaw = parenMatch[2];
    } else if (bareMatch) {
      rawName = bareMatch[1].toUpperCase();
      argsRaw = bareMatch[2] ?? "";
    } else {
      return failure("Unknown command or invalid arguments", lineNumber);
    }
    const commandName = rawName === "Z" ? "CLOSE" : rawName;

    switch (commandName) {
      case "M": {
        const values = parseNumberArgs(argsRaw, 2, lineNumber);
        if (!Array.isArray(values)) return values;
        finalizeCurrentContour();
        sawMove = true;
        if (canAddAnchor(lineNumber)) {
          current = { points: [{ x: values[0], y: values[1] }], closed: false };
          totalAnchors += 1;
        } else {
          current = { points: [], closed: false };
        }
        break;
      }

      case "L": {
        if (!current) return failure("L requires M", lineNumber);
        const values = parseNumberArgs(argsRaw, 2, lineNumber);
        if (!Array.isArray(values)) return values;
        if (current.closed) return failure("Geometry is already closed", lineNumber);
        if (canAddAnchor(lineNumber)) {
          current.points.push({ x: values[0], y: values[1] });
          totalAnchors += 1;
        }
        break;
      }

      case "C": {
        if (!current) return failure("C requires M", lineNumber);
        const values = parseNumberArgs(argsRaw, 6, lineNumber);
        if (!Array.isArray(values)) return values;
        if (current.closed) return failure("Geometry is already closed", lineNumber);
        if (current.points.length === 0) break; // the M that opened this contour hit the anchor limit
        if (canAddAnchor(lineNumber)) {
          const last = current.points[current.points.length - 1];
          current.points[current.points.length - 1] = {
            ...last,
            handleOut: { x: values[0], y: values[1] },
          };
          current.points.push({
            x: values[4],
            y: values[5],
            handleIn: { x: values[2], y: values[3] },
          });
          totalAnchors += 1;
        }
        break;
      }

      case "CLOSE": {
        if (splitArgs(argsRaw).length !== 0) {
          return failure("Unknown command or invalid arguments", lineNumber);
        }
        if (!current) return failure("CLOSE requires M", lineNumber);
        // The M that opened this contour hit MAX_ANCHORS and was dropped
        // (current.points is empty, not null) — the limit is already
        // reflected as a warning there, so treat CLOSE the same way L/C do
        // in this state: a silent no-op, not a second, misleading fatal
        // error blaming a missing M that did in fact happen.
        if (current.points.length === 0) break;
        if (current.closed) {
          warnings.push(`Line ${lineNumber}: duplicate CLOSE was ignored.`);
        } else {
          current.closed = true;
        }
        break;
      }

      case "FILL": {
        if (!sawMove) return failure("FILL requires geometry", lineNumber);
        const colorResult = parseColorArg(argsRaw, lineNumber);
        if (!colorResult.ok) return colorResult.failure;
        if (fillSet) {
          warnings.push(`Line ${lineNumber}: duplicate FILL overrides the earlier value.`);
        }
        if (colorResult.value !== undefined && anyOpenContour()) {
          warnings.push(
            `Line ${lineNumber}: FILL applied to an open contour; it will be closed implicitly for the fill.`,
          );
        }
        fill = colorResult.value;
        fillSet = true;
        break;
      }

      case "STROKE": {
        if (!sawMove) return failure("STROKE requires geometry", lineNumber);
        const strokeResult = parseStrokeArg(argsRaw, lineNumber, warnings);
        if (!strokeResult.ok) return strokeResult.failure;
        if (strokeSet) {
          warnings.push(`Line ${lineNumber}: duplicate STROKE overrides the earlier value.`);
        }
        stroke = strokeResult.value;
        strokeSet = true;
        break;
      }

      case "END": {
        if (splitArgs(argsRaw).length !== 0) {
          return failure("Unknown command or invalid arguments", lineNumber);
        }
        ended = true;
        endLine = lineNumber;
        break;
      }

      default:
        return failure("Unknown command or invalid arguments", lineNumber);
    }
  }

  finalizeCurrentContour();

  // Preview mode renders whatever partial state the model has streamed so
  // far, including an in-progress single-anchor contour or an
  // under-anchored closed one — dropping/downgrading those mid-stream would
  // make the preview flicker away anchors the model is still about to
  // complete. Only the final commit needs the anchor-count guarantees.
  // A zero-point contour only happens when the anchor that opened it was
  // dropped for hitting MAX_ANCHORS — never meaningful to render or bound.
  let cleaned = contours.filter((contour) => contour.points.length > 0);
  if (mode === "final") {
    if (!ended) {
      warnings.push("END() was missing; the command stream was treated as complete.");
    }

    const finalCleaned: VectorContour[] = [];
    for (const contour of contours) {
      if (contour.points.length === 0) continue;
      if (contour.points.length === 1) {
        warnings.push("A contour with a single anchor has no geometry and was dropped.");
        continue;
      }
      if (contour.closed && contour.points.length < 3) {
        warnings.push("A closed contour needs at least 3 anchors; it was kept open instead.");
        finalCleaned.push({ points: contour.points, closed: false });
        continue;
      }
      finalCleaned.push(contour);
    }
    cleaned = finalCleaned;

    if (cleaned.length === 0) {
      return failure("No valid geometry was produced", endLine);
    }
  }

  return {
    ok: true,
    draft: makeDraft(cleaned, fill, stroke, ended, warnings),
    completeLineCount: lines.length,
  };
}

export function buildVectorReplayFrames(text: string): ParsedVectorDraft[] {
  if (!parseVectorCommands(text, "final").ok) return [];

  const lines = text.split("\n");
  const frames: ParsedVectorDraft[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    // Recognize both the parenthesized and bareword command forms — `\b`
    // rejects a longer identifier that merely starts with a command name
    // (e.g. "CLOSEX") while accepting whatever separator follows a real one:
    // "(", whitespace, ";", or end of line.
    if (!/^(?:CLOSE|STROKE|FILL|M|L|C|Z)\b/i.test(line)) continue;
    const prefix = `${lines.slice(0, index + 1).join("\n")}\n`;
    const result = parseVectorCommands(prefix, "preview");
    if (result.ok) frames.push({ ...result.draft, ended: false });
  }
  return frames;
}
