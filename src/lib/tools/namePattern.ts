/**
 * Compiles the caller-supplied `name` regex used by `batch_get`'s search
 * patterns, refusing shapes that can hang the tab.
 *
 * The hazard is catastrophic backtracking. `batch_get` compiles whatever
 * string the caller sends and tests it against every node name, synchronously
 * on the main thread. Nothing downstream can save it: the 30-second race in
 * `executeToolCall` cannot preempt synchronous work, and `batch_get` is
 * deliberately not on the serial queue, so a single `(a+)+$` freezes the
 * editor for the user, not just the caller. Reachable from chat, both MCP
 * bridges and the WebMCP surface.
 *
 * Two honest limitations, stated rather than papered over:
 *
 * 1. **The nested-quantifier check is a heuristic, not a decision
 *    procedure.** Recognising every catastrophic pattern is not something a
 *    few lines of code can do; a linear-time engine (RE2 and friends) is the
 *    real answer, and is more bundle weight than this one tool justifies
 *    today. This rejects the classic exponential shapes — a quantifier
 *    applied to a group that itself ends in a quantifier — and will miss
 *    exotic ones.
 * 2. **It is tuned to false-negative, not false-positive.** This code is
 *    shared with the chat agent, whose searches are ordinary layer-name
 *    regexes (`^Button`, `Card \d+`, `icon-.*`). Wrongly rejecting one would
 *    break the design agent's search for a user with no idea why, which is a
 *    worse everyday outcome than missing an exotic hang. So the rule stays
 *    narrow on purpose.
 */

/** Long patterns are not the hazard, but nothing legitimate needs more. */
export const MAX_NAME_PATTERN_LENGTH = 200;

/**
 * A quantifier (`*`, `+`, `{n,}`) applied to a group whose own body ends in a
 * quantifier — `(a+)+`, `(a*)*`, `(\d+)+`, `(a+){2,}`. This is the shape
 * behind essentially every catastrophic-backtracking report in the wild.
 */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[*+}](?:[^()\\]|\\.)*\)\s*(?:[*+]|\{\d+,\s*\d*\})/;

export type NamePatternResult =
  | { ok: true; regex: RegExp }
  | { ok: false; error: string };

// Compiling once per call instead of once per node also removes a needless
// per-node allocation in the search loop.
const cache = new Map<string, NamePatternResult>();

export function compileNamePattern(pattern: string): NamePatternResult {
  const cached = cache.get(pattern);
  if (cached) return cached;

  const result = compile(pattern);
  // Bounded so a caller cannot grow the cache without limit by sending an
  // endless stream of distinct patterns.
  if (cache.size > 500) cache.clear();
  cache.set(pattern, result);
  return result;
}

function compile(pattern: string): NamePatternResult {
  if (pattern.length > MAX_NAME_PATTERN_LENGTH) {
    return {
      ok: false,
      error: `Search pattern is longer than ${MAX_NAME_PATTERN_LENGTH} characters.`,
    };
  }
  if (NESTED_QUANTIFIER.test(pattern)) {
    return {
      ok: false,
      error:
        "Search pattern nests a quantifier inside a quantified group (e.g. `(a+)+`), which can hang the editor. Rewrite it without the nested repeat.",
    };
  }
  try {
    return { ok: true, regex: new RegExp(pattern, "i") };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid search pattern: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Test seam — the cache is module state and would leak between tests. */
export function clearNamePatternCacheForTests(): void {
  cache.clear();
}
