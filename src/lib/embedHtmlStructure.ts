/**
 * Structural mutations of an embed's raw `htmlContent` string — rename,
 * hide/show, remove, and move an element — all addressed by the same
 * "shadow path" the element picker/properties panel use
 * (`embedElementPicker.ts` / `embedElementStyle.ts`).
 *
 * Shares the parse/serialize plumbing with `applyEmbedElementEdit`
 * (`embedElementStyle.ts`) via `embedHtmlDocument.ts` rather than
 * duplicating it — see that module's doc comment for why it's a separate
 * third file instead of living in either of these two.
 *
 * Kept DOM-only, matching the sibling modules.
 */

import { resolveElementPath } from "./embedElementPicker";
import { shadowPathToSourcePath } from "./embedElementStyle";
import { parseEmbedHtml, serializeEmbedDoc } from "./embedHtmlDocument";

/**
 * Resolve a shadow path to a live element under `doc.body`, for the
 * mutations in this module. Returns null when the path is empty/malformed
 * (`shadowPathToSourcePath` returning null), when it doesn't resolve to
 * anything, AND — unlike `applyEmbedElementEdit`'s target resolution — when
 * it resolves to `""`, i.e. the source `<body>` itself: renaming, hiding,
 * removing or moving the document's own `<body>` isn't a sensible operation
 * the way editing its inline style is, so `""` is never a legal SOURCE for
 * any of the four exported functions below (it remains a legal `inside`
 * TARGET for `moveEmbedElement` — see `resolveMoveTarget`).
 */
function resolveStructureSource(doc: Document, shadowPath: string): Element | null {
  const sourcePath = shadowPathToSourcePath(shadowPath);
  if (!sourcePath) return null; // null (malformed) or "" (the body itself): both illegal here
  return resolveElementPath(doc.body, sourcePath);
}

const LAYER_NAME_ATTR = "data-layer-name";

/** Sets (or, for an empty/whitespace name, removes) the `data-layer-name`
 * attribute used as the layers-panel label. Returns null for a stale/
 * unresolvable path, or when the requested name is already in effect (a
 * no-op), leaving `html` untouched either way. */
export function setEmbedElementName(html: string, shadowPath: string, name: string): string | null {
  const doc = parseEmbedHtml(html);
  if (!doc) return null;
  const target = resolveStructureSource(doc, shadowPath);
  if (!target) return null;

  const trimmed = name.trim();
  if (trimmed) {
    if (target.getAttribute(LAYER_NAME_ATTR) === trimmed) return null;
    target.setAttribute(LAYER_NAME_ATTR, trimmed);
  } else {
    if (!target.hasAttribute(LAYER_NAME_ATTR)) return null;
    target.removeAttribute(LAYER_NAME_ATTR);
  }

  return serializeEmbedDoc(html, doc);
}

/** Stashes an element's pre-existing inline `display` value while it's
 * hidden, so `setEmbedElementHidden` can restore it exactly on show rather
 * than guessing a value to reinstate (or dropping the declaration on the
 * floor). Priority (`!important`) is appended after a `|` — `.style.display`
 * alone never exposes it (`getPropertyPriority` is a separate accessor), so
 * without this an author's `display:flex !important` would come back as
 * plain `flex` on show, and a class rule that also sets `display` would
 * start winning where it didn't before. `|` is safe as a separator: it can
 * never occur inside a CSS `display` keyword. */
const HIDDEN_STASH_ATTR = "data-pen-display";

/**
 * Hide = inline `display: none`; show = restore what was there before.
 *
 * Preserves any pre-existing inline `display` value (priority included —
 * see `HIDDEN_STASH_ATTR`'s doc comment) by stashing it in `data-pen-display`
 * on hide and restoring + removing it on show — the property is written
 * back into the SAME position `style.setProperty` left it in (its original
 * position when a value existed, appended when it didn't), so a hide/show
 * round trip reproduces the original inline style attribute byte-for-byte,
 * not just semantically.
 *
 * Returns null for a stale/unresolvable path or when the requested
 * visibility already holds (a no-op: e.g. hiding an element the author
 * already authored with `display: none`).
 */
export function setEmbedElementHidden(html: string, shadowPath: string, hidden: boolean): string | null {
  const doc = parseEmbedHtml(html);
  if (!doc) return null;
  const target = resolveStructureSource(doc, shadowPath) as HTMLElement | null;
  if (!target) return null;

  const isHidden = target.style.display === "none";
  if (hidden === isHidden) return null;

  if (hidden) {
    const prevDisplay = target.style.display;
    let stashedPriority = "";
    if (prevDisplay) {
      stashedPriority = target.style.getPropertyPriority("display");
      target.setAttribute(
        HIDDEN_STASH_ATTR,
        stashedPriority ? `${prevDisplay}|${stashedPriority}` : prevDisplay,
      );
    }
    // `!important` unconditionally, not just when an inline `display`
    // happened to carry it. Hiding is an assertion by the user, and the
    // rule it has to beat usually lives in a stylesheet (`.row { display:
    // flex !important }`) with no inline `display` at all — the shape where
    // a stashed priority is empty by construction. Without this the element
    // stays visible on canvas while its layers row dims, and the eye toggle
    // looks like it did nothing. Showing again removes the property or
    // restores the stashed value verbatim, so nothing leaks.
    target.style.setProperty("display", "none", "important");
  } else {
    const stashed = target.getAttribute(HIDDEN_STASH_ATTR);
    target.removeAttribute(HIDDEN_STASH_ATTR);
    if (stashed) {
      const [value, priority] = stashed.split("|");
      target.style.setProperty("display", value, priority ?? "");
    } else {
      target.style.removeProperty("display");
    }
  }

  // Same tidiness rule as applyEmbedElementEdit: never leave a decorative
  // empty `style=""` behind once display is unset again.
  if (target.style.length === 0 && target.hasAttribute("style")) {
    target.removeAttribute("style");
  }

  return serializeEmbedDoc(html, doc);
}

/** Remove the element (and its subtree) from the html. Returns null for a
 * stale/unresolvable path, leaving `html` untouched. */
export function removeEmbedElement(html: string, shadowPath: string): string | null {
  const doc = parseEmbedHtml(html);
  if (!doc) return null;
  const target = resolveStructureSource(doc, shadowPath);
  if (!target || !target.parentNode) return null;

  target.parentNode.removeChild(target);
  return serializeEmbedDoc(html, doc);
}

/** Resolve `moveEmbedElement`'s target path. Unlike `resolveStructureSource`,
 * `""` (the source `<body>` itself) IS a legal resolution here, but only for
 * an "inside" move — appending as the last child of `<body>` is sensible; a
 * "before"/"after" sibling of the body element itself is not. */
function resolveMoveTarget(doc: Document, shadowPath: string, position: MovePosition): Element | null {
  const sourcePath = shadowPathToSourcePath(shadowPath);
  if (sourcePath === null) return null;
  if (sourcePath === "") return position === "inside" ? doc.body : null;
  return resolveElementPath(doc.body, sourcePath);
}

export type MovePosition = "before" | "after" | "inside";

/**
 * Move the element at `shadowPath` to a new position relative to
 * `targetShadowPath`. "before"/"after" make it a sibling of the target;
 * "inside" appends it as the target's last child.
 *
 * Both paths are positional (`nth-of-type`), so BOTH are resolved to live
 * nodes from the freshly parsed document before any mutation happens —
 * resolving the second path after the first move has already renumbered its
 * old siblings would target the wrong element. Rejects (returns null,
 * leaving `html` untouched):
 * - a target path that doesn't resolve;
 * - moving the element into itself or into any of its own descendants
 *   (`source === target` or `source.contains(target)`) — otherwise the move
 *   would detach part of the tree the element being moved is itself part of;
 * - a move that resolves to the element's current position (a true no-op).
 */
export function moveEmbedElement(
  html: string,
  shadowPath: string,
  targetShadowPath: string,
  position: MovePosition,
): string | null {
  const doc = parseEmbedHtml(html);
  if (!doc) return null;

  const source = resolveStructureSource(doc, shadowPath);
  const target = resolveMoveTarget(doc, targetShadowPath, position);
  if (!source || !target) return null;

  if (source === target || source.contains(target)) return null;

  if (position === "inside") {
    if (source.parentElement === target && target.lastElementChild === source) return null;
    target.appendChild(source);
  } else {
    if (source.parentElement === target.parentElement) {
      const adjacent = position === "before" ? target.previousElementSibling : target.nextElementSibling;
      if (adjacent === source) return null;
    }
    if (!target.parentNode) return null;
    if (position === "before") {
      target.parentNode.insertBefore(source, target);
    } else {
      target.parentNode.insertBefore(source, target.nextSibling);
    }
  }

  return serializeEmbedDoc(html, doc);
}
