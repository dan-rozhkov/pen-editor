/**
 * Pure, DOM-only helpers for a layers-panel-style tree over an embed's
 * `htmlContent` source string — the counterpart to `embedElementPicker.ts`
 * and `embedElementStyle.ts`, which speak the *shadow-relative* path an
 * embed's HTML resolves to once mounted (see `embedElementStyle.ts`'s
 * module doc comment for the container/synthetic-body wrapping). This
 * module builds the tree straight from the source string with a plain
 * `DOMParser`, so it never needs a live embed or a shadow root, and derives
 * a stable row identity (`sourcePath`, always positional — never `#id`-
 * anchored) that survives reordering-insensitive re-parses of the same
 * source.
 *
 * Kept framework-free like its siblings so it's testable in happy-dom
 * without React/Zustand/Pixi.
 */

import { buildElementPath, describeEmbedElement, resolveElementPath } from "./embedElementPicker";
import type { EmbedElementSelection } from "./embedElementPicker";
import {
  CONTENT_CONTAINER_SEGMENT,
  SYNTHETIC_BODY_SEGMENT,
  shadowPathToSourcePath,
} from "./embedElementStyle";
import { hasBodyTargetedStyles } from "@/utils/embedHtmlUtils";

export type EmbedLayerKind = "frame" | "text" | "image" | "shape";

export interface EmbedElementLayer {
  /** path relative to the parsed source `<body>`, positional form (never
   * `#id`-anchored) — this is the row's identity. */
  sourcePath: string;
  /** the same element addressed the way the picker/properties/highlight
   * pipeline addresses it (shadow-relative, see the module doc comment). */
  shadowPath: string;
  tagName: string;
  /** label shown in the layers panel */
  name: string;
  kind: EmbedLayerKind;
  /** true when the element carries an inline `display: none` */
  hidden: boolean;
  children: EmbedElementLayer[];
}

/** Tags whose entire subtree is skipped — never rows, never descended into.
 * These carry no visual content of their own in the layers sense (styling/
 * scripting/metadata), and walking into a `<template>`'s inert content in
 * particular would surface elements that never actually render. */
const SKIPPED_TAGS = new Set([
  "script",
  "style",
  "link",
  "meta",
  "title",
  "template",
  "noscript",
  "base",
]);

const TEXT_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "a", "li", "label",
  "strong", "em", "b", "i", "small", "blockquote", "figcaption", "caption",
  "td", "th", "dt", "dd", "legend", "summary", "code", "pre", "button", "option",
]);

const IMAGE_TAGS = new Set(["img", "picture", "svg", "video", "canvas", "iframe"]);

const SHAPE_TAGS = new Set(["hr", "input", "select", "textarea", "progress", "meter"]);

/** Inline-formatting tags that collapse into their parent's text-leaf row
 * rather than becoming rows of their own — see the text-leaf rule below. */
const INLINE_TAGS = new Set([
  "b", "strong", "i", "em", "u", "s", "small", "mark", "code", "sub", "sup",
  "br", "abbr", "wbr", "span",
]);

function tagKind(tag: string): EmbedLayerKind {
  if (TEXT_TAGS.has(tag)) return "text";
  if (IMAGE_TAGS.has(tag)) return "image";
  if (SHAPE_TAGS.has(tag)) return "shape";
  return "frame";
}

/** Exported for `embedLayerActions.ts`'s rename flow, which needs the same
 * whitespace-collapsed text this module derives a row's default name from
 * — see `resolveEmbedElementEditName`'s doc comment there for why. */
export function collapseText(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

const NAME_TRUNCATE_MAX = 28;

function truncateName(text: string): string {
  return text.length > NAME_TRUNCATE_MAX ? `${text.slice(0, NAME_TRUNCATE_MAX)}…` : text;
}

/** Non-element children (`<script>` etc.) are dropped up front — they never
 * become rows and must not count toward the text-leaf check below. */
function visibleElementChildren(el: Element): Element[] {
  return Array.from(el.children).filter((c) => !SKIPPED_TAGS.has(c.tagName.toLowerCase()));
}

function resolveName(el: Element, tag: string, kind: EmbedLayerKind, text: string): string {
  const dataName = el.getAttribute("data-layer-name")?.trim();
  if (dataName) return dataName;

  if (kind === "text" && text) return truncateName(text);

  if (tag === "img") {
    const alt = el.getAttribute("alt")?.trim();
    if (alt) return alt;
  }

  if (el.id) return `#${el.id}`;

  const firstClass = el.classList?.[0];
  if (firstClass) return `.${firstClass}`;

  return tag;
}

/** Reads `display: none` off the parsed element's own inline style — never
 * computed style, since there's no layout engine behind a bare `DOMParser`
 * document. `style` exists on every parsed HTML/SVG element here. */
function isInlineHidden(el: Element): boolean {
  const display = (el as HTMLElement).style?.display;
  return typeof display === "string" && display.toLowerCase() === "none";
}

function buildRow(el: Element, root: Element, shadowPrefixStr: string): EmbedElementLayer {
  const tag = el.tagName.toLowerCase();
  const elementChildren = visibleElementChildren(el);
  const allChildrenInline =
    elementChildren.length > 0 &&
    elementChildren.every((c) => INLINE_TAGS.has(c.tagName.toLowerCase()));
  // "Leaf-eligible" per the text-leaf rule: nothing but inline-formatting
  // markup (or nothing at all) sits below this element, so it renders like
  // one row of text rather than a subtree.
  const leafEligible = elementChildren.length === 0 || allChildrenInline;
  const text = collapseText(el.textContent);

  let kind: EmbedLayerKind;
  let children: EmbedElementLayer[];
  if (leafEligible && text) {
    // Has real text and nothing but inline markup below it — collapses to a
    // text row regardless of its own tag (a `<div>Hello</div>` reads as text
    // in a layers panel, not as an empty-looking frame).
    kind = "text";
    children = [];
  } else {
    // Either a real subtree, or leaf-eligible with no text at all (e.g. an
    // empty `<div>` or a void element like `<img>`) — keep the tag's own
    // kind mapping in both cases.
    kind = tagKind(tag);
    children = leafEligible
      ? []
      : elementChildren.map((child) => buildRow(child, root, shadowPrefixStr));
  }

  const sourcePath = buildElementPath(el, root, { anchorOnId: false });

  return {
    sourcePath,
    shadowPath: joinPrefixed(shadowPrefixStr, sourcePath),
    tagName: tag,
    name: resolveName(el, tag, kind, text),
    kind,
    hidden: isInlineHidden(el),
    children,
  };
}

/** Shared by `buildEmbedLayerTree` (computed once per call from the raw
 * html string, then threaded through `buildRow`) and the public
 * `sourcePathToShadowPath` — both just need `hasBodyTargetedStyles`'s
 * verdict on the source. Deliberately takes the *raw* html string, not
 * anything derived from the parsed document: `doc.body.innerHTML` for a
 * `<body>...</body>` source never contains a literal `<body` tag (the
 * parser consumes it into the document structure), so re-deriving from the
 * parsed tree would silently lose the very signal this is checking for. */
function shadowPrefix(bodyHasTargetedStyles: boolean): string {
  return bodyHasTargetedStyles
    ? `${CONTENT_CONTAINER_SEGMENT} > ${SYNTHETIC_BODY_SEGMENT}`
    : CONTENT_CONTAINER_SEGMENT;
}

function joinPrefixed(prefix: string, sourcePath: string): string {
  return sourcePath ? `${prefix} > ${sourcePath}` : prefix;
}

/**
 * Parse `html` and build the layers tree for its `<body>`'s element
 * descendants, in document order. Returns `[]` for unparseable input —
 * `DOMParser` in practice never throws (it produces an error document
 * instead), but this stays defensive since callers feed it live-edited
 * embed source.
 */
export function buildEmbedLayerTree(html: string): EmbedElementLayer[] {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [];
  }

  const root = doc.body;
  if (!root) return [];

  const shadowPrefixStr = shadowPrefix(hasBodyTargetedStyles(html));
  return visibleElementChildren(root).map((el) => buildRow(el, root, shadowPrefixStr));
}

/**
 * Prefix a source-relative path (as produced by `buildEmbedLayerTree`'s
 * `sourcePath`) with the synthetic mount wrappers, turning it into the
 * shadow-relative form the picker/properties/highlight pipeline speaks —
 * the inverse of `shadowPathToSourcePath`. An empty `sourcePath` (the
 * source `<body>` itself) yields just the prefix, matching
 * `shadowPathToSourcePath`'s own `""` convention.
 */
export function sourcePathToShadowPath(sourcePath: string, html: string): string {
  return joinPrefixed(shadowPrefix(hasBodyTargetedStyles(html)), sourcePath);
}

/**
 * Canonicalize any shadow path (possibly `#id`-anchored, as a freshly-picked
 * element's path can be) to the positional `sourcePath` form used as row
 * identity. Returns `null` when the path doesn't translate
 * (`shadowPathToSourcePath` rejects it) or doesn't resolve against `html`'s
 * parsed `<body>` (stale path — element renamed/removed/reordered since).
 */
export function normalizeShadowPathToSourcePath(shadowPath: string, html: string): string | null {
  const sourcePath = shadowPathToSourcePath(shadowPath);
  if (sourcePath === null) return null;
  if (sourcePath === "") return "";

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }

  const root = doc.body;
  if (!root) return null;

  const resolved = resolveElementPath(root, sourcePath);
  if (!resolved) return null;

  return buildElementPath(resolved, root, { anchorOnId: false });
}

/** Cap on `getEmbedLayerTree`'s memo cache — see that function's doc
 * comment for why 8 and why eviction is insertion-order rather than LRU. */
const EMBED_LAYER_TREE_CACHE_MAX = 8;
const embedLayerTreeCache = new Map<string, EmbedElementLayer[]>();

/**
 * Memoized wrapper around `buildEmbedLayerTree`, keyed by the raw html
 * string. The layers panel re-renders on every scene/selection change, not
 * just when an embed's own html changes, and without this it would re-parse
 * every EXPANDED embed's html with a fresh `DOMParser` on each of those
 * renders. Capped at a small size rather than caching every embed html ever
 * seen in a session — an editing session can produce arbitrarily many
 * distinct html strings (one per `edit_embed_html` call), and each cache
 * entry holds a full parsed tree, so an unbounded cache would leak memory
 * over a long session. 8 comfortably covers "the embeds currently expanded
 * in the panel" for any layout a user would plausibly have on screen at
 * once. Eviction is oldest-inserted (a plain `Map` iterates in insertion
 * order), not true LRU — cheap to implement and good enough here, since an
 * expanded embed is re-requested on every panel render, so it keeps getting
 * re-inserted... but a `Map.set` on an EXISTING key does not move it to the
 * end of iteration order, so a currently-expanded, frequently-hit embed can
 * still be the "oldest" by insertion time and get evicted before a
 * long-untouched one. That's an acceptable trade for the simplicity here:
 * eviction only costs one re-parse (a cache miss), never a correctness bug.
 */
export function getEmbedLayerTree(html: string): EmbedElementLayer[] {
  const cached = embedLayerTreeCache.get(html);
  if (cached) return cached;

  const tree = buildEmbedLayerTree(html);
  embedLayerTreeCache.set(html, tree);
  if (embedLayerTreeCache.size > EMBED_LAYER_TREE_CACHE_MAX) {
    const oldestKey = embedLayerTreeCache.keys().next().value;
    if (oldestKey !== undefined) embedLayerTreeCache.delete(oldestKey);
  }
  return tree;
}

/**
 * Build an `EmbedElementSelection` straight from the SOURCE html string,
 * for a layers-panel row click when the owning embed isn't currently
 * mounted (no shadow root to read a live element from — see `LayerItem`'s
 * embed-element click handler, which prefers `findLiveEmbedElement` and
 * only falls back to this). `sourcePath` is the row's own identity, exactly
 * as produced by `buildEmbedLayerTree`.
 *
 * The returned `path` is deliberately the SHADOW-relative form
 * (`sourcePathToShadowPath`), not the raw `sourcePath` — `EmbedElementSelection.path`
 * is consumed everywhere else (the highlight overlay, `applyEmbedElementEdit`,
 * the live picker) as a shadow-relative path, so a source-relative one here
 * would silently fail to resolve against the live DOM the moment the embed
 * does mount.
 *
 * Returns `null` when `sourcePath` doesn't resolve against `html`'s parsed
 * `<body>` — a stale row from a since-edited tree — mirroring every other
 * path-resolution function in this module.
 */
export function buildSourceEmbedElementSelection(
  html: string,
  sourcePath: string,
  embedId: string,
): EmbedElementSelection | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }

  const root = doc.body;
  if (!root) return null;

  const el = sourcePath === "" ? root : resolveElementPath(root, sourcePath);
  if (!el) return null;

  return {
    ...describeEmbedElement(el, root, embedId),
    path: sourcePathToShadowPath(sourcePath, html),
  };
}
