import type { GradientFill } from "@/types/scene";
import { splitSelectorList } from "./cssScoping";
import { parseColorWithOpacity } from "./colorParsing";

function parseLinearGradientAngle(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  const degMatch = value.match(/^(-?\d+(?:\.\d+)?)deg$/);
  if (degMatch) return parseFloat(degMatch[1]);

  if (value.startsWith("to ")) {
    const dir = value.slice(3).trim();
    const map: Record<string, number> = {
      top: 0,
      right: 90,
      bottom: 180,
      left: 270,
      "top right": 45,
      "right top": 45,
      "bottom right": 135,
      "right bottom": 135,
      "bottom left": 225,
      "left bottom": 225,
      "top left": 315,
      "left top": 315,
    };
    return map[dir] ?? null;
  }

  return null;
}

function splitColorAndPosition(rawStop: string): { color: string; position?: number } {
  let depth = 0;
  let splitIndex = -1;
  for (let i = rawStop.length - 1; i >= 0; i--) {
    const ch = rawStop[i];
    if (ch === ")") depth++;
    else if (ch === "(") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(ch)) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex < 0) {
    return { color: rawStop.trim() };
  }

  const color = rawStop.slice(0, splitIndex).trim();
  const tail = rawStop.slice(splitIndex + 1).trim();
  const pct = tail.match(/^(-?\d+(?:\.\d+)?)%$/);
  if (!pct) return { color: rawStop.trim() };

  const pos = parseFloat(pct[1]) / 100;
  if (!Number.isFinite(pos)) return { color };
  return { color, position: Math.max(0, Math.min(1, pos)) };
}

/**
 * Extract the inner argument list of the first `fnName(...)` occurrence in
 * `value`, respecting nested parentheses. Returns null if not present.
 */
function extractFunctionArgs(value: string, fnName: string): string | null {
  const start = value.toLowerCase().indexOf(`${fnName}(`);
  if (start < 0) return null;
  const openParen = value.indexOf("(", start);
  if (openParen < 0) return null;

  let depth = 0;
  let closeParen = -1;
  for (let i = openParen; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen < 0) return null;
  return value.slice(openParen + 1, closeParen).trim();
}

/** Parse `<color> <pos%>?` stop tokens into GradientFill stops. */
function parseGradientStops(rawStops: string[]): GradientFill["stops"] | null {
  if (rawStops.length < 2) return null;
  const stops = rawStops.map((rawStop) => {
    const parsed = splitColorAndPosition(rawStop);
    const colorWithOpacity = parseColorWithOpacity(parsed.color);
    if (!colorWithOpacity) {
      return { color: "#000000", opacity: 0, position: parsed.position };
    }
    return {
      color: colorWithOpacity.color,
      ...(colorWithOpacity.opacity !== undefined ? { opacity: colorWithOpacity.opacity } : {}),
      ...(parsed.position !== undefined ? { position: parsed.position } : {}),
    };
  });

  // Fallback distribution for omitted positions.
  const last = stops.length - 1;
  stops.forEach((s, i) => {
    if (s.position === undefined) s.position = last > 0 ? i / last : 0;
  });

  return stops.map((s) => ({
    color: s.color,
    position: s.position ?? 0,
    ...(s.opacity !== undefined ? { opacity: s.opacity } : {}),
  }));
}

export function parseCssLinearGradient(bgImage: string): GradientFill | null {
  const inside = extractFunctionArgs(bgImage, "linear-gradient");
  if (inside === null) return null;

  const parts = splitSelectorList(inside);
  if (parts.length < 2) return null;

  let angleDeg = 180;
  let stopStartIndex = 0;
  const parsedAngle = parseLinearGradientAngle(parts[0] ?? "");
  if (parsedAngle != null) {
    angleDeg = parsedAngle;
    stopStartIndex = 1;
  }

  const stops = parseGradientStops(parts.slice(stopStartIndex));
  if (!stops) return null;

  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const len = Math.abs(cos) + Math.abs(sin);
  const half = len / 2;
  const startX = Math.max(0, Math.min(1, 0.5 - cos * half));
  const startY = Math.max(0, Math.min(1, 0.5 - sin * half));
  const endX = Math.max(0, Math.min(1, 0.5 + cos * half));
  const endY = Math.max(0, Math.min(1, 0.5 + sin * half));

  return { type: "linear", stops, startX, startY, endX, endY };
}

export function parseCssRadialGradient(bgImage: string): GradientFill | null {
  const inside = extractFunctionArgs(bgImage, "radial-gradient");
  if (inside === null) return null;

  const parts = splitSelectorList(inside);
  if (parts.length < 2) return null;

  // The first segment may be a shape/size/position config (no comma inside it
  // after splitting) — e.g. "circle at center". A color stop always parses as
  // a color, so if the first part is not a color, treat it as config.
  let stopStartIndex = 0;
  const firstParsed = splitColorAndPosition(parts[0] ?? "");
  if (!parseColorWithOpacity(firstParsed.color)) {
    stopStartIndex = 1;
  }

  const stops = parseGradientStops(parts.slice(stopStartIndex));
  if (!stops) return null;

  // Radial gradients are centered; use a normalized center-out vector.
  return {
    type: "radial",
    stops,
    startX: 0.5,
    startY: 0.5,
    endX: 1,
    endY: 0.5,
  };
}

/** Parse either a linear or radial CSS gradient into a GradientFill. */
export function parseCssGradient(bgImage: string): GradientFill | null {
  const lower = bgImage.toLowerCase();
  if (lower.includes("linear-gradient(")) return parseCssLinearGradient(bgImage);
  if (lower.includes("radial-gradient(")) return parseCssRadialGradient(bgImage);
  return null;
}

/**
 * Detect a flat `linear-gradient(<c>, <c>)` whose stops are all the same solid
 * color — used by designToHtml to encode a mid-stack solid layer. Returns the
 * single color (with optional opacity) when it matches, else null.
 */
export function detectSolidGradient(
  bgImage: string,
): { color: string; opacity?: number } | null {
  const inside = extractFunctionArgs(bgImage, "linear-gradient");
  if (inside === null) return null;
  const parts = splitSelectorList(inside);
  // Reject when an angle/direction prefix is present.
  if (parseLinearGradientAngle(parts[0] ?? "") != null) return null;
  if (parts.length < 2) return null;

  const colors = parts.map((p) => parseColorWithOpacity(splitColorAndPosition(p).color));
  if (colors.some((c) => !c)) return null;
  const first = colors[0]!;
  const allSame = colors.every(
    (c) => c!.color === first.color && c!.opacity === first.opacity,
  );
  if (!allSame) return null;
  return first.opacity !== undefined
    ? { color: first.color, opacity: first.opacity }
    : { color: first.color };
}
