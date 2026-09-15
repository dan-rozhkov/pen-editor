/**
 * Read/write helpers for the embed element properties panel.
 *
 * `embedElementPicker.ts` gives us a CSS path to a picked element that is
 * relative to the *live* ShadowRoot an embed's HTML gets mounted into
 * (`EmbedLayer.tsx`). That path is not usable against the embed node's own
 * `htmlContent` string directly: `mountHtmlWithBodyStyles` (in
 * `embedHtmlUtils.ts`) inserts synthetic wrapper nodes between the shadow
 * root and the author's actual markup — a container `<div>` (the shadow
 * root's sole child) and, when the source HTML has body-targeted styles, a
 * synthetic `<body>` inside it. This module's job is to see through both
 * layers: translate a shadow-relative path into one that resolves against
 * the *source* html's own `<body>`, then read/write against a live element
 * or a source-html string using that translated path.
 *
 * Kept DOM-only (no React/Zustand) so it's testable against plain DOM trees,
 * matching `embedElementPicker.ts`.
 */

import { buildElementPath, resolveElementPath } from "./embedElementPicker";
import { hasOpenTag, parseEmbedHtml, serializeEmbedDoc } from "./embedHtmlDocument";
import { cssColorToHex, isTransparentColor } from "./htmlToDesign/colorParsing";

export interface EmbedElementStyleSnapshot {
  tagName: string;
  elementId?: string;
  classes: string[];
  /** rendered box size, CSS px */
  width: number;
  height: number;
  display: string;
  flexDirection: string;
  gap: number; // px, 0 when "normal"
  alignItems: string;
  justifyContent: string;
  padding: { top: number; right: number; bottom: number; left: number };
  opacity: number; // 0..1
  borderRadius: number; // px (top-left corner)
  backgroundColor: string; // "#rrggbb"; "" when fully transparent
  borderWidth: number; // px (top edge)
  borderColor: string; // "#rrggbb"
  borderStyle: string; // "none" | "solid" | ...
  fontSize: number; // px
  fontWeight: number;
  lineHeight: number; // px; 0 when "normal"
  letterSpacing: number; // px; 0 when "normal"
  textAlign: string;
  color: string; // "#rrggbb"
  /** Element's text, when it has no child ELEMENTS (only text nodes); null otherwise. */
  text: string | null;
}

/** Parse a `<n>px` (or unitless) computed-style string, falling back to 0 for
 * anything that doesn't parse — happy-dom and real browsers both hand back
 * keyword values ("normal", "auto", "") in plenty of cases we don't want to
 * treat as errors, and a NaN leaking into a numeric field would be worse
 * than a slightly-wrong 0 in a properties panel. */
function parsePx(value: string | undefined | null): number {
  if (!value) return 0;
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
}

/** "normal" is the initial value for both `line-height` and
 * `letter-spacing`; the panel has no "normal" concept, so it's reported as
 * 0 (the same "unset" signal padding/gap use). */
function parseNormalOrPx(value: string | undefined | null): number {
  if (!value || value === "normal") return 0;
  return parsePx(value);
}

/**
 * Convert a computed color string to `#rrggbb`.
 *
 * `getComputedStyle` resolves most colors to `rgb()`/`rgba()`, but NOT all of
 * them: Chrome preserves the modern color functions verbatim, so an element
 * authored in `oklch(...)`/`lab(...)`/`color(display-p3 …)` (or a
 * `color-mix()`, which resolves to `oklab(...)`) comes back in that syntax.
 * Showcase HTML is full of OKLCH, so a naive rgb-only regex would report
 * "no color set" for a swatch that is plainly painted. `cssColorToHex`
 * already handles every one of those through the browser's own colour
 * parser, and `isTransparentColor` is the shared notion of "nothing painted"
 * — reuse both instead of growing a second, weaker parser here.
 *
 * A fully transparent colour comes back as `""` rather than `#000000`:
 * "no colour set" and "black" are different facts and the panel needs to
 * tell them apart.
 */
function parseColor(value: string | undefined | null): string {
  if (!value || isTransparentColor(value)) return "";
  const hex = cssColorToHex(value.trim());
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : "";
}

/** `font-weight` computes to a numeric string in every modern engine, but
 * some environments (older happy-dom builds among them) still hand back the
 * `normal`/`bold` keywords — map those explicitly rather than letting them
 * fall through to the NaN branch. */
function parseFontWeight(value: string | undefined | null): number {
  if (value === "bold") return 700;
  if (value === "normal" || !value) return 400;
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? 400 : n;
}

/** Tags that can never carry child text nodes. `<textarea>`/`<option>` are
 * deliberately absent: their text content IS their value and serializes
 * normally. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Snap a snapshot from the LIVE element (`getComputedStyle` +
 * `getBoundingClientRect`). Never touches the source html string — that's
 * `applyEmbedElementEdit`'s job. */
export function readEmbedElementSnapshot(el: Element): EmbedElementStyleSnapshot {
  const cs = getComputedStyle(el);

  // `offsetWidth`/`offsetHeight`, NOT `getBoundingClientRect()`: an embed's
  // content container carries `transform: scale(viewportZoom)`
  // (`EmbedLayer`'s `syncContentScale`), and a client rect is measured in
  // post-transform SCREEN pixels. At 200% zoom a 100px element would read
  // 200, and writing that number straight back as `width: 200px` would
  // double the element on the first nudge. The offset box is the untransformed
  // layout box, so it round-trips with the `px` we write. Both are 0 in a
  // DOM-only test environment that never runs layout, and for non-replaced
  // inline elements — fall back to the computed values there.
  const layoutWidth = el instanceof HTMLElement ? el.offsetWidth : 0;
  const layoutHeight = el instanceof HTMLElement ? el.offsetHeight : 0;
  const width = layoutWidth || parsePx(cs.width);
  const height = layoutHeight || parsePx(cs.height);

  // Prefer the `gap` shorthand getter (widely supported, and the only one
  // happy-dom actually populates from an inline `gap:` declaration — it
  // doesn't expand `gap` into the `row-gap`/`column-gap` longhands the way a
  // real browser's CSSOM does). Fall back to the longhands for engines where
  // `gap` itself comes back empty but the expanded longhands are set.
  const gapRaw = cs.gap || cs.columnGap || cs.rowGap;

  return {
    tagName: el.tagName.toLowerCase(),
    ...(el.id ? { elementId: el.id } : {}),
    classes: el.classList ? Array.from(el.classList) : [],
    width,
    height,
    display: cs.display,
    flexDirection: cs.flexDirection,
    gap: parseNormalOrPx(gapRaw),
    alignItems: cs.alignItems,
    justifyContent: cs.justifyContent,
    padding: {
      top: parsePx(cs.paddingTop),
      right: parsePx(cs.paddingRight),
      bottom: parsePx(cs.paddingBottom),
      left: parsePx(cs.paddingLeft),
    },
    opacity: Number.isNaN(Number.parseFloat(cs.opacity)) ? 1 : Number.parseFloat(cs.opacity),
    borderRadius: parsePx(cs.borderTopLeftRadius),
    backgroundColor: parseColor(cs.backgroundColor),
    borderWidth: parsePx(cs.borderTopWidth),
    borderColor: parseColor(cs.borderTopColor),
    borderStyle: cs.borderTopStyle || "none",
    fontSize: parsePx(cs.fontSize),
    fontWeight: parseFontWeight(cs.fontWeight),
    lineHeight: parseNormalOrPx(cs.lineHeight),
    letterSpacing: parseNormalOrPx(cs.letterSpacing),
    textAlign: cs.textAlign,
    color: parseColor(cs.color),
    // Void/replaced elements are reported as having NO editable text even
    // though they trivially have no element children: setting `textContent`
    // on an `<img>`/`<input>`/`<br>` mutates a DOM node whose serialization
    // never emits children, so the edit would vanish on the way back into
    // the html while the panel showed it as applied.
    text: el.children.length === 0 && !VOID_TAGS.has(el.tagName.toLowerCase())
      ? (el.textContent ?? "")
      : null,
  };
}

/** The container `<div>` `EmbedHost` (`EmbedLayer.tsx`) appends as the
 * ShadowRoot's sole child, and the `nth-of-type` segment `buildElementPath`
 * always produces for it — every non-id-anchored shadow path starts here.
 * Exported so `embedLayerTree.ts` can build shadow paths without retyping
 * the literal (a jscpd duplication gate runs in CI). */
export const CONTENT_CONTAINER_SEGMENT = "div:nth-of-type(1)";

/** The segment for the synthetic `<body>` `mountHtmlWithBodyStyles` creates
 * inside the container when the source html has body-targeted styles (see
 * that function's doc comment). It's always the container's first (and, in
 * practice, only) `<body>`-tagged child. Exported for the same reason as
 * `CONTENT_CONTAINER_SEGMENT` above. */
export const SYNTHETIC_BODY_SEGMENT = "body:nth-of-type(1)";

/**
 * Translate a shadow-relative path (as produced by `buildElementPath`
 * against a `ShadowRoot`) into a path that resolves against the *source*
 * html's own `<body>` — i.e. one `resolveElementPath(doc.body, path)` can
 * consume after `new DOMParser().parseFromString(html, "text/html")`.
 *
 * Two synthetic layers sit between the shadow root and the author's real
 * markup (see the module doc comment), and both must be stripped:
 *
 * 1. The mount container `<div>` — always the first segment, UNLESS the
 *    path is anchored on a `#id` (an id anchor is only ever emitted as the
 *    very first segment by `buildElementPath`, and it uniquely identifies
 *    the element regardless of which synthetic wrappers sit above it — so
 *    there is nothing to strip and the path is returned unchanged).
 * 2. The synthetic `<body>` — present only when `mountHtmlWithBodyStyles`
 *    wrapped the content (body-targeted styles in the source), in which
 *    case it's always the very next segment after the container.
 *
 * What's left maps 1:1 onto the source `<body>`'s own descendant chain,
 * because in both mounting branches the container/synthetic-body's
 * *content* children are copied verbatim from the parsed source body
 * (`container.innerHTML = safeHtml` in the unwrapped case,
 * `body.innerHTML = parsed.body.innerHTML` in the wrapped one) — so child
 * indices line up exactly.
 *
 * Returns `""` (not null) when nothing is left after stripping — that means
 * the path pointed at the container or the synthetic body itself, i.e. the
 * source `<body>` element as a whole; callers resolve that case specially
 * (see `applyEmbedElementEdit`). Returns `null` for an empty or malformed
 * path (anything not starting with the expected container segment or a
 * `#id` anchor) — there's nothing sensible to translate.
 */
export function shadowPathToSourcePath(shadowPath: string): string | null {
  if (!shadowPath) return null;

  const segments = shadowPath.split(" > ");
  const [first, ...rest] = segments;

  if (first.startsWith("#")) return shadowPath;
  if (first !== CONTENT_CONTAINER_SEGMENT) return null;

  const remaining = rest[0] === SYNTHETIC_BODY_SEGMENT ? rest.slice(1) : rest;
  return remaining.join(" > ");
}

/**
 * Look up the live ShadowRoot an embed's HTML is mounted into, by embed id.
 * Shared by `findLiveEmbedElement` below and the layers panel (`LayerItem`),
 * which needs the root itself (not just an element resolved against it) to
 * call `describeEmbedElement`.
 */
export function findEmbedShadowRoot(embedId: string): ShadowRoot | null {
  try {
    const host = document.querySelector<HTMLElement>(`[data-embed-id="${CSS.escape(embedId)}"]`);
    return host?.shadowRoot ?? null;
  } catch {
    return null;
  }
}

/**
 * Find the live element a picker path refers to, inside the shadow DOM an
 * embed's HTML is mounted into. Takes the PICKER path (shadow-relative, not
 * translated) — this walks the same live tree `buildElementPath` walked
 * when the path was created, mirroring `EmbedElementHighlight.tsx`'s own
 * host/shadow-root lookup.
 */
export function findLiveEmbedElement(embedId: string, shadowPath: string): Element | null {
  const root = findEmbedShadowRoot(embedId);
  if (!root) return null;
  try {
    return resolveElementPath(root, shadowPath);
  } catch {
    return null;
  }
}

export interface EmbedElementEdit {
  /** CSS declarations for the element's inline style. `null`/`""` removes
   * the property. Keys are kebab-case ("background-color"). */
  styles?: Record<string, string | null>;
  /** Replaces the element's text content. */
  text?: string;
}

/**
 * Apply an edit to the element at `shadowPath` inside `html` (an embed
 * node's `htmlContent`, NOT the live DOM), returning the updated html plus
 * the changed element's own `outerHTML`. Returns `null` — leaving `html`
 * untouched — when the path doesn't resolve to anything, so a stale path
 * (element removed/reordered since the path was picked) can never silently
 * edit the wrong element.
 *
 * Serialization deliberately preserves the *shape* of the original string
 * (full document / body-only fragment / bare fragment) rather than always
 * emitting one canonical shape — see `serializeEmbedDoc`'s doc comment
 * (`embedHtmlDocument.ts`) for why that's a hard invariant here.
 */
export function applyEmbedElementEdit(
  html: string,
  shadowPath: string,
  edit: EmbedElementEdit,
): { html: string; outerHtml: string } | null {
  const sourcePath = shadowPathToSourcePath(shadowPath);
  if (sourcePath === null) return null;

  const doc = parseEmbedHtml(html);
  if (!doc) return null;

  // "" means the path pointed at the container/synthetic-body wrapper
  // itself — i.e. the source <body> as a whole (see shadowPathToSourcePath).
  // That is only writable when the source string actually HAS a <body>/<html>
  // wrapper to serialize back into: the bare-fragment branch below emits
  // `doc.body.innerHTML`, which drops everything set on <body> on the floor.
  // Returning null (rather than a "successful" edit whose html is byte-identical
  // to the input) is what stops the panel from optimistically showing a change
  // that was never written, and stops a fabricated <body> wrapper from being
  // handed to the agent as the picked element's preview.
  if (sourcePath === "" && !hasOpenTag(html, "body") && !hasOpenTag(html, "html")) {
    return null;
  }
  const target: HTMLElement | null =
    sourcePath === "" ? doc.body : (resolveElementPath(doc.body, sourcePath) as HTMLElement | null);
  if (!target) return null;

  if (edit.styles) {
    for (const [prop, value] of Object.entries(edit.styles)) {
      if (value == null || value === "") {
        target.style.removeProperty(prop);
      } else {
        target.style.setProperty(prop, value);
      }
    }
    // Never leave a decorative empty `style=""` behind — it's noise in the
    // serialized html and would make an otherwise-untouched element look
    // edited.
    if (target.style.length === 0 && target.hasAttribute("style")) {
      target.removeAttribute("style");
    }
  }

  if (edit.text !== undefined) {
    target.textContent = edit.text;
  }

  const outerHtml = target.outerHTML;
  return { html: serializeEmbedDoc(html, doc), outerHtml };
}

/**
 * Translate a shadow-relative path that was resolved AGAINST the source
 * html (i.e. the inverse of `shadowPathToSourcePath`): re-prepend whatever
 * synthetic-wrapper prefix `shadowPathToSourcePath` stripped off
 * `originalShadowPath`, so a freshly-computed source path (e.g. from
 * `buildElementPath(target, doc.body)` after a reorder) becomes a path
 * that resolves against the live shadow DOM again via
 * `findLiveEmbedElement`/`resolveElementPath`.
 *
 * The prefix is derived from `originalShadowPath` alone — never from
 * `newSourcePath` — because it records a fact about how THIS embed's html
 * is mounted (container div, plus a synthetic `<body>` iff the source has
 * body-targeted styles), which doesn't change just because the element
 * moved. The one exception is when `newSourcePath` is itself id-anchored:
 * `shadowPathToSourcePath` treats a `#id` anchor as already resolving
 * identically under both the shadow root and the source `<body>` (nothing
 * was ever stripped for it), so it's returned unchanged rather than
 * prefixed — prefixing it would produce an unresolvable path.
 */
export function sourcePathToShadowPath(originalShadowPath: string, newSourcePath: string): string {
  if (newSourcePath.startsWith("#")) return newSourcePath;

  const segments = originalShadowPath.split(" > ");
  const first = segments[0];
  if (!first || first.startsWith("#") || first !== CONTENT_CONTAINER_SEGMENT) {
    // The original path was itself an id anchor (nothing was ever stripped
    // off it) or malformed — either way there's no synthetic prefix to
    // reattach.
    return newSourcePath;
  }

  const hasSyntheticBody = segments[1] === SYNTHETIC_BODY_SEGMENT;
  const prefix = hasSyntheticBody
    ? `${CONTENT_CONTAINER_SEGMENT} > ${SYNTHETIC_BODY_SEGMENT}`
    : CONTENT_CONTAINER_SEGMENT;
  return newSourcePath ? `${prefix} > ${newSourcePath}` : prefix;
}

/**
 * Move the element at `shadowPath` to just before the element at
 * `beforeShadowPath` (or to the end of its parent, when `beforeShadowPath`
 * is `null`) inside `html` — the DOM-mutation half of the embed element
 * sortable drag (see `embedElementSortable.ts` for the "where would it go"
 * half). Returns `null` — leaving `html` untouched — when:
 *
 * - either path fails to resolve (stale path);
 * - the target resolves to the source `<body>` itself, or `beforeShadowPath`
 *   does — the body can't be reordered relative to its own children, and
 *   isn't one of them (mirrors `applyEmbedElementEdit`'s "" source-path
 *   handling);
 * - the target and the `before` element don't share a parent in the parsed
 *   document — a stale `beforeShadowPath` computed before some other edit
 *   reshuffled the tree could otherwise silently reparent the element
 *   instead of just reordering it, which this function never does;
 * - the move is a no-op BY RAW DOM ADJACENCY (the element's next sibling in
 *   the parsed document is already `beforeEl`) — a no-op "successful" write
 *   would be indistinguishable from an actual move to a caller that only
 *   checks for `null`, and the drag gesture relies on `null` here meaning
 *   "just revert the visual-only transform, there's nothing to commit".
 *   This check is deliberately mechanical, unlike `isNoOpSlot` in
 *   `embedElementSortable.ts`: a `DOMParser` document has no layout or
 *   `getComputedStyle`, so this function has no way to know which siblings
 *   are in-flow and which aren't — only the live shadow DOM does. The drag
 *   gesture is expected to have already called `isNoOpSlot` against the live
 *   DOM before ever reaching this function, so by the time `beforeShadowPath`
 *   gets here it always names an in-flow candidate (or is `null`), and raw
 *   adjacency and in-flow adjacency agree.
 */
export function applyEmbedElementReorder(
  html: string,
  shadowPath: string,
  beforeShadowPath: string | null,
): { html: string; outerHtml: string; newPath: string } | null {
  const sourcePath = shadowPathToSourcePath(shadowPath);
  if (sourcePath === null || sourcePath === "") return null;

  const beforeSourcePath = beforeShadowPath === null ? null : shadowPathToSourcePath(beforeShadowPath);
  if (beforeShadowPath !== null && (beforeSourcePath === null || beforeSourcePath === "")) {
    return null;
  }

  const doc = parseEmbedHtml(html);
  if (!doc) return null;

  const target = resolveElementPath(doc.body, sourcePath) as HTMLElement | null;
  if (!target) return null;

  const beforeEl =
    beforeSourcePath === null ? null : (resolveElementPath(doc.body, beforeSourcePath) as HTMLElement | null);
  if (beforeSourcePath !== null && !beforeEl) return null;
  if (beforeEl === target) return null;

  const parent = target.parentNode;
  if (!parent) return null;
  if (beforeEl && beforeEl.parentNode !== parent) return null;

  const alreadyAtSlot = beforeEl
    ? target.nextElementSibling === beforeEl
    : target.nextElementSibling === null;
  if (alreadyAtSlot) return null;

  parent.insertBefore(target, beforeEl);

  const outerHtml = target.outerHTML;
  const newSourcePath = buildElementPath(target, doc.body);
  const newPath = sourcePathToShadowPath(shadowPath, newSourcePath);

  return { html: serializeEmbedDoc(html, doc), outerHtml, newPath };
}
