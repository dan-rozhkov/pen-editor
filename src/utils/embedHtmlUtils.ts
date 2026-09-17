/**
 * Shared utilities for mounting HTML with body-targeted styles into containers.
 * Used by InlineEmbedEditor, htmlToDesignNodes, and htmlTextureHelpers.
 */

import { sanitizeEmbedHtml } from "./sanitizeEmbedHtml";
import { ensureExternalFontStylesLoaded } from "./fontStylesheets";
import { splitSelectorList as splitSelectorListRaw } from "@/lib/htmlToDesign/cssScoping";

/** Inherited typography baseline shared by the live Shadow-DOM embed and the
 * isolated iframe used by Convert to design. Source CSS can override it. */
export const EMBED_DEFAULT_LINE_HEIGHT = "1.5";

export function applyEmbedInheritedDefaults(element: HTMLElement): void {
  element.style.lineHeight = EMBED_DEFAULT_LINE_HEIGHT;
}

/**
 * Neutralizes the user-agent styles that leak into embed content.
 *
 * Embeds mount into a Shadow root (and, for Convert to design, into a bare
 * iframe), so nothing the app's own reset does reaches them: a `<button>` the
 * embed's CSS doesn't style renders with Chromium's `border: 2px outset`,
 * `font-family: Arial` and grey ButtonFace — a system widget dropped into a
 * design set in its own typeface. It showed up as a bevelled ring around a
 * showcase screen's CTA and an Arial label inside it.
 *
 * The mechanism is a CASCADE LAYER: unlayered author declarations beat layered
 * ones regardless of specificity or order, so this can only ever fill in where
 * the embed said nothing. `padding`/`text-align` on buttons and the appearance
 * of checkbox/radio/range/color/file inputs are deliberately left to the UA —
 * designs lean on that centering, and those inputs ARE the native widget.
 */
export const EMBED_UA_RESET_CSS = `@layer embed-ua-reset {
  button, input, select, textarea {
    font: inherit;
    letter-spacing: inherit;
    color: inherit;
    background: none;
    border: 0;
    border-radius: 0;
  }
  button, textarea,
  input:not([type]), input[type="text"], input[type="search"], input[type="email"],
  input[type="password"], input[type="number"], input[type="tel"], input[type="url"],
  input[type="date"], input[type="time"], input[type="datetime-local"],
  input[type="month"], input[type="week"],
  input[type="submit"], input[type="button"], input[type="reset"] {
    -webkit-appearance: none;
    appearance: none;
  }
  button { cursor: pointer; }
  textarea { resize: none; }
  /* beginElementEdit (EmbedLayer.tsx) puts the picked element into
     contenteditable, and Chromium/WebKit then draw their default focus ring
     on it like on any editable region — a stray blue rectangle around the
     text instead of the app's own selection chrome. In practice this only
     ever matches that element: nothing strips contenteditable from embed
     content (sanitizeEmbedHtml leaves it), so an embed whose own HTML uses
     the attribute would lose its focus ring too — but being layered, such an
     embed's own :focus outline still wins over this rule. */
  [contenteditable]:focus, [contenteditable]:focus-visible { outline: none; }
}`;

/** Puts the UA reset FIRST in the mount container. Position is cosmetic — a
 * layered rule loses to every unlayered one wherever it sits — but it keeps
 * the embed's own `<style>` blocks reading as the top of the document. */
function prependUaReset(container: HTMLElement): void {
  const style = document.createElement("style");
  style.setAttribute("data-embed-ua-reset", "");
  style.textContent = EMBED_UA_RESET_CSS;
  container.insertBefore(style, container.firstChild);
}

/** Detect whether HTML contains `<body>` tags or CSS selectors targeting `html`/`body`. */
export function hasBodyTargetedStyles(html: string): boolean {
  if (/<body[\s>]/i.test(html)) return true;
  return /(^|[^\w-])(html|body)\s*(,|\{)/im.test(html);
}

export interface MountResult {
  root: HTMLElement;
  wrappedBody: boolean;
  originalHasBodyTag: boolean;
}

function splitSelectorList(selectorText: string): string[] {
  return splitSelectorListRaw(selectorText).filter(Boolean);
}

function selectorTargetsGlobalRoot(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  return (
    trimmed === ":root" ||
    trimmed === "html" ||
    trimmed.startsWith(":root ") ||
    trimmed.startsWith(":root>") ||
    trimmed.startsWith(":root+") ||
    trimmed.startsWith(":root~") ||
    trimmed.startsWith("html ") ||
    trimmed.startsWith("html>") ||
    trimmed.startsWith("html+") ||
    trimmed.startsWith("html~")
  );
}

function collectRootCustomPropertiesFromRules(
  rules: CSSRuleList | CSSRule[],
  target: Map<string, string>,
): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const selectors = splitSelectorList(rule.selectorText);
      if (!selectors.some(selectorTargetsGlobalRoot)) continue;

      for (let i = 0; i < rule.style.length; i++) {
        const propName = rule.style.item(i);
        if (!propName.startsWith("--")) continue;
        const value = rule.style.getPropertyValue(propName);
        const priority = rule.style.getPropertyPriority(propName);
        target.set(
          propName,
          priority ? `${value.trim()} !important` : value.trim(),
        );
      }
      continue;
    }

    if (rule instanceof CSSMediaRule) {
      if (window.matchMedia(rule.conditionText).matches) {
        collectRootCustomPropertiesFromRules(rule.cssRules, target);
      }
      continue;
    }

    if (rule instanceof CSSSupportsRule) {
      collectRootCustomPropertiesFromRules(rule.cssRules, target);
    }
  }
}

/**
 * Harvests every `:root`/`html`/`:host` custom-property declaration out of
 * `container`'s `<style>` tags — the embed's OWN authored values, as opposed
 * to anything the editor's Variables tab has overridden on top. Factored out
 * of `applyGlobalRootCustomProperties` (which just inline-sets the result
 * once, at mount) so it can be re-run later: `applyEditorVariableProperties`
 * needs this exact harvest as the fallback when an editor variable is
 * removed or renamed, so the embed's own declaration for that name keeps
 * working instead of the property just vanishing.
 */
export function collectAuthoredRootCustomProperties(container: HTMLElement): Map<string, string> {
  const customProperties = new Map<string, string>();
  const styleTags = container.querySelectorAll("style");

  for (const styleTag of styleTags) {
    const cssText = styleTag.textContent;
    if (!cssText) continue;

    const sheet = new CSSStyleSheet();
    try {
      sheet.replaceSync(cssText);
    } catch {
      continue;
    }

    collectRootCustomPropertiesFromRules(sheet.cssRules, customProperties);
  }

  return customProperties;
}

function applyGlobalRootCustomProperties(container: HTMLElement, root: HTMLElement): void {
  const customProperties = collectAuthoredRootCustomProperties(container);
  for (const [name, value] of customProperties) {
    root.style.setProperty(name, value);
  }
}

/**
 * Which editor-variable custom-property names `applyEditorVariableProperties`
 * most recently set on a given mounted root element. Keyed by the ROOT
 * `mountHtmlWithBodyStyles` returned (the synthetic `<body>` for a
 * body-targeted embed, or the container itself otherwise) rather than by
 * embed id: it needs no explicit cleanup on unmount (a `WeakMap` entry for a
 * detached element is simply unreachable and gets collected), and it can
 * only ever describe properties THIS helper is responsible for reverting —
 * never a property the embed's own markup happens to also declare on
 * `:root`, which `applyEditorVariableProperties` must leave untouched.
 */
const appliedEditorVariableNames = new WeakMap<HTMLElement, Set<string>>();

/**
 * For a given mounted root, the custom-property value that was already
 * sitting INLINE on `root` the first time `applyEditorVariableProperties`
 * was about to overwrite it — captured before that first overwrite, so it
 * survives even though the overwrite itself immediately replaces it. `null`
 * means "captured, and there was nothing there" (still a real capture: it
 * tells the revert path below not to bother re-checking), as opposed to "no
 * entry" which means this name has never been touched by this function.
 *
 * Exists for a body-targeted embed: `mountHtmlWithBodyStyles` copies the
 * AUTHOR's own `<body style="--brand:#111">` inline declaration onto the
 * synthetic body it creates as `root`. Without this capture, the first
 * `applyEditorVariableProperties` call overwrites that authored inline
 * value with the editor's, and reverting later (variable deleted/renamed)
 * had only `collectAuthoredRootCustomProperties`'s `<style>`-tag harvest to
 * fall back to — which finds nothing for a value the author wrote inline
 * rather than in a `:root` rule, so the property just vanished instead of
 * returning to what the author wrote, until the embed was remounted from
 * scratch. Keyed by `root` for the same reason `appliedEditorVariableNames`
 * is (see its own comment) and cleared together with it, so a name that
 * this function stops touching (reverted, then never reapplied) can be
 * re-captured cleanly if it's touched again later.
 */
const originalInlineValuesByRoot = new WeakMap<HTMLElement, Map<string, string | null>>();

/**
 * Applies (and live-updates) an embed's editor-defined CSS custom
 * properties on its mounted content root, as INLINE custom properties —
 * without touching `htmlContent` or remounting anything. `EmbedLayer.tsx`
 * calls this both right after `mountHtmlWithBodyStyles` (first paint) and
 * again from a `useVariableStore.subscribe` effect on every later Variables-
 * tab edit, so the mounted root is always the single source of truth for
 * "what does the editor currently say this variable is" — deliberately
 * INSTEAD of baking a `<style>:root{...}</style>` block into the HTML
 * string at mount time (an earlier version of the mount effect did that):
 * such a block becomes permanent literal markup inside `container`,
 * indistinguishable on a later harvest from an authored `:root` rule the
 * embed's own HTML genuinely declares — and this function needs to tell the
 * two apart (see below).
 *
 * Editor values always win over the embed's own authored `:root`
 * declarations — an inline custom property on `root` outranks any `<style>`
 * rule regardless of specificity — but a name that drops OUT of `vars` since
 * the previous call (a deleted or renamed variable) is not left dangling at
 * its last editor value. The revert order is: (1) whatever inline value
 * `root` itself carried for that name BEFORE this function's first-ever
 * overwrite of it (`originalInlineValuesByRoot` — covers a body-targeted
 * embed's author-written `<body style="--brand:...">`, which
 * `collectAuthoredRootCustomProperties` below can never see since it only
 * harvests `<style>` tags), then (2) whatever `container`'s own authored
 * `:root` `<style>` block declares for that name, then (3) removed from
 * `root` entirely when neither source has it. Reverting is scoped to names
 * THIS function previously applied (tracked in `appliedEditorVariableNames`),
 * so it never touches a custom property the embed's own CSS is independently
 * responsible for.
 *
 * `container` must be the element `mountHtmlWithBodyStyles` mounted the
 * embed's own (unmodified) HTML into — its `<style>` tags are what
 * `collectAuthoredRootCustomProperties` harvests as the fallback — and
 * `root` the `MountResult.root` that same mount call returned for it; they
 * may be different elements (a body-targeted embed's styles land on a
 * synthetic `<body>` nested inside `container`), and pairing `root` from one
 * mount with `container` from another would harvest the wrong subtree's
 * authored values.
 */
export function applyEditorVariableProperties(
  container: HTMLElement,
  root: HTMLElement,
  vars: Map<string, string>,
): void {
  const previouslyApplied = appliedEditorVariableNames.get(root);
  // Only harvest authored values when a name is actually about to be
  // REVERTED (dropped from `vars` since the previous call) — re-parsing
  // every `<style>` tag in the embed via `collectAuthoredRootCustomProperties`
  // (a full CSSOM parse per tag) is expensive, and `previouslyApplied.size >
  // 0` alone is true on nearly every call, including a plain value update
  // where nothing is being reverted at all. `EmbedLayer.tsx` mounts EVERY
  // visible embed and re-runs this on every `useVariableStore` mutation, so
  // an unconditional harvest here means dragging a single color slider
  // re-parses every `<style>` tag of every mounted embed on every
  // pointermove — one full CSS re-parse per embed per animation frame.
  const hasNameToRevert =
    previouslyApplied != null && [...previouslyApplied].some((name) => !vars.has(name));
  const authored = hasNameToRevert ? collectAuthoredRootCustomProperties(container) : null;

  if (previouslyApplied) {
    const originalInline = originalInlineValuesByRoot.get(root);
    for (const name of previouslyApplied) {
      if (vars.has(name)) continue; // still supplied below — overwritten, not reverted
      const capturedInline = originalInline?.get(name);
      const authoredValue = authored?.get(name);
      if (capturedInline != null) root.style.setProperty(name, capturedInline);
      else if (authoredValue != null) root.style.setProperty(name, authoredValue);
      else root.style.removeProperty(name);
    }
  }

  let originalInline = originalInlineValuesByRoot.get(root);
  for (const [name, value] of vars) {
    // Capture whatever was already inline on `root` for this name the FIRST
    // time (ever, across calls) this function is about to overwrite it —
    // guarded on `!originalInline.has(name)` so a later call, which is
    // overwriting ITS OWN previously-applied editor value rather than an
    // author's, doesn't clobber the real original with that editor value.
    if (!originalInline) {
      originalInline = new Map();
      originalInlineValuesByRoot.set(root, originalInline);
    }
    if (!originalInline.has(name)) {
      const existing = root.style.getPropertyValue(name);
      originalInline.set(name, existing || null);
    }
    root.style.setProperty(name, value);
  }

  appliedEditorVariableNames.set(root, new Set(vars.keys()));
}

/**
 * Force eager, synchronous-decode loading for every `<img>`/`<iframe>` under
 * `root`.
 *
 * WHY: embed HTML is mounted live into a Shadow root (see `EmbedLayer.tsx`),
 * and AI-generated embed markup routinely carries `<img loading="lazy">`
 * (the backend's `/optimize` and `/adapt` skills instruct the model to use
 * it). WebKit (mobile Safari) strictly honours `loading="lazy"` against the
 * browser's *visual* viewport: an embed's DOM host is a synthetic viewport
 * that is frequently entirely off-screen relative to that visual viewport
 * (e.g. a narrow mobile canvas panned away from the embed, or the host
 * positioned far outside 0,0), so WebKit never even issues the network
 * request for those images — they silently never load, while surrounding
 * layout renders fine. Chromium loads them regardless of intersection, so
 * the bug is invisible there. Measured with Playwright (chromium vs webkit):
 * on a 390x844 mobile viewport with the embed host off-screen, webkit loaded
 * 3/6 images (the three `loading="lazy"` ones never issued a request) vs.
 * 6/6 for chromium; even a 1440x900 desktop viewport failed the lowest lazy
 * image. An embed must paint its whole content regardless of intersection
 * with the real browser viewport (pan/zoom, export and screenshots all
 * depend on that), so lazy loading has to be neutralised for embed content.
 * The same off-screen exposure applies to the sole surviving `<iframe>`
 * (the YouTube video fill) that can carry `loading="lazy"` post-sanitization.
 *
 * TRADE-OFF (deliberate): `EmbedLayer` mounts every visible embed with no
 * viewport culling of its own, so this makes an image-heavy document request
 * all embed images up front instead of deferring distant ones. That cost is
 * accepted: a deferred image on this canvas is not "loaded later", it is
 * never loaded at all on WebKit. `decoding="async"` (set only when the author
 * did not ask for a specific decode mode) keeps the extra decodes off the
 * main thread. If embed images ever need throttling, cull at the
 * `EmbedLayer` level rather than by restoring native lazy loading.
 */
/** Marks an element whose `loading` attribute did not exist before
 * `forceEagerImageLoading` added it — `stripForcedEagerImageLoading` removes
 * the attribute entirely for these rather than restoring a value, since
 * there never was one. */
const EAGER_LOADING_ADDED_ATTR = "data-pen-embed-eager-added";
/** Marks an element whose `loading` attribute existed with some OTHER value
 * (author asked for `lazy`, say) before it was overwritten to `"eager"` —
 * the original value is stashed in the attribute's own value so
 * `stripForcedEagerImageLoading` can restore it verbatim. */
const EAGER_LOADING_PREV_ATTR = "data-pen-embed-eager-prev";
/** Marks an `<img>` whose `decoding` attribute `forceEagerImageLoading`
 * added (it only ever does so when the attribute was absent — see below —
 * so unlike `loading` there is no "previously had some other value" case to
 * track). */
const EAGER_DECODING_ADDED_ATTR = "data-pen-embed-decoding-added";

export function forceEagerImageLoading(root: ParentNode): void {
  for (const el of root.querySelectorAll("img, iframe")) {
    const currentLoading = el.getAttribute("loading");
    if (currentLoading !== "eager") {
      if (currentLoading === null) {
        el.setAttribute(EAGER_LOADING_ADDED_ATTR, "1");
      } else {
        el.setAttribute(EAGER_LOADING_PREV_ATTR, currentLoading);
      }
      el.setAttribute("loading", "eager");
    }
    if (el.tagName === "IMG" && !el.hasAttribute("decoding")) {
      el.setAttribute(EAGER_DECODING_ADDED_ATTR, "1");
      el.setAttribute("decoding", "async");
    }
  }
}

/**
 * The inverse of `forceEagerImageLoading`: undoes exactly what that function
 * added or overwrote, restoring every `<img>`/`<iframe>` under `root` to how
 * the author's own markup described it — never touching an element it never
 * marked (an explicit author `loading="eager"`, or one already stripped).
 *
 * WHY THIS EXISTS: `EmbedLayer.tsx`'s single-element text-edit commit reads
 * `innerHTML` off a live DOM subtree that `mountHtmlWithBodyStyles` already
 * ran this forcing pass over. Without undoing it first, `loading="eager"
 * decoding="async"` the author never wrote would ride along into the
 * embed's persisted `htmlContent` on the very next unrelated text edit.
 * Callers MUST run this against a detached clone, never the live element —
 * removing these attributes from the live img/iframe would put it right
 * back into WebKit's off-screen-lazy-load bug this pass exists to avoid.
 */
export function stripForcedEagerImageLoading(root: ParentNode): void {
  for (const el of root.querySelectorAll(`[${EAGER_LOADING_ADDED_ATTR}]`)) {
    el.removeAttribute("loading");
    el.removeAttribute(EAGER_LOADING_ADDED_ATTR);
  }
  for (const el of root.querySelectorAll(`[${EAGER_LOADING_PREV_ATTR}]`)) {
    const prev = el.getAttribute(EAGER_LOADING_PREV_ATTR);
    if (prev != null) el.setAttribute("loading", prev);
    el.removeAttribute(EAGER_LOADING_PREV_ATTR);
  }
  for (const el of root.querySelectorAll(`[${EAGER_DECODING_ADDED_ATTR}]`)) {
    el.removeAttribute("decoding");
    el.removeAttribute(EAGER_DECODING_ADDED_ATTR);
  }
}

/**
 * Mount HTML into a container, creating a synthetic `<body>` element when the
 * HTML contains body-targeted styles. Returns the effective root for content
 * operations and metadata about the mounting.
 */
export function mountHtmlWithBodyStyles(
  container: HTMLElement,
  html: string,
  width: number,
  height: number,
): MountResult {
  const originalHasBodyTag = /<body[\s>]/i.test(html);
  // Hoist allowlisted external font stylesheets (Google Fonts / Phosphor icon
  // fonts) to document level for EVERY shadow-DOM mount. Their class rules apply
  // inside the shadow tree, but Chrome only registers `@font-face` fonts from
  // document-level styles — without this, web/icon fonts render as tofu. Read
  // from the raw `html` because sanitization strips <link> tags below.
  void ensureExternalFontStylesLoaded(html);
  // Embed HTML is untrusted (AI output, pasted markup, shared .pen files) —
  // strip scripts and event handlers before it touches the DOM.
  const safeHtml = sanitizeEmbedHtml(html);
  if (!hasBodyTargetedStyles(html)) {
    container.innerHTML = safeHtml;
    prependUaReset(container);
    applyGlobalRootCustomProperties(container, container);
    forceEagerImageLoading(container);
    return { root: container, wrappedBody: false, originalHasBodyTag: false };
  }

  try {
    const parsed = new DOMParser().parseFromString(safeHtml, "text/html");

    for (const node of Array.from(parsed.head.childNodes)) {
      container.appendChild(document.importNode(node, true));
    }

    const body = document.createElement("body");
    // Do not set margin/padding inline here. Showcase screens commonly put
    // their outer gutters in `body { ... }`; an inline reset would outrank
    // those author rules and make the gutters disappear in the editor even
    // though the same HTML is correct in the showcase iframe.
    body.style.cssText = `
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    `;
    if (parsed.body.className) body.className = parsed.body.className;
    const parsedBodyStyle = parsed.body.getAttribute("style");
    if (parsedBodyStyle) body.style.cssText += `;${parsedBodyStyle}`;
    body.innerHTML = parsed.body.innerHTML;
    container.appendChild(body);
    prependUaReset(container);
    applyGlobalRootCustomProperties(container, body);
    forceEagerImageLoading(container);

    return { root: body, wrappedBody: true, originalHasBodyTag };
  } catch {
    container.innerHTML = safeHtml;
    prependUaReset(container);
    applyGlobalRootCustomProperties(container, container);
    forceEagerImageLoading(container);
    return { root: container, wrappedBody: false, originalHasBodyTag };
  }
}
