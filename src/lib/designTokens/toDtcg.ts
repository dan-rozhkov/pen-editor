// src/lib/designTokens/toDtcg.ts
import type { Variable, VariableCollection, VariableModeValue } from "@/types/variable";
import { THEME_COLLECTION_ID } from "@/types/variable";
import { buildVariableIndex, collectionIdOf, modeValuesOf, resolveVariable } from "@/lib/variables";
import type { FillStyle, EffectStyle } from "@/types/style";
import type { TextStyle } from "@/types/textStyle";
import type { ShadowEffect, SolidPaint, GradientPaint } from "@/types/scene";
import type { DtcgDocument, DtcgToken, PenTokenExtension } from "./dtcgTypes";
import { nameToSegments, segmentsToAlias, setTokenAtPath } from "./tokenPath";

export interface ExportInput {
  variables: Variable[];
  /** Omit for a legacy document: only the Theme collection (light/dark) exists then. */
  collections?: VariableCollection[];
  fillStyles: FillStyle[];
  effectStyles: EffectStyle[];
  textStyles: TextStyle[];
}

/** Collect the defined PaintBase extras (opacity/visible/blendMode); `undefined` if none are set. */
function buildPaintExt(paint: SolidPaint | GradientPaint): PenTokenExtension["paint"] | undefined {
  const out: NonNullable<PenTokenExtension["paint"]> = {};
  if (paint.opacity !== undefined) out.opacity = paint.opacity;
  if (paint.visible !== undefined) out.visible = paint.visible;
  if (paint.blendMode !== undefined) out.blendMode = paint.blendMode;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The built-in Theme collection exactly as `makeThemeCollection` creates it (or an equal one). */
function isStandardTheme(c: VariableCollection): boolean {
  return (
    c.id === THEME_COLLECTION_ID &&
    c.defaultModeId === "light" &&
    c.modes.length === 2 &&
    c.modes[0].id === "light" &&
    c.modes[1].id === "dark" &&
    c.name === "Theme"
  );
}

export function toDtcg(input: ExportInput): { document: DtcgDocument; warnings: string[] } {
  const document: DtcgDocument = {};
  const warnings: string[] = [];

  const index = buildVariableIndex(input.variables, input.collections);

  // variableId → its root path (alias targets, bound fills). A name used by
  // variables of two collections gets the later collection's name prefixed.
  const varPath = new Map<string, string[]>();
  const prefixed = new Set<string>();
  const nameOwner = new Map<string, string>();
  for (const v of input.variables) {
    let segs = nameToSegments(v.name);
    const key = segs.join(".");
    const cid = collectionIdOf(v);
    const owner = nameOwner.get(key);
    if (owner === undefined) nameOwner.set(key, cid);
    else if (owner !== cid) {
      const cname = index.collections.get(cid)?.name ?? cid;
      segs = [...nameToSegments(cname), ...segs];
      prefixed.add(v.id);
      warnings.push(`Variable "${v.name}" exists in several collections; exported as "${segs.join("/")}".`);
    }
    varPath.set(v.id, segs);
  }

  const pathOf = (id: string): string | undefined => {
    const segs = varPath.get(id);
    return segs ? segmentsToAlias(segs) : undefined;
  };

  // --- Variables (root) ---
  for (const v of input.variables) {
    const cid = collectionIdOf(v);
    const coll = index.collections.get(cid);
    const values = modeValuesOf(v);
    const defaultId = coll?.defaultModeId ?? Object.keys(values)[0];
    const standardTheme = coll !== undefined && isStandardTheme(coll);

    const ext: PenTokenExtension = { id: v.id, source: "variable" };
    const literal = (raw: string): string | number => {
      if (v.type !== "number") return raw;
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    };
    const emit = (entry: VariableModeValue): string | number => {
      if (typeof entry === "string") return literal(entry);
      const alias = pathOf(entry.alias);
      if (alias) return alias;
      warnings.push(`Variable "${v.name}" aliases a deleted variable; wrote its resolved value.`);
      return literal(v.value);
    };
    const defaultEntry = values[defaultId] ?? Object.values(values)[0] ?? v.value;
    const $value = emit(defaultEntry);

    if (coll && !standardTheme) {
      ext.collection = { id: coll.id, name: coll.name, modes: coll.modes, defaultModeId: coll.defaultModeId };
    }
    if (prefixed.has(v.id)) ext.name = v.name;

    const entries = Object.entries(values);
    if (standardTheme) {
      // Dual-write: older importers read `themes.dark`; `modes` only carries what it cannot (aliases, non-color).
      const dark = values.dark;
      const darkResolved = resolveVariable(index, v.id, "dark");
      const lightResolved = resolveVariable(index, v.id, "light");
      const hasAlias = entries.some(([, e]) => typeof e !== "string");
      const differs = typeof dark === "string" && dark !== values.light;
      if (v.type === "color" && darkResolved.ok && lightResolved.ok && darkResolved.value !== lightResolved.value) {
        ext.themes = { dark: darkResolved.value };
      }
      if (hasAlias || (v.type !== "color" && differs)) {
        ext.modes = Object.fromEntries(entries.map(([m, e]) => [m, emit(e)]));
      }
    } else if (coll && coll.modes.length > 1) {
      ext.modes = Object.fromEntries(entries.map(([m, e]) => [m, emit(e)]));
    }
    if (v.scopes?.length) ext.scopes = v.scopes;
    if (v.deprecated) {
      const { replacedBy, ...rest } = v.deprecated;
      ext.deprecated = { ...rest };
      if (replacedBy !== undefined) {
        const alias = pathOf(replacedBy);
        if (alias) ext.deprecated.replacedBy = alias;
      }
    }

    const extensions = { "com.peneditor": ext };
    let token: DtcgToken;
    if (v.type === "color") {
      token = { $type: "color", $value, $extensions: extensions };
    } else if (v.type === "number") {
      if (typeof $value === "number" || (typeof $value === "string" && $value.startsWith("{"))) {
        token = { $type: "number", $value, $extensions: extensions };
      } else {
        warnings.push(`Variable "${v.name}" has a non-numeric value "${v.value}"; emitted as a string.`);
        token = { $value, $extensions: extensions };
      }
    } else {
      warnings.push(`Variable "${v.name}" is a string — DTCG has no string type; emitted without $type.`);
      token = { $value, $extensions: extensions };
    }
    if (v.description) token.$description = v.description;
    if (!setTokenAtPath(document, varPath.get(v.id) as string[], token)) {
      warnings.push(`Token name "${v.name}" collides with another token; previous value was overwritten.`);
    }
  }

  // --- Fill styles (under "fill") ---
  for (const fs of input.fillStyles) {
    const paint = fs.paint;
    const ext: PenTokenExtension = { id: fs.id, source: "fillStyle" };
    let token: DtcgToken | null = null;
    if (paint.type === "solid") {
      let value: string = paint.color;
      if (paint.colorBinding) {
        const segs = varPath.get(paint.colorBinding.variableId);
        if (segs) value = segmentsToAlias(segs);
        else warnings.push(`Fill style "${fs.name}" binds a deleted variable; wrote literal color.`);
      }
      const paintExt = buildPaintExt(paint);
      if (paintExt) ext.paint = paintExt;
      token = { $type: "color", $value: value, $extensions: { "com.peneditor": ext } };
    } else if (paint.type === "gradient") {
      const g = paint.gradient;
      ext.gradient = {
        type: g.type, startX: g.startX, startY: g.startY, endX: g.endX, endY: g.endY,
        startRadius: g.startRadius, endRadius: g.endRadius,
      };
      const paintExt = buildPaintExt(paint);
      if (paintExt) ext.paint = paintExt;
      token = {
        $type: "gradient",
        $value: g.stops.map((s) =>
          s.opacity !== undefined
            ? { color: s.color, position: s.position, opacity: s.opacity }
            : { color: s.color, position: s.position },
        ),
        $extensions: { "com.peneditor": ext },
      };
    } else {
      warnings.push(`Fill style "${fs.name}" is a ${paint.type} fill — no DTCG equivalent; skipped.`);
    }
    if (token && !setTokenAtPath(document, ["fill", ...nameToSegments(fs.name)], token)) {
      warnings.push(`Token name "${fs.name}" collides with another token; previous value was overwritten.`);
    }
  }

  // --- Effect styles (under "effect") ---
  for (const es of input.effectStyles) {
    const shadows = es.effects.filter((e): e is ShadowEffect => e.type === "shadow");
    const skipped = es.effects.length - shadows.length;
    if (skipped > 0) {
      warnings.push(`Effect style "${es.name}" has ${skipped} non-shadow effect(s) — no DTCG equivalent; skipped.`);
    }
    if (shadows.length === 0) {
      if (es.effects.length > 0) warnings.push(`Effect style "${es.name}" has no shadows; skipped entirely.`);
      continue;
    }
    const mapped = shadows.map((s) => ({
      color: s.color, offsetX: s.offset.x, offsetY: s.offset.y,
      blur: s.blur, spread: s.spread, inset: s.shadowType === "inner",
    }));
    const token: DtcgToken = {
      $type: "shadow",
      $value: mapped.length === 1 ? mapped[0] : mapped,
      $extensions: { "com.peneditor": { id: es.id, source: "effectStyle" } },
    };
    if (!setTokenAtPath(document, ["effect", ...nameToSegments(es.name)], token)) {
      warnings.push(`Token name "${es.name}" collides with another token; previous value was overwritten.`);
    }
  }

  // --- Text styles (under "text") ---
  for (const ts of input.textStyles) {
    const value: Record<string, unknown> = {};
    if (ts.fontFamily !== undefined) value.fontFamily = ts.fontFamily;
    if (ts.fontSize !== undefined) value.fontSize = ts.fontSize;
    if (ts.fontWeight !== undefined) value.fontWeight = ts.fontWeight;
    if (ts.lineHeight !== undefined) value.lineHeight = ts.lineHeight;
    if (ts.letterSpacing !== undefined) value.letterSpacing = ts.letterSpacing;
    const ext: PenTokenExtension = { id: ts.id, source: "textStyle" };
    if (ts.textTransform !== undefined) ext.textTransform = ts.textTransform;
    if (ts.fontVariations !== undefined) ext.fontVariations = ts.fontVariations;
    if (ts.fontFeatures !== undefined) ext.fontFeatures = ts.fontFeatures;
    const token: DtcgToken = { $type: "typography", $value: value, $extensions: { "com.peneditor": ext } };
    if (!setTokenAtPath(document, ["text", ...nameToSegments(ts.name)], token)) {
      warnings.push(`Token name "${ts.name}" collides with another token; previous value was overwritten.`);
    }
  }

  return { document, warnings };
}
