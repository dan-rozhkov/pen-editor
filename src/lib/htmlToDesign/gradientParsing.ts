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

export function parseCssLinearGradient(bgImage: string): GradientFill | null {
  const start = bgImage.toLowerCase().indexOf("linear-gradient(");
  if (start < 0) return null;

  const openParen = bgImage.indexOf("(", start);
  if (openParen < 0) return null;

  let depth = 0;
  let closeParen = -1;
  for (let i = openParen; i < bgImage.length; i++) {
    const ch = bgImage[i];
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

  const inside = bgImage.slice(openParen + 1, closeParen).trim();
  const parts = splitSelectorList(inside);
  if (parts.length < 2) return null;

  let angleDeg = 180;
  let stopStartIndex = 0;
  const parsedAngle = parseLinearGradientAngle(parts[0] ?? "");
  if (parsedAngle != null) {
    angleDeg = parsedAngle;
    stopStartIndex = 1;
  }

  const rawStops = parts.slice(stopStartIndex);
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

  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const len = Math.abs(cos) + Math.abs(sin);
  const half = len / 2;
  const startX = Math.max(0, Math.min(1, 0.5 - cos * half));
  const startY = Math.max(0, Math.min(1, 0.5 - sin * half));
  const endX = Math.max(0, Math.min(1, 0.5 + cos * half));
  const endY = Math.max(0, Math.min(1, 0.5 + sin * half));

  return {
    type: "linear",
    stops: stops.map((s) => ({
      color: s.color,
      position: s.position ?? 0,
      ...(s.opacity !== undefined ? { opacity: s.opacity } : {}),
    })),
    startX,
    startY,
    endX,
    endY,
  };
}
