import { mergeAttributes, Node } from "@tiptap/core";
import type { JSONContent, MarkdownToken } from "@tiptap/core";
import { lift } from "@tiptap/pm/commands";
import { TextSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CalloutView } from "./CalloutView";

// GitHub alerts, shown Notion-style as a tinted box with an icon:
//
//   > [!WARNING]
//   > Body text, any block markdown.
//
// A blockquote whose FIRST line is exactly one of the five markers becomes a `callout`
// (the marker is case-insensitive on load, upper-case on save). Every other quote,
// including an unknown `[!FOO]` marker, is left to the stock blockquote.

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export function isCalloutKind(value: unknown): value is CalloutKind {
  return typeof value === "string" && (CALLOUT_KINDS as readonly string[]).includes(value);
}

const MARKER = new RegExp(`^ {0,3}>[ \\t]?\\[!(${CALLOUT_KINDS.join("|")})\\][ \\t]*$`, "i");
const QUOTE_LINE = /^ {0,3}>/;
const QUOTE_PREFIX = /^ {0,3}> ?/;
/** `start` hint: a quote line that opens with `[!`, at any line start. */
const START = /^ {0,3}>[ \t]?\[!/im;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docCallout: {
      /** Wrap the block at the selection in a callout of `kind`. */
      setCallout: (kind?: CalloutKind) => ReturnType;
      /** Insert an empty callout with the caret in its paragraph. */
      insertCallout: (kind?: CalloutKind) => ReturnType;
    };
  }
}

function tokenizeCallout(
  src: string,
  _tokens: MarkdownToken[],
  lexer: { blockTokens: (s: string) => MarkdownToken[] },
): MarkdownToken | undefined {
  const lines = src.split("\n");
  const marker = MARKER.exec(lines[0]);
  if (!marker) return undefined;
  let count = 1;
  while (count < lines.length && QUOTE_LINE.test(lines[count])) count += 1;
  const body = lines.slice(1, count).map((line) => line.replace(QUOTE_PREFIX, ""));
  const raw = lines.slice(0, count).join("\n") + (count < lines.length ? "\n" : "");
  return {
    type: "callout",
    raw,
    kind: marker[1].toLowerCase(),
    tokens: lexer.blockTokens(body.join("\n").replace(/^\s*\n/, "").trimEnd() + "\n"),
  };
}

const INLINE_TYPES = new Set(["text", "hardBreak"]);

/** Inside list items marked yields bare `text` tokens; the body only accepts blocks, so wrap stray inline nodes. */
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

export const DocCallout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: "note",
        parseHTML: (el) => (isCalloutKind(el.getAttribute("data-kind")) ? el.getAttribute("data-kind") : "note"),
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
    };
  },

  parseHTML: () => [{ tag: 'div[data-type="callout"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout", class: "doc-callout" }), 0],
  addNodeView: () => ReactNodeViewRenderer(CalloutView),

  markdownTokenName: "callout",
  markdownTokenizer: { name: "callout", level: "block", start: (src: string) => src.search(START), tokenize: tokenizeCallout },
  parseMarkdown(token, helpers) {
    const body = wrapInline(helpers.parseChildren(token.tokens ?? []));
    const kind = isCalloutKind(token.kind) ? token.kind : "note";
    return helpers.createNode("callout", { kind }, body.length ? body : [{ type: "paragraph" }]);
  },
  renderMarkdown(node, h) {
    const kind = isCalloutKind(node.attrs?.kind) ? node.attrs.kind : "note";
    const inner = node.content?.length ? h.renderChildren(node.content, "\n\n").trim() : "";
    const quoted = inner.split("\n").map((line) => (line ? `> ${line}` : ">"));
    return [`> [!${kind.toUpperCase()}]`, ...(inner ? quoted : [])].join("\n");
  },

  addCommands() {
    return {
      setCallout:
        (kind = "note") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind }),
      insertCallout:
        (kind = "note") =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          const callout = state.schema.nodes[this.name].createAndFill({ kind })!;
          // An empty paragraph is replaced (the slash menu leaves one after removing "/query"); otherwise the callout goes right after the block.
          const empty = $from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth > 0;
          const at = empty ? $from.before() : $from.after();
          if (dispatch) {
            if (empty) tr.replaceWith(at, $from.after(), callout);
            else tr.insert(at, callout);
            tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2)));
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at the very start of a callout lifts its first block out (an empty callout turns back into a paragraph).
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        const { $from } = selection;
        if (!selection.empty || $from.parentOffset !== 0 || $from.depth < 2) return false;
        if ($from.node($from.depth - 1).type.name !== this.name || $from.index($from.depth - 1) !== 0) return false;
        const callout = $from.node($from.depth - 1);
        if (callout.childCount === 1 && $from.parent.content.size === 0) {
          const start = $from.before($from.depth - 1);
          const paragraph = editor.state.schema.nodes.paragraph.create();
          const tr = editor.state.tr.replaceWith(start, start + callout.nodeSize, paragraph);
          editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1))));
          return true;
        }
        return lift(editor.state, editor.view.dispatch);
      },
    };
  },
});
