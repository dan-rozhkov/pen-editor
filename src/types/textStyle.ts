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
