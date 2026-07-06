import type { TextTransform } from "./scene";

/** Typography properties a named text style controls. */
export interface TextStyleProperties {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: TextTransform;
}

/** A named, reusable text style (Figma-style "Text styles"). */
export interface TextStyle extends TextStyleProperties {
  id: string;
  name: string;
}

/** The set of typography property keys a text style governs / a node can locally override. */
export const TEXT_STYLE_PROPERTY_KEYS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textTransform",
] as const;

export type TextStylePropertyKey = (typeof TEXT_STYLE_PROPERTY_KEYS)[number];

export function generateTextStyleId(): string {
  return "textstyle_" + Math.random().toString(36).substring(2, 9);
}

/**
 * Runtime type guards for each text-style property, keyed by
 * `TEXT_STYLE_PROPERTY_KEYS`. The single source of truth for "what shape is
 * this typography field" so callers that need to validate untyped input
 * (tool handlers) don't hand-enumerate a parallel `typeof` check per field
 * that can drift from this list.
 */
const TEXT_STYLE_PROPERTY_VALIDATORS: {
  [K in TextStylePropertyKey]: (value: unknown) => value is NonNullable<TextStyleProperties[K]>;
} = {
  fontFamily: (v): v is string => typeof v === "string",
  fontSize: (v): v is number => typeof v === "number",
  fontWeight: (v): v is string => typeof v === "string",
  lineHeight: (v): v is number => typeof v === "number",
  letterSpacing: (v): v is number => typeof v === "number",
  textTransform: (v): v is TextTransform => typeof v === "string",
};

/**
 * Pick only the recognized, correctly-typed typography fields present on
 * `source` (an untyped object, e.g. raw tool-call input). Keys absent from
 * `source`, or present with the wrong runtime type, are omitted.
 */
export function pickTextStyleProperties(source: Record<string, unknown>): TextStyleProperties {
  const props: TextStyleProperties = {};
  for (const key of TEXT_STYLE_PROPERTY_KEYS) {
    const value = source[key];
    if (value === undefined) continue;
    const validator = TEXT_STYLE_PROPERTY_VALIDATORS[key];
    if (validator(value)) {
      assignTextStyleProperty(props, key, value);
    }
  }
  return props;
}

/** Type-safe `target[key] = value` for a key/value pair drawn from the same `TextStylePropertyKey`. */
export function assignTextStyleProperty<K extends TextStylePropertyKey>(
  target: TextStyleProperties,
  key: K,
  value: TextStyleProperties[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}
