import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import type { JSONContent, MarkdownToken } from "@tiptap/core";

// Notion's toggle list, stored as GitHub-compatible markdown:
//
//   <details open>
//   <summary>Summary with **inline** markdown</summary>
//
//   Any block markdown, including nested toggles.
//
//   </details>
//
// The stock extension writes a non-standard `:::details` block and its HTML
// tokenizer cuts the body at the first blank line, so tokenizing is done here.

/** The one definition of a toggle opening line: up to 3 spaces, `<details>` with an optional `open` / `open=""` / `open="open"`. */
const OPEN_TAG = /^ {0,3}<details(\s+open(?:=(?:""|"open"))?)?\s*>/i;
const CLOSE_TAG = /<\/details\s*>/gi;
/** `start` hint: the same opening as OPEN_TAG, at any line start. */
const OPEN_LINE_START = new RegExp(OPEN_TAG.source, "im");
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SUMMARY = /^\s*<summary>([\s\S]*?)<\/summary>/i;

/** Blank out inline code spans (same length, so indexes stay valid). */
function stripInlineCode(line: string): string {
  return line.replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, (m) => " ".repeat(m.length));
}

/** Index just past the `</details>` that balances the opening tag at 0, or null. Tags in code are ignored. */
function findBalancedEnd(src: string): { close: number; end: number } | null {
  let depth = 0;
  let fence: { char: string; len: number } | null = null;
  let offset = 0;
  for (const line of src.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence.char && f[1].length >= fence.len && /^[ \t]*$/.test(line.slice(f[0].length))) fence = null;
      continue;
    }
    if (f && !(f[1][0] === "`" && line.slice(f[0].length).includes("`"))) {
      fence = { char: f[1][0], len: f[1].length };
      continue;
    }
    const scan = stripInlineCode(line);
    if (OPEN_TAG.test(scan)) depth += 1;
    for (const m of scan.matchAll(CLOSE_TAG)) {
      depth -= 1;
      if (depth === 0) return { close: lineStart + m.index, end: lineStart + m.index + m[0].length };
    }
  }
  return null;
}

function tokenizeDetails(
  src: string,
  _tokens: MarkdownToken[],
  lexer: { inlineTokens: (s: string) => MarkdownToken[]; blockTokens: (s: string) => MarkdownToken[] },
): MarkdownToken | undefined {
  const open = OPEN_TAG.exec(src);
  if (!open) return undefined;
  const range = findBalancedEnd(src);
  if (!range) return undefined;
  let body = src.slice(open[0].length, range.close);
  const summary = SUMMARY.exec(body);
  body = summary ? body.slice(summary[0].length) : body;
  const trailing = /^[ \t]*(?:\n|$)/.exec(src.slice(range.end));
  return {
    type: "details",
    raw: src.slice(0, range.end) + (trailing ? trailing[0] : ""),
    open: Boolean(open[1]),
    summaryTokens: lexer.inlineTokens((summary?.[1] ?? "").trim()),
    tokens: lexer.blockTokens(body.replace(/^\s*\n/, "").trimEnd() + "\n"),
  };
}

const INLINE_TYPES = new Set(["text", "hardBreak"]);

/** Inside list items marked yields bare `text` tokens; the toggle body only accepts blocks, so wrap stray inline nodes. */
function wrapInline(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  let run: JSONContent[] = [];
  const flush = () => {
    if (run.length) out.push({ type: "paragraph", content: run });
    run = [];
  };
  for (const node of nodes) {
    if (node.type && INLINE_TYPES.has(node.type)) run.push(node);
    else {
      flush();
      out.push(node);
    }
  }
  flush();
  return out;
}

const JOINS_WITH_NEWLINE = new Set(["listItem", "taskItem"]);

const NO_MARKDOWN = { markdownTokenizer: undefined, parseMarkdown: undefined, renderMarkdown: undefined } as const;

export const DocDetails = Details.extend({
  markdownTokenName: "details",
  markdownTokenizer: { name: "details", level: "block", start: (src: string) => src.search(OPEN_LINE_START), tokenize: tokenizeDetails },
  parseMarkdown(token, helpers) {
    const body = wrapInline(helpers.parseChildren(token.tokens ?? []));
    const content: JSONContent[] = body.length ? body : [{ type: "paragraph" }];
    return helpers.createNode(
      "details",
      token.open ? { open: true } : undefined,
      [
        helpers.createNode("detailsSummary", undefined, helpers.parseInline(token.summaryTokens ?? [])),
        helpers.createNode("detailsContent", undefined, content),
      ],
    );
  },
  renderMarkdown(node, h, ctx) {
    const [summary, body] = node.content ?? [];
    const head = `<details${node.attrs?.open ? " open" : ""}>\n<summary>${h.renderChildren(summary?.content ?? [])}</summary>`;
    const inner = body?.content?.length ? h.renderChildren(body.content, "\n\n").trim() : "";
    const out = inner ? `${head}\n\n${inner}\n\n</details>` : `${head}\n\n</details>`;
    // A list or task item joins its blocks with a single newline, and a tag right under a paragraph line is read back as its text.
    return ctx?.parentType && JOINS_WITH_NEWLINE.has(ctx.parentType) ? `\n${out}` : out;
  },
}).configure({ persist: true, HTMLAttributes: { class: "doc-details" } });

export const DocDetailsSummary = DetailsSummary.extend(NO_MARKDOWN);
export const DocDetailsContent = DetailsContent.extend(NO_MARKDOWN);
