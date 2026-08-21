/**
 * Anchor-based text edits for embed HTML: each edit replaces an exact
 * substring.
 *
 * Matching is two-stage:
 *  1. Exact byte match, tried first and always preferred when it exists.
 *  2. Only if the exact match finds ZERO occurrences, retry with a
 *     whitespace-normalized comparison (runs of whitespace collapsed to a
 *     single space on both sides) to absorb the model reproducing an anchor
 *     with different indentation or line breaks than the stored HTML — the
 *     single most common cause of a failed edit. The normalized match is
 *     applied ONLY when it is unambiguous (exactly one match); splicing
 *     still uses the real offsets into the untouched original string, so
 *     surrounding bytes are never rewritten.
 *
 * Ambiguity is never resolved by guessing, on either path: a "smart" match
 * that silently hits a neighbouring lookalike block is far more expensive
 * than a failed edit, so 0 or 2+ normalized matches still throw.
 *
 * After all edits are applied, the result's HTML tag balance is checked
 * against the original's (see tagBalance.ts). The check is differential —
 * only a WELL-FORMED input that comes out unbalanced is refused, atomically,
 * before anything reaches the caller. A screen that was already malformed
 * stays editable; otherwise the tool would become unusable on exactly the
 * screens that most need fixing.
 */

import { checkTagBalance } from "./tagBalance";

export interface AnchorEdit {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface AnchorEditResult {
  html: string;
  replacements: number;
  /** Number of edits that only matched after whitespace normalization. */
  normalizedMatches: number;
}

export class AnchorEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorEditError";
  }
}

const CONTEXT_CHARS = 40;
const MAX_REPORTED_CONTEXTS = 3;
// Below this many characters a matching prefix is too generic to be a useful
// near-miss hint (e.g. every tag starts with "<div" — that's noise, not a clue).
const MIN_NEAR_MISS_PREFIX = 8;

function countOccurrences(haystack: string, needle: string): number {
  // An empty needle would match at every position without advancing `from`.
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return count;
    count += 1;
    from = index + needle.length;
  }
}

/** Up to three "…text…" windows around the first occurrences, for error messages. */
function occurrenceContexts(haystack: string, needle: string): string[] {
  const contexts: string[] = [];
  let from = 0;
  while (contexts.length < MAX_REPORTED_CONTEXTS) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    const start = Math.max(0, index - CONTEXT_CHARS);
    const end = Math.min(haystack.length, index + needle.length + CONTEXT_CHARS);
    contexts.push(`…${haystack.slice(start, end)}…`);
    from = index + needle.length;
  }
  return contexts;
}

/** "…text…" windows around a fixed index (used for near-miss/tag-balance reporting). */
function contextAround(haystack: string, index: number, length: number): string {
  const start = Math.max(0, index - CONTEXT_CHARS);
  const end = Math.min(haystack.length, index + length + CONTEXT_CHARS);
  return `…${haystack.slice(start, end)}…`;
}

interface NormalizedMap {
  norm: string;
  /** Start index in the original string for each char of `norm`. */
  starts: number[];
  /** End index (exclusive) in the original string for each char of `norm`. */
  ends: number[];
}

/** Collapses runs of whitespace to a single space, keeping a map back to original offsets. */
function normalizeWithMap(s: string): NormalizedMap {
  const starts: number[] = [];
  const ends: number[] = [];
  let norm = "";
  let i = 0;
  const len = s.length;
  while (i < len) {
    if (/\s/.test(s[i])) {
      let j = i + 1;
      while (j < len && /\s/.test(s[j])) j += 1;
      norm += " ";
      starts.push(i);
      ends.push(j);
      i = j;
    } else {
      norm += s[i];
      starts.push(i);
      ends.push(i + 1);
      i += 1;
    }
  }
  return { norm, starts, ends };
}

interface NormalizedMatch {
  start: number;
  end: number;
}

/** All whitespace-normalized matches of `needle` in `haystack`, mapped back to real offsets. */
function findNormalizedMatches(haystack: string, needle: string): NormalizedMatch[] {
  const needleNorm = normalizeWithMap(needle).norm;
  if (needleNorm.length === 0) return [];
  const { norm, starts, ends } = normalizeWithMap(haystack);
  const matches: NormalizedMatch[] = [];
  let from = 0;
  for (;;) {
    const index = norm.indexOf(needleNorm, from);
    if (index === -1) return matches;
    matches.push({ start: starts[index], end: ends[index + needleNorm.length - 1] });
    from = index + needleNorm.length;
  }
}

/**
 * Up to three "…text…" windows around the longest prefix of `needle` that
 * does occur in `haystack` — a hint when even normalized matching fails.
 * Returns [] rather than noise when no reasonably long prefix matches.
 */
function nearMissContexts(haystack: string, needle: string): string[] {
  for (let len = needle.length - 1; len >= MIN_NEAR_MISS_PREFIX; len -= 1) {
    const prefix = needle.slice(0, len);
    if (haystack.includes(prefix)) {
      return occurrenceContexts(haystack, prefix);
    }
  }
  return [];
}

function spliceAll(source: string, matches: NormalizedMatch[], newString: string): string {
  // Apply back-to-front so earlier offsets stay valid as later ones are spliced.
  let result = source;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const { start, end } = matches[i];
    result = result.slice(0, start) + newString + result.slice(end);
  }
  return result;
}

export function applyAnchorEdits(html: string, edits: AnchorEdit[]): AnchorEditResult {
  let current = html;
  let replacements = 0;
  let normalizedMatches = 0;

  const originalBalance = checkTagBalance(html);

  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];
    const label = `Edit ${i + 1}`;
    if (edit.oldString.length === 0) {
      throw new AnchorEditError(`${label}: oldString must not be empty.`);
    }

    const occurrences = countOccurrences(current, edit.oldString);

    if (occurrences === 0) {
      // Exact match failed — retry with whitespace normalized, the dominant
      // real-world cause: the model reproduces the anchor with different
      // indentation/line breaks than the stored HTML.
      const normMatches = findNormalizedMatches(current, edit.oldString);

      if (normMatches.length === 0) {
        const hints = nearMissContexts(current, edit.oldString);
        throw new AnchorEditError(
          `${label}: oldString not found. Nothing was changed. ` +
            `Call read_embed_html with mode "grep" to get the exact text — indentation and line ` +
            `breaks are already tolerated, so this anchor does not exist in the screen at all.` +
            (hints.length > 0
              ? ` Closest text in the document: ${hints.join(" | ")}`
              : ""),
        );
      }

      if (normMatches.length > 1 && !edit.replaceAll) {
        throw new AnchorEditError(
          `${label}: oldString was not found byte-exact, and a whitespace-normalized match is ` +
            `ambiguous (${normMatches.length} occurrences). Nothing was changed. ` +
            `Extend the anchor with surrounding text to make it unique, or pass replaceAll: true.`,
        );
      }

      current = spliceAll(current, normMatches, edit.newString);
      replacements += normMatches.length;
      normalizedMatches += 1;
      continue;
    }

    if (occurrences > 1 && !edit.replaceAll) {
      throw new AnchorEditError(
        `${label}: oldString occurs ${occurrences} times. Nothing was changed. ` +
          `Extend the anchor with surrounding text to make it unique, or pass replaceAll: true. ` +
          `Occurrences: ${occurrenceContexts(current, edit.oldString).join(" | ")}`,
      );
    }

    if (edit.replaceAll) {
      // split/join, not String.replace: `$&`/`$1` in newString are literal text here.
      current = current.split(edit.oldString).join(edit.newString);
      replacements += occurrences;
    } else {
      const index = current.indexOf(edit.oldString);
      current =
        current.slice(0, index) + edit.newString + current.slice(index + edit.oldString.length);
      replacements += 1;
    }
  }

  // Differential check: only refuse when the edit is what broke the balance —
  // a screen that was already malformed before the edit must stay editable.
  if (originalBalance.balanced) {
    const resultBalance = checkTagBalance(current);
    if (!resultBalance.balanced && resultBalance.unclosed) {
      const { tagName, index } = resultBalance.unclosed;
      throw new AnchorEditError(
        `The edit left <${tagName}> unclosed (opened at ${contextAround(current, index, tagName.length + 2)}) ` +
          `— nothing was changed. Include the matching closing tag in the same edit.`,
      );
    }
  }

  return { html: current, replacements, normalizedMatches };
}
