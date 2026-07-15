/**
 * Minimal, dependency-free syntax highlighter for the Dev-mode Code section.
 * Pure regex/line-based tokenizer — no DOM access, no parser. Robustness
 * beats accuracy: any span the per-language rules don't recognize falls
 * through as a `"plain"` token, and the concatenation of every returned
 * token's `text` is always exactly equal to the input `code` (verified by
 * the test suite). Never throws.
 */

export type TokenKind =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "punctuation"
  | "plain"
  | "property"
  | "tag"
  | "className";

export interface Token {
  text: string;
  kind: TokenKind;
}

type Lang = "css" | "html" | "tsx";

interface Rule {
  kind: TokenKind;
  re: RegExp;
}

const CSS_KEYWORDS = new Set(["important", "inherit", "initial", "unset", "auto", "none"]);

const TSX_KEYWORDS = new Set([
  "export",
  "import",
  "from",
  "function",
  "return",
  "const",
  "let",
  "var",
  "if",
  "else",
  "for",
  "while",
  "default",
  "as",
  "type",
  "interface",
  "extends",
  "new",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "of",
  "in",
  "typeof",
  "void",
]);

/** Ordered rule list for a language: first match wins at each scan position. */
const CSS_RULES: Rule[] = [
  { kind: "comment", re: /^\/\*[\s\S]*?\*\// },
  { kind: "string", re: /^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/ },
  // Property name: identifier (incl. --custom-props) immediately followed by ':'.
  // Note: this can misclassify pseudo-selector-ish input as `property` (e.g. the
  // "a" in "a:hover" in selector position). Cosmetic-only — the generators feed
  // this tokenizer declaration blocks, so selectors barely occur in practice.
  { kind: "property", re: /^(--[a-zA-Z0-9_-]+|[a-zA-Z-]+)(?=\s*:)/ },
  { kind: "number", re: /^-?\d*\.?\d+(?:px|rem|em|%|deg|s|ms|fr|vh|vw)?\b/ },
  { kind: "punctuation", re: /^[{}:;,()]/ },
  { kind: "plain", re: /^[a-zA-Z#.-][a-zA-Z0-9#.-]*/ },
];

const HTML_RULES: Rule[] = [
  { kind: "comment", re: /^<!--[\s\S]*?-->/ },
  { kind: "tag", re: /^<\/?[a-zA-Z][a-zA-Z0-9-]*/ },
  { kind: "string", re: /^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/ },
  { kind: "property", re: /^[a-zA-Z-]+(?=\s*=)/ },
  { kind: "punctuation", re: /^[<>/=]/ },
];

const TSX_RULES: Rule[] = [
  { kind: "comment", re: /^\{\/\*[\s\S]*?\*\/\}|^\/\/[^\n]*|^\/\*[\s\S]*?\*\// },
  { kind: "string", re: /^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'|^`(?:[^`\\]|\\.)*`/ },
  { kind: "tag", re: /^<\/?[A-Za-z][A-Za-z0-9.]*/ },
  {
    kind: "keyword",
    re: /^(export|import|from|function|return|const|let|var|if|else|for|while|default|as|type|interface|extends|new|true|false|null|undefined|this|of|in|typeof|void)\b/,
  },
  { kind: "property", re: /^[a-zA-Z-]+(?=\s*=\{|\s*=")/ },
  { kind: "number", re: /^-?\d*\.?\d+\b/ },
  { kind: "punctuation", re: /^[{}()[\];:,.<>/=]/ },
  { kind: "plain", re: /^[A-Za-z_$][A-Za-z0-9_$]*/ },
];

function rulesFor(lang: Lang): Rule[] {
  if (lang === "css") return CSS_RULES;
  if (lang === "html") return HTML_RULES;
  return TSX_RULES;
}

/** Reclassify a "plain" identifier token as "keyword" for CSS keyword-ish values, otherwise leave it. */
function refineCssPlain(text: string): TokenKind {
  return CSS_KEYWORDS.has(text) ? "keyword" : "plain";
}

function refineTsxPlain(text: string): TokenKind {
  return TSX_KEYWORDS.has(text) ? "keyword" : "plain";
}

/** Merge adjacent tokens of the same kind so runs of whitespace/plain text collapse into one span. */
function mergeAdjacent(tokens: Token[]): Token[] {
  const merged: Token[] = [];
  for (const token of tokens) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === token.kind) {
      prev.text += token.text;
    } else {
      merged.push({ ...token });
    }
  }
  return merged;
}

/**
 * Tokenize `code` for `lang` into highlight spans. Scans left to right,
 * trying each language's ordered rule list at the current position; the
 * first regex that matches (anchored with `^` against the remaining slice)
 * consumes its match. Any single character nothing matches is emitted as one
 * `"plain"` token, guaranteeing forward progress and full text coverage even
 * for input the rules don't understand (e.g. binary-looking noise).
 */
export function highlightCode(code: string, lang: Lang): Token[] {
  if (!code) return [];

  const rules = rulesFor(lang);
  const tokens: Token[] = [];
  let rest = code;

  while (rest.length > 0) {
    let matched = false;
    for (const rule of rules) {
      const m = rule.re.exec(rest);
      if (m && m[0].length > 0) {
        const text = m[0];
        let kind = rule.kind;
        if (kind === "plain") {
          kind = lang === "css" ? refineCssPlain(text) : lang === "tsx" ? refineTsxPlain(text) : kind;
        }
        tokens.push({ text, kind });
        rest = rest.slice(text.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // No rule matched at this position (e.g. whitespace, punctuation the
      // language has no rule for) — emit one plain character and advance.
      tokens.push({ text: rest[0], kind: "plain" });
      rest = rest.slice(1);
    }
  }

  return mergeAdjacent(tokens);
}
