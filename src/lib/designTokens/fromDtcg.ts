// src/lib/designTokens/fromDtcg.ts
import type { Variable, VariableType } from "@/types/variable";
import { generateVariableId } from "@/types/variable";
import type { FillStyle, EffectStyle } from "@/types/style";
import { generateFillStyleId, generateEffectStyleId } from "@/types/style";
import type { TextStyle } from "@/types/textStyle";
import { generateTextStyleId } from "@/types/textStyle";
import type {
  GradientFill,
  GradientColorStop,
  ShadowEffect,
  SolidPaint,
  GradientPaint,
  PaintBlendMode,
} from "@/types/scene";
import { generateId } from "@/types/scene";
import type { DtcgDocument, DtcgToken, PenTokenSource } from "./dtcgTypes";
import { readPenExt } from "./dtcgTypes";
import { walkTokens } from "./tokenPath";

export interface ImportResult {
  variables: Variable[];
  fillStyles: FillStyle[];
  effectStyles: EffectStyle[];
  textStyles: TextStyle[];
}

interface Collected {
  token: DtcgToken;
  segments: string[];
  source: PenTokenSource;
  id: string | undefined;
}

const ALIAS_RE = /^\{(.+)\}$/;

/** Copy back the defined PaintBase extras (opacity/visible/blendMode) from the DTCG extension onto a paint. */
function applyPaintExt(
  paint: SolidPaint | GradientPaint,
  paintExt: { opacity?: number; visible?: boolean; blendMode?: string } | undefined,
): void {
  if (!paintExt) return;
  if (paintExt.opacity !== undefined) paint.opacity = paintExt.opacity;
  if (paintExt.visible !== undefined) paint.visible = paintExt.visible;
  if (paintExt.blendMode !== undefined) paint.blendMode = paintExt.blendMode as PaintBlendMode;
}

/** Reconstruct the store name; drop a leading source-group prefix for styles. */
function nameFromSegments(segments: string[], source: PenTokenSource): string {
  const prefix = source === "fillStyle" ? "fill" : source === "effectStyle" ? "effect" : source === "textStyle" ? "text" : null;
  const segs = prefix && segments[0] === prefix ? segments.slice(1) : segments;
  return segs.join("/");
}

/** Decide the source of a token: explicit ext wins, else heuristic on group prefix + $type. */
function classify(token: DtcgToken, segments: string[]): { source: PenTokenSource; id: string | undefined } | null {
  const ext = readPenExt(token);
  if (ext) return { source: ext.source, id: ext.id };
  const prefix = segments[0];
  if (prefix === "fill" && (token.$type === "color" || token.$type === "gradient")) {
    return { source: "fillStyle", id: undefined };
  }
  switch (token.$type) {
    case "color": return { source: "variable", id: undefined };
    case "gradient": return { source: "fillStyle", id: undefined };
    case "shadow": return { source: "effectStyle", id: undefined };
    case "typography": return { source: "textStyle", id: undefined };
    default: return null;
  }
}

export function fromDtcg(doc: DtcgDocument): { result: ImportResult; warnings: string[] } {
  const warnings: string[] = [];
  const collected: Collected[] = [];

  walkTokens(doc, (token, segments) => {
    const c = classify(token, segments);
    if (!c) {
      warnings.push(`Token "${segments.join("/")}" has $type "${token.$type ?? "none"}" with no mapping; skipped.`);
      return;
    }
    collected.push({ token, segments, source: c.source, id: c.id });
  });

  const result: ImportResult = { variables: [], fillStyles: [], effectStyles: [], textStyles: [] };
  const pathToVar = new Map<string, { id: string; value: string }>(); // "brand.500" → variable (for alias resolution)

  // Pass 1: variables (so fills can resolve aliases).
  for (const c of collected) {
    if (c.source !== "variable") continue;
    const ext = readPenExt(c.token);
    const type: VariableType = c.token.$type === "number" ? "number" : c.token.$type === "color" ? "color" : "string";
    const value = String(c.token.$value);
    const variable: Variable = {
      id: c.id ?? generateVariableId(),
      name: nameFromSegments(c.segments, "variable"),
      type,
      value,
    };
    if (type === "color" && ext?.themes) {
      variable.themeValues = { light: value, dark: ext.themes.dark };
    }
    result.variables.push(variable);
    pathToVar.set(c.segments.join("."), { id: variable.id, value: variable.value });
  }

  // Pass 2: styles.
  for (const c of collected) {
    if (c.source === "variable") continue;
    const ext = readPenExt(c.token);
    if (c.source === "fillStyle") {
      const name = nameFromSegments(c.segments, "fillStyle");
      if (c.token.$type === "gradient") {
        const g = ext?.gradient;
        const stops = (c.token.$value as GradientColorStop[]).map((s) =>
          s.opacity !== undefined
            ? { color: s.color, position: s.position, opacity: s.opacity }
            : { color: s.color, position: s.position },
        );
        const gradient: GradientFill = {
          type: g?.type ?? "linear",
          stops,
          startX: g?.startX ?? 0, startY: g?.startY ?? 0, endX: g?.endX ?? 1, endY: g?.endY ?? 1,
          ...(g?.startRadius !== undefined ? { startRadius: g.startRadius } : {}),
          ...(g?.endRadius !== undefined ? { endRadius: g.endRadius } : {}),
        };
        const paint: GradientPaint = { id: generateId(), type: "gradient", gradient };
        applyPaintExt(paint, ext?.paint);
        result.fillStyles.push({ id: c.id ?? generateFillStyleId(), name, paint });
      } else {
        // color token: literal or alias
        const raw = String(c.token.$value);
        const m = ALIAS_RE.exec(raw);
        const paint: SolidPaint = { id: generateId(), type: "solid", color: "#000000" };
        if (m) {
          const resolved = pathToVar.get(m[1]);
          if (resolved) {
            paint.colorBinding = { variableId: resolved.id };
            paint.color = resolved.value;
          } else {
            warnings.push(`Fill style "${name}" references unknown alias ${raw}; left unbound.`);
          }
        } else {
          paint.color = raw;
        }
        applyPaintExt(paint, ext?.paint);
        result.fillStyles.push({ id: c.id ?? generateFillStyleId(), name, paint });
      }
    } else if (c.source === "effectStyle") {
      const name = nameFromSegments(c.segments, "effectStyle");
      const raw = Array.isArray(c.token.$value) ? c.token.$value : [c.token.$value];
      const effects: ShadowEffect[] = (raw as Array<Record<string, unknown>>).map((s) => ({
        type: "shadow",
        shadowType: s.inset ? "inner" : "outer",
        color: String(s.color),
        offset: { x: Number(s.offsetX ?? 0), y: Number(s.offsetY ?? 0) },
        blur: Number(s.blur ?? 0),
        spread: Number(s.spread ?? 0),
      }));
      result.effectStyles.push({ id: c.id ?? generateEffectStyleId(), name, effects });
    } else {
      // textStyle
      const name = nameFromSegments(c.segments, "textStyle");
      const v = (c.token.$value ?? {}) as Record<string, unknown>;
      const style: TextStyle = { id: c.id ?? generateTextStyleId(), name };
      if (typeof v.fontFamily === "string") style.fontFamily = v.fontFamily;
      if (typeof v.fontSize === "number") style.fontSize = v.fontSize;
      if (typeof v.fontWeight === "string") style.fontWeight = v.fontWeight;
      if (typeof v.lineHeight === "number") style.lineHeight = v.lineHeight;
      if (typeof v.letterSpacing === "number") style.letterSpacing = v.letterSpacing;
      if (ext?.textTransform) style.textTransform = ext.textTransform as TextStyle["textTransform"];
      if (ext?.fontVariations) style.fontVariations = ext.fontVariations;
      if (ext?.fontFeatures) style.fontFeatures = ext.fontFeatures;
      result.textStyles.push(style);
    }
  }

  return { result, warnings };
}
