// src/lib/designTokens/fromDtcg.ts
import type {
  ModeId,
  Variable,
  VariableCollection,
  VariableModeValue,
  VariableType,
} from "@/types/variable";
import { generateVariableId, THEME_COLLECTION_ID } from "@/types/variable";
import {
  buildVariableIndex,
  finalizeVariables,
  makeThemeCollection,
  resolveVariable,
  aliasEdgeProblem,
  TYPE_DEFAULTS,
} from "@/lib/variables";
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
  /** Collections the imported variables live in (Theme, "Tokens" for foreign files, or the file's own). */
  collections: VariableCollection[];
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
    case "color":
    case "number": return { source: "variable", id: undefined };
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

  const result: ImportResult = { variables: [], collections: [], fillStyles: [], effectStyles: [], textStyles: [] };
  const pathToVar = new Map<string, Variable>(); // "brand.500" → variable (for alias resolution)
  const collectionsById = new Map<string, VariableCollection>();
  const collectionsByName = new Map<string, VariableCollection>();
  const registerCollection = (c: VariableCollection): VariableCollection => {
    const hit = collectionsById.get(c.id) ?? collectionsByName.get(c.name);
    if (hit) return hit;
    collectionsById.set(c.id, c);
    collectionsByName.set(c.name, c);
    result.collections.push(c);
    return c;
  };

  // Pass 1: variables and their collections; alias values stay raw until every path is known.
  const rawByVar = new Map<string, Record<ModeId, string | number>>();
  for (const c of collected) {
    if (c.source !== "variable") continue;
    const ext = readPenExt(c.token);
    const type: VariableType = c.token.$type === "number" ? "number" : c.token.$type === "color" ? "color" : "string";

    // Which collection: the file's own, else Theme for any pen token (legacy files), else "Tokens".
    let collection: VariableCollection;
    if (ext?.collection) {
      collection = registerCollection({
        id: ext.collection.id,
        name: ext.collection.name,
        modes: ext.collection.modes,
        defaultModeId: ext.collection.defaultModeId,
      });
    } else if (ext) {
      collection = registerCollection(makeThemeCollection());
    } else {
      collection = registerCollection({
        id: "tokens",
        name: "Tokens",
        modes: [{ id: "default", name: "Default" }],
        defaultModeId: "default",
      });
    }

    const base = c.token.$value as string | number;
    let raw: Record<ModeId, string | number>;
    if (ext?.modes) {
      raw = {};
      for (const [modeId, value] of Object.entries(ext.modes)) {
        if (collection.modes.some((m) => m.id === modeId)) raw[modeId] = value;
        else warnings.push(`Token "${c.segments.join("/")}" has a value for unknown mode "${modeId}"; skipped.`);
      }
      if (raw[collection.defaultModeId] === undefined) raw[collection.defaultModeId] = base;
    } else if (collection.id === THEME_COLLECTION_ID && ext?.themes) {
      raw = { light: base, dark: ext.themes.dark };
    } else if (collection.id === THEME_COLLECTION_ID) {
      raw = { light: base, dark: base };
    } else {
      raw = { [collection.defaultModeId]: base };
    }

    const variable: Variable = {
      id: c.id ?? generateVariableId(),
      name: ext?.name ?? nameFromSegments(c.segments, "variable"),
      type,
      collectionId: collection.id,
      valuesByMode: {},
      value: "",
    };
    const description = c.token.$description;
    if (description) variable.description = description;
    if (ext?.scopes) variable.scopes = ext.scopes;
    result.variables.push(variable);
    rawByVar.set(variable.id, raw);
    pathToVar.set(c.segments.join("."), variable);
  }

  // Pass 2: literals first, then aliases one by one (cycle and type checked against what is already linked).
  const aliasPath = (value: unknown): string | undefined =>
    typeof value === "string" ? ALIAS_RE.exec(value)?.[1] : undefined;
  for (const variable of result.variables) {
    for (const [modeId, value] of Object.entries(rawByVar.get(variable.id) ?? {})) {
      if (aliasPath(value) === undefined) variable.valuesByMode![modeId] = String(value);
    }
  }
  const index = buildVariableIndex(result.variables, result.collections);
  for (const variable of result.variables) {
    for (const [modeId, value] of Object.entries(rawByVar.get(variable.id) ?? {})) {
      const path = aliasPath(value);
      if (path === undefined) continue;
      const target = pathToVar.get(path);
      let entry: VariableModeValue = TYPE_DEFAULTS[variable.type];
      if (!target) {
        warnings.push(`Variable "${variable.name}" references unknown alias ${value}; used a default value.`);
      } else {
        const problem = aliasEdgeProblem(index, variable.id, variable.type, target.id);
        if (problem === "type") warnings.push(`Variable "${variable.name}" aliases ${value} of a different type; used a default value.`);
        else if (problem !== null) warnings.push(`Variable "${variable.name}" aliasing ${value} would form a cycle; used a default value.`);
        else entry = { alias: target.id };
      }
      variable.valuesByMode![modeId] = entry;
    }
  }
  // Pass 2b: deprecation (replacedBy is a "{path}"), mirrors.
  for (const c of collected) {
    const ext = readPenExt(c.token);
    if (c.source !== "variable" || !ext?.deprecated) continue;
    const variable = pathToVar.get(c.segments.join("."));
    if (!variable) continue;
    const { replacedBy, ...rest } = ext.deprecated;
    variable.deprecated = { ...rest };
    const target = replacedBy === undefined ? undefined : pathToVar.get(aliasPath(replacedBy) ?? "");
    if (target) variable.deprecated.replacedBy = target.id;
    else if (replacedBy !== undefined) warnings.push(`Variable "${variable.name}" is replaced by unknown ${replacedBy}.`);
  }
  result.variables = finalizeVariables(result.variables, result.collections);
  const finalIndex = buildVariableIndex(result.variables, result.collections);
  for (const [path, v] of pathToVar) {
    const fresh = finalIndex.byId.get(v.id);
    if (fresh) pathToVar.set(path, fresh);
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
          const color = resolved ? resolveVariable(finalIndex, resolved.id, {}) : undefined;
          if (resolved && color?.ok) {
            paint.colorBinding = { variableId: resolved.id };
            paint.color = color.value;
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
