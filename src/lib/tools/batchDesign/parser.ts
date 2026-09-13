import type { OpType, ParsedArg, ParsedOperation } from "./types";
import JSON5 from "json5";

const OP_TYPES = new Set<string>(["I", "C", "U", "R", "M", "D", "G"]);

/**
 * Cap on how many operations from a single batch_design call are actually
 * executed. Scripts longer than this are parsed in full but only the first
 * MAX_OPERATIONS are run — see batchDesign/index.ts, which slices the
 * parsed list and reports a resumption point (remainingOperations/bindings)
 * for the model to continue with in a follow-up call.
 */
export const MAX_OPERATIONS = 25;

/**
 * True for a physical line that contributes nothing to the script: blank,
 * a `//`/`#` comment, or wrapper/fence noise. Shared by `parseOperations`,
 * `parseCompleteOperationsPrefix` and `createCachedOperationsParser` so the
 * three don't drift on what "skip this line" means.
 */
function isSkippableLine(raw: string): boolean {
  return !raw || raw.startsWith("//") || raw.startsWith("#") || isWrapperNoiseLine(raw);
}

/**
 * Parse a batch_design operations script into structured operations.
 * Each line is: [binding=]OP(arg1, arg2, ...)
 */
export function parseOperations(input: string): ParsedOperation[] {
  const { lines } = splitOperationLines(stripWrapperNoiseLines(input));
  const operations: ParsedOperation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].text.trim();
    if (isSkippableLine(raw)) {
      continue;
    }

    const parsed = parseLine(raw, lines[i].line);
    operations.push(parsed);
  }

  if (operations.length === 0) {
    throw new Error("No operations to execute");
  }

  return operations;
}

/**
 * Lines that are pure wrapper/fence noise a model occasionally emits around the
 * operations script. These are skipped like comments so a stray tag doesn't fail
 * the whole batch. A line is noise ONLY if the entire trimmed line is one of these
 * — never a substring inside a real operation.
 */
function isWrapperNoiseLine(raw: string): boolean {
  // Markdown code fences: ``` or ```lang  (also ~~~ )
  if (/^(`{3,}|~{3,})[\w-]*$/.test(raw)) return true;
  // XML-ish wrapper tags for the operations payload, opening or closing:
  //   <operations>, </operations>, <batch_design>, </batch_design>
  if (/^<\/?\s*(operations|batch_design)\s*\/?>$/i.test(raw)) return true;
  return false;
}

/**
 * Blank out physical lines that are pure wrapper/fence noise BEFORE the
 * character-level line splitter runs. This is required for Markdown code fences
 * specifically: splitOperationLines treats a backtick as a string delimiter, so a
 * lone ``` fence would otherwise open a "string" and swallow the real operation on
 * the next line. Noise lines are replaced with an empty line (not removed) so error
 * line numbers stay aligned with the model's original input.
 *
 * Only contiguous noise lines at the TOP and BOTTOM of the input are peeled —
 * wrappers (fences, `<operations>`/`</operations>` tag pairs) only ever appear as
 * the outermost lines of the payload. Interior lines are left untouched so a lone
 * `<script>` or ``` line that legitimately appears inside an htmlContent (or other
 * string value) is never blanked, which would corrupt the generated HTML.
 */
function stripWrapperNoiseLines(input: string): string {
  const lines = input.split("\n");
  let start = 0;
  let end = lines.length - 1;
  // Peel contiguous wrapper/fence noise from the top…
  while (start <= end && isWrapperNoiseLine(lines[start].trim())) {
    lines[start] = "";
    start++;
  }
  // …and from the bottom. Interior lines are left untouched so a `<script>`
  // or ``` line inside an htmlContent string value is never blanked.
  while (end >= start && isWrapperNoiseLine(lines[end].trim())) {
    lines[end] = "";
    end--;
  }
  return lines.join("\n");
}

/**
 * True iff the character at `text[quoteIndex]` (a quote matching the
 * delimiter of the string currently open) is plausibly the TRUE closing
 * delimiter — i.e. the next non-whitespace character is one that can
 * legitimately follow a string value in this DSL's grammar: `,` (next
 * arg/field), `)` (end of op call), `}` (end of object), `]` (end of
 * array), `:` (this was a quoted object key), or end of input.
 *
 * Without this lookahead, the scanner treated the FIRST unescaped
 * occurrence of the delimiter as the close — wrong whenever an
 * `htmlContent`/`name` string embeds HTML written in the same quote style
 * without escaping (`class="card"`), the single most common shape of the
 * model's own output. That silently truncated the string mid-attribute,
 * corrupting brace/paren depth tracking downstream and producing "Invalid
 * JSON"/"Parse error" for batches that were otherwise well-formed. Mirrors
 * the fix already shipped on the backend for the same bug class in
 * pen-editor-backend/src/showcase/extractEmbeds.ts.
 *
 * Known residual gap: `:` is accepted as a terminator (a quoted DSL object
 * key, e.g. `{"type": "embed"}`), but the scanner has no way to tell that
 * apart from an unescaped `"key": value`-shaped fragment sitting INSIDE an
 * HTML string (e.g. inline JSON-LD in a `<script>` tag, reusing the same
 * quote char). That narrow case can still truncate early — same as before
 * this fix, not a regression it introduces. Closing it fully needs the
 * scanner to know whether it's at an object-key position, which none of
 * its three callers currently track.
 */
function isLikelyStringEnd(text: string, quoteIndex: number): boolean {
  let i = quoteIndex + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return true;
  const ch = text[i];
  return ch === "," || ch === ")" || ch === "}" || ch === "]" || ch === ":";
}

/**
 * Tracks backslash-escape and quote-string state across a character scan, so
 * callers can skip escape/string-interior characters before applying their
 * own depth-tracking (paren/brace/bracket). Shared by `splitOperationLines`,
 * `extractBalancedArgs`, and `tokenizeArgs`, which otherwise duplicate this
 * exact state machine around different depth-tracking logic.
 */
function createQuoteScanner() {
  let escaped = false;
  let stringDelimiter: '"' | "'" | "`" | null = null;
  return {
    /**
     * Feed the character at `text[i]`; returns true if the caller should
     * skip further processing of it. The full text + index (rather than
     * just the character) let a candidate closing quote be checked against
     * what follows it — see `isLikelyStringEnd` — instead of always being
     * taken as the true end.
     */
    consume(text: string, i: number): boolean {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        return true;
      }

      if (ch === "\\") {
        escaped = true;
        return true;
      }

      if (stringDelimiter) {
        if (ch === stringDelimiter && isLikelyStringEnd(text, i)) {
          stringDelimiter = null;
        }
        return true;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        stringDelimiter = ch;
        return true;
      }

      return false;
    },
  };
}

/**
 * Result of the character-level line scan. `lastFlushedAtNewline` says how
 * the LAST entry in `lines` was produced: `true` if it ended at a top-level
 * `\n` (a genuinely finished statement), `false` if it was only flushed
 * because the input ran out (the tail-flush after the loop) — i.e. it is
 * whatever statement was still being typed when the input was cut off.
 * Irrelevant to `parseOperations` (which always sees the whole, final
 * script and treats a trailing unterminated line as complete, same as
 * before), but load-bearing for `parseCompleteOperationsPrefix`, which must
 * drop exactly that in-progress tail.
 */
function splitOperationLines(
  input: string,
): { lines: Array<{ text: string; line: number }>; lastFlushedAtNewline: boolean } {
  const parts: Array<{ text: string; line: number }> = [];
  let current = "";
  let currentStartLine = 1;
  let line = 1;
  let lastFlushedAtNewline = false;

  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  const scanner = createQuoteScanner();

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    current += ch;

    if (ch === "\n") {
      line++;
    }

    if (scanner.consume(input, i)) {
      continue;
    }

    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;

    // New statement boundary only at top level
    if (
      ch === "\n" &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      current.trim()
    ) {
      parts.push({ text: current, line: currentStartLine });
      current = "";
      currentStartLine = line;
      lastFlushedAtNewline = true;
    }
  }

  if (current.trim()) {
    parts.push({ text: current, line: currentStartLine });
    lastFlushedAtNewline = false;
  }

  return { lines: parts, lastFlushedAtNewline };
}

/**
 * Parse only the statements that are already syntactically COMPLETE in a
 * partial (still-streaming) `batch_design` script. Used by
 * `progressive.ts` to apply a script statement-by-statement while the model
 * is still typing it — see "2. `batch_design` — progressive real
 * application" in
 * docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md.
 *
 * Reuses the exact same noise-stripping + character-level scanner as
 * `parseOperations`, so "complete" here means precisely what a finished
 * script would parse as up to that point — no separate, potentially
 * drifting notion of completeness. Two differences from `parseOperations`:
 *
 * 1. The statement still being typed (the tail flushed at end-of-input
 *    rather than a top-level `\n`) is always DROPPED, even if it happens to
 *    already look parseable — a later delta can still change its shape
 *    (e.g. `I(document, {name: "Car` looks like a truncated string, but so
 *    does `I(document, {name: "Card"})` one delta earlier, before the
 *    closing brace/paren arrived). Only a statement terminated by its own
 *    top-level newline is trusted as final.
 * 2. Never throws. `parseLine` can still throw on a genuinely malformed
 *    statement (not just an incomplete one) — for example a stray token
 *    that will never become valid no matter how much more text streams in.
 *    Rather than fail the whole frame, this stops at (excluding) the first
 *    statement it can't parse and returns everything before it. The caller
 *    sees whatever prefix was good and simply gets nothing new next frame
 *    until the model's output resolves the issue (or the final, complete
 *    script is parsed normally by `parseOperations`, which DOES surface the
 *    error).
 */
export function parseCompleteOperationsPrefix(partial: string): ParsedOperation[] {
  // Delegates to a throwaway `CachedOperationsParser` — a cache that starts
  // (and stays) empty for a single one-shot call behaves identically to the
  // un-cached loop this used to be, so standalone callers/tests see no
  // difference. See `createCachedOperationsParser` for the stateful version
  // `progressive.ts` actually uses across frames of the same stream.
  return createCachedOperationsParser().parse(partial);
}

/** The physical lines of `partial` that are already syntactically complete
 * — i.e. exactly what `parseCompleteOperationsPrefix`'s doc comment above
 * describes, factored out so both it and `createCachedOperationsParser`
 * share one implementation of "what counts as complete" instead of two.
 */
function collectCompleteOperationLines(partial: string): Array<{ text: string; line: number }> {
  const { lines, lastFlushedAtNewline } = splitOperationLines(stripWrapperNoiseLines(partial));
  return lastFlushedAtNewline ? lines : lines.slice(0, -1);
}

export interface CachedOperationsParser {
  /**
   * Feed the LATEST full accumulated partial script (never a delta — the
   * caller always has the whole string streamed so far) and get back every
   * operation that is complete so far. A statement whose raw text is
   * unchanged from a previous call comes back as the SAME `ParsedOperation`
   * object — `parseLine` (and the `JSON5.parse` inside it) never runs twice
   * for the same statement.
   */
  parse(partial: string): ParsedOperation[];
}

/**
 * A per-stream, stateful wrapper around `parseCompleteOperationsPrefix`'s
 * logic. `progressive.ts` calls `parse` once per streamed input delta of a
 * single `batch_design` tool call; without this cache, every one of those
 * calls re-ran `parseLine` → `tokenizeArgs` → `JSON5.parse` for every
 * statement that was ALREADY complete in a previous delta — for a
 * showcase-sized batch (25 statements, tens of KB of embed HTML) streamed
 * over 20-40s at up to ~20 frames/sec, that's thousands of redundant JSON5
 * parses of multi-KB objects on the main thread, quadratic in script length.
 * This keeps the (cheap) character-level line scan re-running each frame —
 * it's a plain scan with no JSON parsing, negligible next to the cost this
 * exists to remove — but reuses the already-parsed `ParsedOperation` for any
 * statement whose raw text didn't change, so the expensive part scales with
 * the number of NEWLY completed statements, not the total.
 */
export function createCachedOperationsParser(): CachedOperationsParser {
  let cached: ParsedOperation[] = [];

  return {
    parse(partial: string): ParsedOperation[] {
      const completeLines = collectCompleteOperationLines(partial);

      const operations: ParsedOperation[] = [];
      let cacheIndex = 0;
      // Once one statement fails to match the cache at its position, every
      // later one is guaranteed new too (the prefix only ever grows in the
      // normal streaming case) — stop even TRYING the cache at that point,
      // rather than keep probing `cached[cacheIndex]` at a now-frozen index,
      // which could otherwise coincidentally match an unrelated cached
      // statement that happens to share raw text.
      let reuseExhausted = false;
      for (const entry of completeLines) {
        const raw = entry.text.trim();
        if (isSkippableLine(raw)) {
          continue;
        }

        if (!reuseExhausted) {
          const reusable = cached[cacheIndex];
          if (reusable && reusable.raw === raw) {
            operations.push(reusable);
            cacheIndex++;
            continue;
          }
          reuseExhausted = true;
        }

        try {
          operations.push(parseLine(raw, entry.line));
        } catch {
          // Stop at (excluding) the first unparseable statement rather than
          // failing the whole frame — see `parseCompleteOperationsPrefix`'s
          // doc comment.
          break;
        }
      }

      // Cache what THIS call produced, not what was reused from before: a
      // statement that stopped matching (or a newly-unparseable one) must
      // not linger in the cache and get silently reused again.
      cached = operations;
      return operations;
    },
  };
}

function parseLine(raw: string, lineNum: number): ParsedOperation {
  let remaining = raw;
  let binding: string | undefined;

  // Check for binding assignment: identifier=OP(...)
  const bindingMatch = remaining.match(/^(\w+)=([A-Z])\(/);
  if (bindingMatch) {
    binding = bindingMatch[1];
    remaining = remaining.slice(bindingMatch[1].length + 1); // skip "binding="
  }

  // Match operation: OP(...)
  const opMatch = remaining.match(/^([A-Z])\(/);
  if (!opMatch || !OP_TYPES.has(opMatch[1])) {
    throw new Error(
      `Line ${lineNum}: Invalid operation syntax: "${raw}". ` +
        `Each operation must be one of I/C/U/R/M/D/G, e.g. ` +
        `binding=I(parent, {...}) or U(path, {...}). Do not wrap the script in tags or code fences.`
    );
  }

  const op = opMatch[1] as OpType;
  remaining = remaining.slice(2); // skip "OP("

  // Find matching closing paren using brace-aware scanning
  const argsStr = extractBalancedArgs(remaining, lineNum);

  // Tokenize arguments
  const args = tokenizeArgs(argsStr, lineNum);

  return { binding, op, args, line: lineNum, raw };
}

/**
 * Extract the arguments string between outer parentheses,
 * handling nested braces, brackets, and strings.
 */
function extractBalancedArgs(str: string, lineNum: number): string {
  let depth = 1; // we already consumed the opening paren
  let braceDepth = 0;
  let bracketDepth = 0;
  const scanner = createQuoteScanner();

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (scanner.consume(str, i)) {
      continue;
    }

    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0 && braceDepth === 0 && bracketDepth === 0) {
        return str.slice(0, i);
      }
    }
  }

  throw new Error(`Line ${lineNum}: Unbalanced parentheses`);
}

/**
 * Split arguments by commas at depth 0, respecting nested structures.
 */
function tokenizeArgs(argsStr: string, lineNum: number): ParsedArg[] {
  if (!argsStr.trim()) return [];

  const tokens: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  const scanner = createQuoteScanner();
  let current = "";

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];

    if (scanner.consume(argsStr, i)) {
      current += ch;
      continue;
    }

    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;

    if (ch === "," && braceDepth === 0 && bracketDepth === 0) {
      tokens.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens.map((token) => classifyToken(token, lineNum));
}

/**
 * Classify a token into one of the ParsedArg kinds.
 */
function classifyToken(token: string, lineNum: number): ParsedArg {
  if (token === "undefined") {
    return { kind: "json", value: undefined };
  }

  // String literal: "..."
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    try {
      const decoded = JSON5.parse(escapeRawNewlinesInStrings(token));
      if (typeof decoded === "string") {
        return { kind: "string", value: decodeHtmlEntities(decoded) };
      }
    } catch {
      throw new Error(`Line ${lineNum}: Invalid string literal: ${token}`);
    }
  }

  // JSON object or array: {...} or [...]
  if (
    (token.startsWith("{") && token.endsWith("}")) ||
    (token.startsWith("[") && token.endsWith("]"))
  ) {
    try {
      return { kind: "json", value: parseJsonLike(token) };
    } catch {
      throw new Error(
        `Line ${lineNum}: Invalid JSON: ${token.slice(0, 60)}...`
      );
    }
  }

  // Concatenation: identifier+"/path/..."
  if (token.includes("+")) {
    const plusIdx = token.indexOf("+");
    const bindingName = token.slice(0, plusIdx).trim();
    let pathPart = token.slice(plusIdx + 1).trim();
    // Remove quotes from the path part
    if (pathPart.startsWith('"') && pathPart.endsWith('"')) {
      pathPart = pathPart.slice(1, -1);
    }
    return { kind: "concat", bindingName, pathSuffix: pathPart };
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(token)) {
    return { kind: "number", value: Number(token) };
  }

  // Boolean true/false — treat as JSON
  if (token === "true" || token === "false" || token === "null") {
    return { kind: "json", value: JSON5.parse(token) };
  }

  // Bare identifier → binding reference
  if (/^\w+$/.test(token)) {
    return { kind: "binding", name: token };
  }

  throw new Error(
    `Line ${lineNum}: Cannot classify argument: "${token}"`
  );
}

function parseJsonLike(token: string): unknown {
  const normalized = escapeRawNewlinesInStrings(token);

  try {
    return JSON.parse(normalized);
  } catch {
    return JSON5.parse(normalized);
  }
}

function escapeRawNewlinesInStrings(input: string): string {
  let result = "";
  let escaped = false;
  let stringDelimiter: '"' | "'" | "`" | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }

    if (stringDelimiter) {
      if (ch === stringDelimiter) {
        if (isLikelyStringEnd(input, i)) {
          result += ch;
          stringDelimiter = null;
        } else {
          // An internal, unescaped occurrence of the string's own delimiter
          // — almost always an HTML attribute quote written in the same
          // quote style as the surrounding string. Escape it so
          // JSON.parse/JSON5 treat it as content instead of (wrongly)
          // ending the string early; isLikelyStringEnd already located the
          // true end.
          result += "\\" + ch;
        }
        continue;
      }
      if (ch === "\n") {
        result += "\\n";
        continue;
      }
      if (ch === "\r") {
        result += "\\r";
        continue;
      }
      result += ch;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      stringDelimiter = ch;
      result += ch;
      continue;
    }

    result += ch;
  }

  return result;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
