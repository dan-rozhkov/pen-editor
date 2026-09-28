/**
 * Best-effort extraction of `batch_design` embed headers from a still-
 * streaming `operations` string — used to draw a dashed placeholder box for
 * a screen whose `x`/`y`/`width`/`height` have arrived but whose (much
 * larger) `htmlContent` has not finished streaming yet.
 *
 * This is deliberately NOT built on top of `parser.ts`'s statement-level
 * completeness (`parseCompleteOperationsPrefix`): that boundary only trusts
 * a statement once its top-level `\n` has arrived, which for a screen is
 * exactly when `htmlContent` — the thing this feature exists to wait out —
 * has also finished. A pending screen's header sits INSIDE an incomplete
 * statement, so this module does its own narrow, single-purpose scan of the
 * prescribed key order (`type`, `name`, `x`, `y`, `width`, `height`, then
 * `htmlContent`; see CLAUDE.md's "batch_design" section). The geometry scan
 * never looks past `htmlContent:`'s key; the html VALUE itself is decoded
 * separately (see `decodePartialString`) for the live preview, and is
 * skipped for headers the caller says are already applied or already
 * decoded to completion.
 *
 * The DSL's object literals use bare (unquoted) JS-style keys, e.g.
 * `{type: "embed", name: "Login", x: 0, ...}` — not JSON. Field matching
 * below tolerates an optionally-quoted key so a model that happens to quote
 * a key is still read correctly.
 *
 * Purely additive: nothing here feeds back into what batch_design applies.
 * A parse failure or an unexpected shape must only mean "no placeholder
 * shown" — never a thrown error, and never a wrong box.
 */

import { isLikelyStringEnd } from "@/lib/tools/batchDesign/parser";

export interface PendingScreenHeader {
  /** Source-order index among the embed headers; stable as earlier screens get applied. */
  index: number;
  /** Offset in `operations` where the header's statement (`[bind=]I(`) begins. */
  start: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The `htmlContent` decoded so far (`""` until its opening quote streams
   * in). Best-effort and possibly cut mid-tag — feed it through
   * `repairPartialHtml` before mounting. Only the live preview reads it.
   */
  html: string;
  /** True once the html string literal's closing quote has streamed in. */
  htmlComplete: boolean;
}

function keyPattern(key: string): string {
  // `key`, `"key"`, or `'key'`, followed by a colon. The bare form needs a
  // `\b` on both sides — without it, `x` would match the tail of `max` (the
  // substring "x:" inside "max:") or a similar longer identifier.
  return `(?:"${key}"|'${key}'|\\b${key}\\b)\\s*:`;
}

// Matches a `key: <number>` field, where the value is only trusted once
// followed by a delimiter (`,`, `}`, or trailing whitespace before one of
// those) — a bare `x: 12` at the very end of the string might still grow
// into `120`, so an unterminated number must not be reported.
function matchNumberField(source: string, key: string): number | null {
  const re = new RegExp(`${keyPattern(key)}\\s*(-?\\d+(?:\\.\\d+)?)\\s*(?=[,}])`);
  const m = re.exec(source);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

// Matches a `key: "<string>"` field. Requires the closing quote to be
// present (i.e. the string value is fully streamed) so a half-typed value
// isn't reported and then silently changes shape next frame.
function matchStringField(source: string, key: string): string | null {
  const re = new RegExp(`${keyPattern(key)}\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = re.exec(source);
  return m ? m[1] : null;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
};

/**
 * Decode the string literal starting right after `htmlContent:` in `source`
 * (whitespace, then a `"`/`'`/backtick delimiter) up to its closing quote or
 * the end of the text. Escapes are decoded best-effort; an incomplete escape
 * at the tail is dropped (it completes next frame). The closing quote uses
 * the same lookahead as the real parser, so unescaped inner quotes
 * (`class="card"` in a `"`-delimited string) stay content.
 */
function decodePartialString(source: string, from: number): { value: string; complete: boolean } {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i++;
  const delimiter = source[i];
  if (delimiter !== '"' && delimiter !== "'" && delimiter !== "`") return { value: "", complete: false };
  i++;

  // Collect verbatim slices between escapes instead of appending per char.
  const parts: string[] = [];
  let complete = false;
  let sliceStart = i;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      if (i + 1 >= source.length) break;
      parts.push(source.slice(sliceStart, i));
      const next = source[i + 1];
      if (next === "u") {
        const hex = source.slice(i + 2, i + 6);
        if (hex.length < 4) {
          // Incomplete escape at the tail: dropped, completes next frame.
          return { value: parts.join(""), complete: false };
        }
        parts.push(/^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : "u" + hex);
        i += 6;
      } else {
        parts.push(SIMPLE_ESCAPES[next] ?? next);
        i += 2;
      }
      sliceStart = i;
      continue;
    }
    if (ch === delimiter && isLikelyStringEnd(source, i)) {
      // A quote at the very end of the text is "likely the end" only for
      // want of a next character; more input can still show it was inner
      // content. Report closed only once a real follower confirmed it.
      complete = /\S/.test(source.slice(i + 1, i + 64));
      break;
    }
    i++;
  }
  parts.push(source.slice(sliceStart, i));
  return { value: parts.join(""), complete };
}

const HEADER_START_RE = /(?:\w+\s*=\s*)?I\s*\(\s*document\s*,\s*\{/g;
const HTML_CONTENT_KEY_RE = /(?:"htmlContent"|'htmlContent'|htmlContent)\s*:/;

/**
 * Find every `I(document, {...})`-shaped header naming `type: "embed"` in
 * `operations`, in source order. Each header's field scan window stops
 * strictly before that header's own `htmlContent:` key (if present) and
 * before the next header's start — so nothing inside one screen's HTML
 * (which routinely contains CSS `width:`/`height:` declarations) is ever
 * mistaken for another screen's fields, or its own.
 *
 * `options.decodeFromOffset`: html is only decoded for headers whose statement
 * starts at/after this offset (the syntactically-complete boundary — earlier
 * ones are already real nodes and get `html: ""`).
 * `options.completedHtml`: html already decoded to completion on a previous
 * frame, by header index; those headers reuse it instead of re-decoding.
 *
 * A header is only included once all four numeric fields and the name have
 * fully arrived (see `matchNumberField`/`matchStringField`); the screen
 * currently being typed is simply absent from the result, never returned
 * in a partial form.
 */
export interface ParseOptions {
  decodeFromOffset?: number;
  completedHtml?: ReadonlyMap<number, string>;
}

export function parsePendingScreenHeaders(
  operations: string,
  options: ParseOptions = {},
): PendingScreenHeader[] {
  try {
    return parsePendingScreenHeadersUnsafe(operations, options);
  } catch {
    // Never throw: a malformed or still-shifting partial string is the
    // normal case mid-stream, not a bug to surface.
    return [];
  }
}

function parsePendingScreenHeadersUnsafe(
  operations: string,
  options: ParseOptions,
): PendingScreenHeader[] {
  const decodeFromOffset = options.decodeFromOffset ?? 0;
  const headers: PendingScreenHeader[] = [];
  const starts: number[] = [];
  const stmtStarts: number[] = [];

  HEADER_START_RE.lastIndex = 0;
  let startMatch: RegExpExecArray | null;
  while ((startMatch = HEADER_START_RE.exec(operations)) !== null) {
    starts.push(startMatch.index + startMatch[0].length);
    stmtStarts.push(startMatch.index);
    // Guard against a zero-width match looping forever; the pattern always
    // consumes at least "I(document,{" so this never actually triggers, but
    // costs nothing to keep.
    if (startMatch[0].length === 0) HEADER_START_RE.lastIndex++;
  }

  for (let i = 0; i < starts.length; i++) {
    const bodyStart = starts[i];
    const nextHeaderIdx = i + 1 < starts.length ? starts[i + 1] : operations.length;

    const htmlContentMatch = HTML_CONTENT_KEY_RE.exec(operations.slice(bodyStart, nextHeaderIdx));
    const windowEnd =
      htmlContentMatch !== null ? bodyStart + htmlContentMatch.index : nextHeaderIdx;

    const window = operations.slice(bodyStart, windowEnd);

    const type = matchStringField(window, "type");
    if (type !== "embed") continue;

    const name = matchStringField(window, "name");
    const x = matchNumberField(window, "x");
    const y = matchNumberField(window, "y");
    const width = matchNumberField(window, "width");
    const height = matchNumberField(window, "height");

    if (name === null || x === null || y === null || width === null || height === null) {
      continue;
    }

    const start = stmtStarts[i];
    const index = headers.length;
    let html = "";
    let htmlComplete = false;
    if (htmlContentMatch !== null && start >= decodeFromOffset) {
      const cachedHtml = options.completedHtml?.get(index);
      if (cachedHtml !== undefined) {
        html = cachedHtml;
        htmlComplete = true;
      } else {
        const decoded = decodePartialString(
          operations,
          bodyStart + htmlContentMatch.index + htmlContentMatch[0].length,
        );
        html = decoded.value;
        htmlComplete = decoded.complete;
      }
    }
    headers.push({ index, start, name, x, y, width, height, html, htmlComplete });
  }

  return headers;
}
