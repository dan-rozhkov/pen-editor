// src/lib/designTokens/toDtcg.ts
import type { Variable } from "@/types/variable";
import type { FillStyle, EffectStyle } from "@/types/style";
import type { TextStyle } from "@/types/textStyle";
import type { ShadowEffect, SolidPaint, GradientPaint } from "@/types/scene";
import type { DtcgDocument, DtcgToken, PenTokenExtension } from "./dtcgTypes";
import { nameToSegments, segmentsToAlias, setTokenAtPath } from "./tokenPath";

export interface ExportInput {
  variables: Variable[];
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

export function toDtcg(input: ExportInput): { document: DtcgDocument; warnings: string[] } {
  const document: DtcgDocument = {};
  const warnings: string[] = [];

  // variableId → its root path, for alias resolution of bound fills.
  const varPath = new Map<string, string[]>();
  for (const v of input.variables) varPath.set(v.id, nameToSegments(v.name));

  // --- Variables (root) ---
  for (const v of input.variables) {
    const ext: PenTokenExtension = { id: v.id, source: "variable" };
    let token: DtcgToken;
    if (v.type === "color") {
      const light = v.themeValues?.light ?? v.value;
      if (v.themeValues) ext.themes = { dark: v.themeValues.dark };
      token = { $type: "color", $value: light, $extensions: { "com.peneditor": ext } };
    } else if (v.type === "number") {
      const n = Number(v.value);
      if (Number.isFinite(n)) {
        token = { $type: "number", $value: n, $extensions: { "com.peneditor": ext } };
      } else {
        warnings.push(`Variable "${v.name}" has a non-numeric value "${v.value}"; emitted as a string.`);
        token = { $value: v.value, $extensions: { "com.peneditor": ext } };
      }
    } else {
      warnings.push(`Variable "${v.name}" is a string — DTCG has no string type; emitted without $type.`);
      token = { $value: v.value, $extensions: { "com.peneditor": ext } };
    }
    if (!setTokenAtPath(document, nameToSegments(v.name), token)) {
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
      warnings.push(`Effect style "${es.name}" has ${skipped} blur effect(s) — no DTCG equivalent; skipped.`);
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
