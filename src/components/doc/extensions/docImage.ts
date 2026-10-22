import Image, { inputRegex } from "@tiptap/extension-image";
import { ResizableNodeView, getRenderedAttributes, mergeAttributes, nodeInputRule } from "@tiptap/core";
import type { MarkdownToken } from "@tiptap/core";
import { buildImageMarkdown } from "@/lib/docs/insertImage";
import "./docImage.css";

// Images are resizable by width only. The document is stored as markdown, so the width rides in
// the URL fragment:
//
//   ![alt](https://x.test/y.png#width=480)         (no fragment yet)
//   ![alt](https://x.test/y.png#frag&width=480)    (URL already has a fragment)
//
// On load a trailing `#width=N` / `&width=N` (N a positive integer) moves into the `width` attr,
// so `src` never contains it. Height is never stored: the image keeps its aspect ratio.

const WIDTH_SUFFIX = /([#&])width=(\d+)$/;

/**
 * Splits trailing width markers off an image URL; a non-positive or non-numeric one stays in `src`.
 * `&width=N` only counts inside a fragment (a `#` earlier in the URL): in a query string it is a
 * real parameter. Markers are stripped repeatedly so `src` never ends in a valid one; the
 * outermost (last) marker gives the width.
 */
export function splitImageWidth(href: string): { src: string; width: number | null } {
  let src = href;
  let width: number | null = null;
  for (;;) {
    const match = WIDTH_SUFFIX.exec(src);
    if (!match) break;
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value) || value <= 0) break;
    if (match[1] === "&" && !src.slice(0, match.index).includes("#")) break;
    if (width === null) width = value;
    src = src.slice(0, match.index);
  }
  return { src, width };
}

/** Puts the width marker on a URL (`#` when it has no fragment yet, else `&`), replacing any existing one. */
export function joinImageWidth(src: string, width: number | null | undefined): string {
  const base = splitImageWidth(src).src;
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) return base;
  return `${base}${base.includes("#") ? "&" : "#"}width=${Math.round(width)}`;
}

/** Moves a width marker out of `attrs.src` into `attrs.width` (an explicit positive width wins). */
export function normalizeImageAttrs<T extends { src?: unknown; width?: unknown }>(attrs: T): T {
  if (typeof attrs.src !== "string") return attrs;
  const { src, width } = splitImageWidth(attrs.src);
  if (src === attrs.src) return attrs;
  const explicit = typeof attrs.width === "number" && attrs.width > 0;
  return { ...attrs, src, width: explicit ? attrs.width : width };
}

const PLAIN_PX = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i;

function widthFromElement(element: HTMLElement): number | null {
  const styleWidth = element.style.width;
  const raw = styleWidth ? styleWidth : element.getAttribute("width");
  if (!raw) return null;
  // Only plain numbers and `px`: `100%`, `em` etc. have no pixel meaning here.
  const match = PLAIN_PX.exec(raw);
  if (!match || (styleWidth && !/px\s*$/i.test(raw))) return null;
  const width = Math.round(Number(match[1]));
  return width > 0 ? width : null;
}

export const DocImage = Image.extend({
  addOptions() {
    return {
      ...this.parent!(),
      resize: {
        enabled: true,
        directions: ["left", "right"],
        minWidth: 48,
        alwaysPreserveAspectRatio: true,
      },
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        // Pasted HTML may carry the width marker in the URL; keep it out of `src`.
        parseHTML: (element: HTMLElement) => {
          const src = element.getAttribute("src");
          return src === null ? null : splitImageWidth(src).src;
        },
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => widthFromElement(element) ?? splitImageWidth(element.getAttribute("src") ?? "").width,
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.width === "number" ? { style: `width:${attributes.width}px` } : {},
      },
      // Never stored: the browser derives it from the width and the natural aspect ratio.
      height: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },

  parseMarkdown: (token: MarkdownToken, helpers) => {
    const { src, width } = splitImageWidth(String(token.href ?? ""));
    // marked leaves `\\` pairs in the image text (it only drops the backslash before brackets), and
    // `buildImageMarkdown` doubles every backslash: undo that so alt round-trips exactly.
    const alt = String(token.text ?? "").replace(/\\(.)/g, "$1");
    return helpers.createNode("image", { src, title: token.title, alt, width });
  },

  renderMarkdown: (node) =>
    buildImageMarkdown(
      String(node.attrs?.alt ?? ""),
      joinImageWidth(String(node.attrs?.src ?? ""), node.attrs?.width),
      node.attrs?.title ? String(node.attrs.title) : undefined,
    ),

  addCommands() {
    return {
      ...this.parent?.(),
      setImage:
        (options) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: normalizeImageAttrs(options) }),
    };
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: inputRegex,
        type: this.type,
        getAttributes: (match) => {
          const [, , alt, src, title] = match;
          return normalizeImageAttrs({ src, alt, title });
        },
      }),
    ];
  },

  // Same as the stock resizable node view, except that the commit writes only `width`: the stored
  // size is width only, and height follows from the aspect ratio.
  addNodeView() {
    const resize = this.options.resize;
    if (!resize || !resize.enabled || typeof document === "undefined") return null;
    const { directions, minWidth, minHeight, alwaysPreserveAspectRatio } = resize;
    const managed = new Set(["src", "width", "height"]);
    return ({ node, getPos, HTMLAttributes, editor }) => {
      const el = document.createElement("img");
      el.draggable = false;
      const merged = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
      Object.entries(merged).forEach(([key, value]) => {
        if (value != null && !managed.has(key)) el.setAttribute(key, String(value));
      });
      if (merged.src != null) el.src = merged.src;
      let previous = { ...HTMLAttributes };
      const syncSource = (src: unknown) => {
        if (typeof src === "string" && src !== "") {
          if (el.getAttribute("src") !== src) el.src = src;
          return;
        }
        if (el.hasAttribute("src")) el.removeAttribute("src");
        if (el.src !== "") el.src = "";
      };
      syncSource(HTMLAttributes.src);
      const onUpdate = (updated: typeof node) => {
        if (updated.type !== node.type) return false;
        const attributes = editor.extensionManager.attributes.filter((a) => a.type === updated.type.name);
        const next = getRenderedAttributes(updated, attributes);
        Object.keys(previous).forEach((key) => {
          if (!managed.has(key) && !(key in next)) el.removeAttribute(key);
        });
        Object.entries(next).forEach(([key, value]) => {
          if (managed.has(key)) return;
          if (value != null) el.setAttribute(key, String(value));
          else el.removeAttribute(key);
        });
        syncSource(next.src);
        previous = next;
        return true;
      };
      const view = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        onResize: (width, height) => {
          el.style.width = `${width}px`;
          el.style.height = `${height}px`;
        },
        onCommit: (width) => {
          if (!editor.isEditable) return;
          const pos = getPos();
          if (pos === undefined) return;
          // The drag pinned an inline px height. If the width is unchanged the node stays `eq`, no
          // update runs, and that height would break the aspect ratio when the column narrows.
          el.style.height = "";
          el.style.width = `${width}px`;
          editor.chain().setNodeSelection(pos).updateAttributes(this.name, { width }).run();
        },
        onUpdate,
        options: {
          directions,
          min: { width: minWidth, height: minHeight },
          preserveAspectRatio: alwaysPreserveAspectRatio === true,
        },
      });
      const dom = view.dom;
      const show = () => {
        dom.style.visibility = "";
        dom.style.pointerEvents = "";
      };
      dom.style.visibility = "hidden";
      dom.style.pointerEvents = "none";
      // An empty src never fires load or error: show the block at once or it stays invisible and unclickable.
      if (!HTMLAttributes.src || (el.complete && el.naturalWidth > 0)) show();
      else {
        el.onload = show;
        el.onerror = show;
      }
      // The drag pins an inline px height; drop it again after each update so `height: auto`
      // follows the width, and keep `style.width` on the attr.
      const sync = (n: { attrs: Record<string, unknown> }) => {
        el.style.height = "";
        el.style.width = typeof n.attrs.width === "number" ? `${n.attrs.width}px` : "";
      };
      sync(node);
      const update = view.update?.bind(view);
      if (update) {
        view.update = (updatedNode, decorations, innerDecorations) => {
          const ok = update(updatedNode, decorations, innerDecorations);
          if (ok) sync(updatedNode);
          return ok;
        };
      }
      return view;
    };
  },
});
