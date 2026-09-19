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
 * `htmlContent`; see CLAUDE.md's "batch_design" section) and never looks
 * past `htmlContent:`'s key for a given header.
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

export interface PendingScreenHeader {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
 * A header is only included once all four numeric fields and the name have
 * fully arrived (see `matchNumberField`/`matchStringField`); the screen
 * currently being typed is simply absent from the result, never returned
 * in a partial form.
 */
export function parsePendingScreenHeaders(operations: string): PendingScreenHeader[] {
  try {
    return parsePendingScreenHeadersUnsafe(operations);
  } catch {
    // Never throw: a malformed or still-shifting partial string is the
    // normal case mid-stream, not a bug to surface.
    return [];
  }
}

function parsePendingScreenHeadersUnsafe(operations: string): PendingScreenHeader[] {
  const headers: PendingScreenHeader[] = [];
  const starts: number[] = [];

  HEADER_START_RE.lastIndex = 0;
  let startMatch: RegExpExecArray | null;
  while ((startMatch = HEADER_START_RE.exec(operations)) !== null) {
    starts.push(startMatch.index + startMatch[0].length);
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

    headers.push({ name, x, y, width, height });
  }

  return headers;
}
