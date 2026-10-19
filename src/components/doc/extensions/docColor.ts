import { Mark, getMarkAttributes, type Editor, type JSONContent, type MarkdownToken } from "@tiptap/core";
import { isDocColor, type DocColor } from "../docPalette";

// Notion text + background colour. Stored as `<span data-color="red" data-bg="yellow">…</span>`:
// palette NAMES only, never hex, so each theme maps a name to its own shade (docProse.css).

export interface DocColorAttrs {
  color?: DocColor | null;
  background?: DocColor | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docColor: {
      /** `undefined` keeps that half, `null` removes it; with both halves empty the mark is removed. */
      setDocColor: (attrs: DocColorAttrs) => ReturnType;
      unsetDocColor: () => ReturnType;
    };
  }
}

function validName(value: unknown): DocColor | null {
  return isDocColor(value) ? value : null;
}

const SPAN_OPEN = /^<span\b([^>]*)>/i;
const SPAN_TAG = /<span\b[^>]*>|<\/span\s*>/gi;

function attrOf(attrs: string, name: string): string | null {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs)?.[1] ?? null;
}

function findSpanEnd(src: string): { close: number; end: number } | null {
  let depth = 0;
  SPAN_TAG.lastIndex = 0;
  for (let m = SPAN_TAG.exec(src); m; m = SPAN_TAG.exec(src)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return { close: m.index, end: m.index + m[0].length };
  }
  return null;
}

/** Add the outer colour under any inner one (inner wins per attribute); code never takes a colour. */
function applyDocColor(node: JSONContent, color: DocColor | null, background: DocColor | null): JSONContent {
  if (node.type !== "text") return node;
  const marks = node.marks ?? [];
  if (marks.some((m) => m.type === "code")) return node;
  const inner = marks.find((m) => m.type === "docColor");
  const attrs = {
    color: validName(inner?.attrs?.color) ?? color,
    background: validName(inner?.attrs?.background) ?? background,
  };
  const rest = marks.filter((m) => m.type !== "docColor");
  return { ...node, marks: [...rest, { type: "docColor", attrs }] };
}

export const DocColorMark = Mark.create({
  name: "docColor",
  priority: 1000,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => validName(el.getAttribute("data-color")),
        renderHTML: (attrs) => (attrs.color ? { "data-color": attrs.color } : {}),
      },
      background: {
        default: null,
        parseHTML: (el) => validName(el.getAttribute("data-bg")),
        renderHTML: (attrs) => (attrs.background ? { "data-bg": attrs.background } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (el) => {
          const node = el as HTMLElement;
          const hasName = validName(node.getAttribute("data-color")) || validName(node.getAttribute("data-bg"));
          return hasName ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },

  markdownTokenizer: {
    name: "docColor",
    level: "inline",
    start: (src: string) => src.search(/<span\b[^>]*\bdata-(?:color|bg)\s*=/i),
    tokenize(src, _tokens, lexer): MarkdownToken | undefined {
      const open = SPAN_OPEN.exec(src);
      if (!open) return undefined;
      const color = attrOf(open[1], "data-color");
      const background = attrOf(open[1], "data-bg");
      if (color === null && background === null) return undefined;
      const range = findSpanEnd(src);
      if (!range) return undefined;
      return {
        type: "docColor",
        raw: src.slice(0, range.end),
        color: validName(color),
        background: validName(background),
        tokens: lexer.inlineTokens(src.slice(open[0].length, range.close)),
      };
    },
  },

  parseMarkdown(token, helpers) {
    const content = helpers.parseInline(token.tokens ?? []);
    if (!token.color && !token.background) return content;
    return content.map((node) => applyDocColor(node, token.color ?? null, token.background ?? null));
  },

  renderMarkdown(node, h) {
    const color = validName(node.attrs?.color);
    const background = validName(node.attrs?.background);
    const attrs = [color && `data-color="${color}"`, background && `data-bg="${background}"`].filter(Boolean).join(" ");
    const inner = h.renderChildren(node);
    return attrs ? `<span ${attrs}>${inner}</span>` : inner;
  },

  addCommands() {
    return {
      setDocColor:
        (attrs) =>
        ({ state, commands }) => {
          const current = getMarkAttributes(state, this.name);
          const color = validName(attrs.color === undefined ? current.color : attrs.color);
          const background = validName(attrs.background === undefined ? current.background : attrs.background);
          if (!color && !background) return commands.unsetMark(this.name);
          return commands.setMark(this.name, { color, background });
        },
      unsetDocColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/** Colours active at the selection (for the colour picker's current-value marker). */
export function getActiveDocColor(editor: Editor): { color?: DocColor; background?: DocColor } {
  const attrs = editor.getAttributes("docColor");
  const color = validName(attrs.color);
  const background = validName(attrs.background);
  return { ...(color ? { color } : {}), ...(background ? { background } : {}) };
}
