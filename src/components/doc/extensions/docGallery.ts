import { mergeAttributes, Node } from "@tiptap/core";
import type { Editor, MarkdownToken } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { buildImageMarkdown } from "@/lib/docs/insertImage";
import { GalleryView } from "./GalleryView";

// An image gallery: thumbnails that open full size. Markdown is a GitHub-alert-style quote
// whose body is nothing but image lines:
//
//   > [!GALLERY]
//   > ![First](https://x.test/1.png)
//   > ![Second](https://x.test/2.png)
//
// The marker is case-insensitive on load, upper-case on save. A quote that has any other
// body line is NOT a gallery and is left to the stock blockquote (the tokenizer returns undefined).

export interface GalleryImage {
  src: string;
  alt: string;
  title?: string;
}

type InlineLexer = { inlineTokens: (src: string) => MarkdownToken[] };

const MARKER = /^ {0,3}>[ \t]?\[!gallery\][ \t]*$/i;
const QUOTE_LINE = /^ {0,3}>/;
const QUOTE_PREFIX = /^ {0,3}> ?/;
const START = /^ {0,3}>[ \t]?\[!gallery\]/im;

export function parseGalleryImages(value: unknown): GalleryImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = item as Partial<GalleryImage> | null;
    if (!entry || typeof entry.src !== "string" || !entry.src) return [];
    const image: GalleryImage = { src: entry.src, alt: typeof entry.alt === "string" ? entry.alt : "" };
    if (typeof entry.title === "string" && entry.title) image.title = entry.title;
    return [image];
  });
}

// The "open the URL field" request is plugin state holding the inserted gallery's position. It is
// mapped through every transaction, so it follows the node, and it is dropped as soon as the
// selection is anything but that node: a stale request can never open a field on another gallery.
const openAddKey = new PluginKey<number | null>("imageGalleryOpenAdd");

/** True while `insertGallery(true)` has asked the gallery at `pos` to open its URL field. Read-only: call `clearOpenAdd` once the field is open (StrictMode runs effects twice). */
export function peekOpenAdd(editor: Editor, pos: number | undefined): boolean {
  return pos !== undefined && openAddKey.getState(editor.state) === pos;
}

export function clearOpenAdd(editor: Editor): void {
  if (openAddKey.getState(editor.state) == null) return;
  editor.view.dispatch(editor.state.tr.setMeta(openAddKey, null));
}

/** A body line is a gallery image when it lexes to exactly one image token (plus blank text). */
function parseImageLine(text: string, lexer: InlineLexer): GalleryImage | undefined {
  const tokens = lexer.inlineTokens(text).filter((token) => !(token.type === "text" && !String(token.raw ?? token.text ?? "").trim()));
  if (tokens.length !== 1 || tokens[0].type !== "image") return undefined;
  const href = typeof tokens[0].href === "string" ? tokens[0].href : "";
  if (!href) return undefined;
  const image: GalleryImage = { alt: String(tokens[0].text ?? "").replace(/\\(.)/g, "$1"), src: href };
  if (typeof tokens[0].title === "string" && tokens[0].title) image.title = tokens[0].title;
  return image;
}

function tokenizeGallery(src: string, lexer: InlineLexer): MarkdownToken | undefined {
  const lines = src.split("\n");
  if (!MARKER.test(lines[0])) return undefined;
  let count = 1;
  while (count < lines.length && QUOTE_LINE.test(lines[count])) count += 1;
  const images: GalleryImage[] = [];
  for (const line of lines.slice(1, count)) {
    const text = line.replace(QUOTE_PREFIX, "").trim();
    if (!text) continue;
    const image = parseImageLine(text, lexer);
    if (!image) return undefined;
    images.push(image);
  }
  const raw = lines.slice(0, count).join("\n") + (count < lines.length ? "\n" : "");
  return { type: "imageGallery", raw, images };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docGallery: {
      /** Insert an empty gallery (replacing an empty paragraph) and select it; `openAdd` asks its view to open the URL field. */
      insertGallery: (openAdd?: boolean) => ReturnType;
    };
  }
}

export const DocGallery = Node.create({
  name: "imageGallery",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      images: {
        default: [] as GalleryImage[],
        parseHTML: (el) => {
          try {
            return parseGalleryImages(JSON.parse(el.getAttribute("data-images") ?? "[]"));
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) => ({ "data-images": JSON.stringify(parseGalleryImages(attrs.images)) }),
      },
    };
  },

  parseHTML: () => [{ tag: 'div[data-type="image-gallery"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "image-gallery", class: "doc-gallery" })],
  addNodeView: () => ReactNodeViewRenderer(GalleryView),

  markdownTokenName: "imageGallery",
  markdownTokenizer: { name: "imageGallery", level: "block", start: (src: string) => src.search(START), tokenize: (src: string, _tokens: MarkdownToken[], lexer: InlineLexer) => tokenizeGallery(src, lexer) },
  parseMarkdown(token, helpers) {
    return helpers.createNode("imageGallery", { images: parseGalleryImages(token.images) });
  },
  renderMarkdown(node) {
    const images = parseGalleryImages(node.attrs?.images);
    return ["> [!GALLERY]", ...images.map((image) => `> ${buildImageMarkdown(image.alt, image.src, image.title)}`)].join("\n");
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<number | null>({
        key: openAddKey,
        state: {
          init: () => null,
          apply: (tr, pending) => {
            const meta = tr.getMeta(openAddKey) as number | null | undefined;
            if (meta !== undefined) return meta;
            if (pending === null) return null;
            const mapped = tr.mapping.map(pending);
            if (!tr.selectionSet && !tr.docChanged) return pending;
            const { selection } = tr;
            return selection instanceof NodeSelection && selection.from === mapped ? mapped : null;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertGallery:
        (openAdd = false) =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          const type = state.schema.nodes[this.name];
          const gallery = type.create({ images: [] });
          // Same placement rule as insertCallout: an empty paragraph is replaced, otherwise the node goes right after the block.
          // Where the schema refuses that (the only paragraph of a list item must stay a paragraph), the node goes after the enclosing top-level block.
          let at: number;
          let replaceTo: number | null = null;
          if ($from.depth === 0) at = state.selection.to;
          else {
            const parent = $from.node(-1);
            const index = $from.index(-1);
            const empty = $from.parent.isTextblock && $from.parent.content.size === 0;
            if (empty && parent.canReplaceWith(index, index + 1, type)) {
              at = $from.before();
              replaceTo = $from.after();
            } else if (parent.canReplaceWith(index + 1, index + 1, type)) at = $from.after();
            else at = $from.after(1);
          }
          if (dispatch) {
            if (replaceTo !== null) tr.replaceWith(at, replaceTo, gallery);
            else tr.insert(at, gallery);
            // The replace may refit, so look the gallery up instead of trusting `at`.
            let placed: number | null = null;
            tr.doc.nodesBetween(Math.max(0, at - 1), Math.min(tr.doc.content.size, at + gallery.nodeSize + 1), (node, pos) => {
              if (placed === null && node.type === type && pos >= at - 1) placed = pos;
              return placed === null;
            });
            if (placed !== null) {
              tr.setSelection(NodeSelection.create(tr.doc, placed));
              tr.setMeta(openAddKey, openAdd ? placed : null);
            }
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },
});
