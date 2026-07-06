import { TEXT_STYLE_PROPERTY_KEYS } from "@/types/textStyle";
import type { TextStyleProperties } from "@/types/textStyle";

/**
 * Merge a text style's typography properties down onto a node, skipping any
 * property the node has locally overridden (detached from the style for that
 * one field). Used both to apply a style to a node and to push a centralized
 * style edit out to every bound node.
 */
export function resolveTextStyleProperties(
  style: TextStyleProperties,
  overrideKeys: readonly string[] = [],
): Partial<TextStyleProperties> {
  const result: Partial<TextStyleProperties> = {};
  for (const key of TEXT_STYLE_PROPERTY_KEYS) {
    if (overrideKeys.includes(key)) continue;
    const value = style[key];
    if (value !== undefined) {
      (result[key] as unknown) = value;
    }
  }
  return result;
}
