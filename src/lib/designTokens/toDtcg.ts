// src/lib/designTokens/toDtcg.ts
import type { Variable } from "@/types/variable";
import type { FillStyle, EffectStyle } from "@/types/style";
import type { TextStyle } from "@/types/textStyle";
import type { ShadowEffect } from "@/types/scene";
import type { DtcgDocument, DtcgToken, PenTokenExtension } from "./dtcgTypes";
import { nameToSegments, segmentsToAlias, setTokenAtPath } from "./tokenPath";

export interface ExportInput {
  variables: Variable[];
  fillStyles: FillStyle[];
  effectStyles: EffectStyle[];
  textStyles: TextStyle[];
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
      token = { $type: "number", $value: Number(v.value), $extensions: { "com.peneditor": ext } };
    } else {
      warnings.push(`Variable "${v.name}" is a string — DTCG has no string type; emitted without $type.`);
      token = { $value: v.value, $extensions: { "com.peneditor": ext } };
    }
    setTokenAtPath(document, nameToSegments(v.name), token);
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
      token = { $type: "color", $value: value, $extensions: { "com.peneditor": ext } };
    } else if (paint.type === "gradient") {
      const g = paint.gradient;
      ext.gradient = {
        type: g.type, startX: g.startX, startY: g.startY, endX: g.endX, endY: g.endY,
        startRadius: g.startRadius, endRadius: g.endRadius,
      };
      token = {
        $type: "gradient",
        $value: g.stops.map((s) => ({ color: s.color, position: s.position })),
        $extensions: { "com.peneditor": ext },
      };
    } else {
      warnings.push(`Fill style "${fs.name}" is a ${paint.type} fill — no DTCG equivalent; skipped.`);
    }
    if (token) setTokenAtPath(document, ["fill", ...nameToSegments(fs.name)], token);
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
    setTokenAtPath(document, ["effect", ...nameToSegments(es.name)], token);
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
    setTokenAtPath(document, ["text", ...nameToSegments(ts.name)], token);
  }

  return { document, warnings };
}
