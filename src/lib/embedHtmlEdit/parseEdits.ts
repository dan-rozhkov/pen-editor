/**
 * Coerce a `batch_design`/`edit_embed_html`-style tool-args value into
 * `AnchorEdit[]`, shared by the final (strict) handler and the progressive
 * (streaming) preview.
 */

import type { AnchorEdit } from "./applyAnchorEdits";

export interface ParseAnchorEditsOptions {
  /**
   * Best-effort mode for progressive (streaming) application: a malformed
   * item is SKIPPED instead of invalidating the whole array, and an
   * `oldString` that is still empty (a truncated mid-stream anchor, not yet
   * distinguishable from a genuinely empty one) is skipped too. The final,
   * non-lenient pass still enforces every rule below — the caller always
   * re-derives from the original HTML on the next frame, so a lenient result
   * is a throwaway intermediate, never the authoritative one. Off by default
   * so the strict (non-streaming) caller is byte-identical.
   */
  lenient?: boolean;
}

/** Parse the tool's `edits` argument into `AnchorEdit[]`, or null when unusable. */
export function parseAnchorEditsInput(
  raw: unknown,
  options: ParseAnchorEditsOptions = {},
): AnchorEdit[] | null {
  const { lenient = false } = options;

  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;

  const edits: AnchorEdit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      if (lenient) continue;
      return null;
    }
    const { oldString, newString, replaceAll } = item as Record<string, unknown>;
    if (typeof oldString !== "string" || typeof newString !== "string") {
      if (lenient) continue;
      return null;
    }
    // A truncated `newString` mid-stream is still a string (just an
    // incomplete one), so this can't tell "short" from "truncated" — only
    // meaningful in lenient mode, where re-deriving every frame makes it safe.
    if (lenient && oldString.length === 0) continue;
    edits.push({
      oldString,
      newString,
      ...(replaceAll === true ? { replaceAll: true } : {}),
    });
  }
  return edits;
}
