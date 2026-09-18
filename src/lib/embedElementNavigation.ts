/**
 * Pure DOM-only keyboard-navigation helpers for the embed element picker:
 * Tab/Shift+Tab across siblings, Enter into the first child, Shift+Enter up
 * to the parent — the embed-picker analog of
 * `src/components/canvas/keyboardNavigation.ts`'s scene-node navigation
 * (`handleTabNavigation`), reproducing the same semantics (wraps around,
 * skips hidden elements, no-ops when there's nowhere to go) against a live
 * embed's shadow-DOM tree instead of the scene graph.
 *
 * "Navigable" here means the element would show up as a row in the layers
 * panel tree (`embedLayerTree.ts`): not a skipped tag (`<script>`, `<style>`,
 * ...) and not carrying an inline `display: none`. Reuses `SKIPPED_TAGS`/
 * `isInlineHidden` from that module rather than redefining them, so the two
 * trees can never silently drift apart (also required by CI's jscpd gate).
 *
 * Kept framework-free like its siblings (`embedElementPicker.ts`,
 * `embedElementStyle.ts`) so it's testable against plain DOM trees.
 */

import { resolveElementPath } from "./embedElementPicker";
import { CONTENT_CONTAINER_SEGMENT, SYNTHETIC_BODY_SEGMENT } from "./embedElementStyle";
import { isInlineHidden, isLayerTreeLeaf, SKIPPED_TAGS } from "./embedLayerTree";

/** True when `el` would be a row in the layers tree: not a skipped tag and
 * not inline-hidden. Unlike the layers panel itself (which still lists a
 * hidden element, just flagged `hidden: true`), keyboard navigation skips
 * hidden elements outright — there's nothing on screen to land the
 * highlight/selection on. */
export function isNavigableEmbedElement(el: Element): boolean {
  if (SKIPPED_TAGS.has(el.tagName.toLowerCase())) return false;
  return !isInlineHidden(el);
}

/** Navigable element children of `parent`, in document order. `parent` is
 * typed as `ParentNode` (not `Element`) so this also works directly against
 * the mount container/synthetic `<body>`'s own parent chain up to and
 * including a `ShadowRoot`, which has `.children` via `ParentNode` but is
 * not itself an `Element`. */
export function navigableChildren(parent: ParentNode): Element[] {
  return Array.from(parent.children).filter(isNavigableEmbedElement);
}

/**
 * The next (`direction: 1`) or previous (`direction: -1`) navigable sibling
 * of `el`, wrapping around within `el`'s own DOM parent's navigable
 * children.
 *
 * Two distinct "nowhere assumed" situations, both returning `null`:
 * - `el` itself IS a navigable sibling but is the only one — normal
 *   dead-end, nothing to move to.
 * - `parentNode` has no navigable children AT ALL (every child is a
 *   skipped tag or inline-hidden) — there is nothing to land on in either
 *   direction.
 *
 * A third case does NOT return `null`: `el` itself isn't among its
 * parent's navigable children (it's inline-hidden or a skipped tag) but
 * OTHER navigable siblings exist. This happens because the layers panel
 * still shows a `display:none` element as a clickable row (flagged
 * `hidden: true`, never dropped — see `buildEmbedLayerTree`), so the
 * picker selection can land on a non-navigable element even though
 * keyboard navigation itself only ever walks navigable ones. Rather than
 * silently doing nothing (Tab/Shift+Tab looking dead from a selection the
 * user can perfectly well be sitting on), this steps to the SIDE the
 * caller pressed toward: the first navigable sibling for `direction: 1`,
 * the last for `direction: -1` — deliberately handled HERE, not in
 * `handleEmbedElementTab`, so both the "jump to an edge" and "wrap
 * normally" behaviors live next to the same `siblings` computation instead
 * of the handler re-deriving `navigableChildren(el.parentNode)` itself.
 * `handleEmbedElementTab` only needs to tell this case apart from a true
 * dead-end (to decide whether Tab still falls through to native sibling
 * navigation when `el` isn't navigable and NO siblings exist either — see
 * its own doc comment), which it does via `isNavigableEmbedElement(el)`
 * rather than duplicating this indexing logic.
 *
 * Deliberately does NOT special-case `el`'s parent being the mount
 * container `<div>` or the synthetic `<body>` (see
 * `embedElementStyle.ts`'s module doc comment for what those are): sibling
 * search only ever looks at `el`'s immediate DOM parent's children, and for
 * a top-level content element that parent already IS the container/
 * synthetic body, so its navigable children already ARE the top-level
 * layers-tree rows. No extra unwrapping needed — unlike `parentEmbedElement`
 * below, which must actively skip over those wrapper levels when climbing
 * up.
 *
 * `root` bounds how far this module is allowed to roam. It isn't consulted
 * to compute the result (sibling search never climbs above `el`'s own
 * parent), but `el` is checked against it defensively — mirroring
 * `resolvePickableElement`'s explicit containment check in
 * `embedElementPicker.ts` — so a caller that accidentally hands in an
 * element from outside the embed's subtree gets `null` instead of a result
 * computed against the wrong tree.
 */
export function siblingEmbedElement(
  el: Element,
  root: ParentNode,
  direction: 1 | -1,
): Element | null {
  if (!(root as unknown as Node).contains(el)) return null;

  const parentNode = el.parentNode;
  if (!parentNode) return null;

  const siblings = navigableChildren(parentNode as unknown as ParentNode);
  if (siblings.length === 0) return null;

  const index = siblings.indexOf(el);
  if (index === -1) {
    // `el` isn't itself navigable but siblings are — land on the edge the
    // user pressed toward (see the doc comment above).
    return direction === 1 ? siblings[0] : siblings[siblings.length - 1];
  }
  if (siblings.length <= 1) return null; // el is the sole navigable sibling — nowhere to go

  const nextIndex = (index + direction + siblings.length) % siblings.length;
  return siblings[nextIndex];
}

/** The first navigable descendant of `el`, or `null` when `el` has none —
 * a true leaf, every child is hidden/a skipped tag, or (see below) `el` is
 * itself a leaf of the layers tree (`buildRow` gives it `children: []`).
 *
 * Checks `isLayerTreeLeaf(el)` first and returns `null` immediately when
 * it's true, rather than falling through to `navigableChildren(el)`: an
 * element whose only children are `INLINE_TAGS` markup — with text
 * (`<div>Label <span class="badge">3</span></div>`, which collapses to a
 * text row) or WITHOUT it (`<div><span class="ph ph-bell"></span></div>`,
 * an icon wrapper, which stays a childless `frame`/`image`/`shape` row) —
 * gets `children: []` in `embedLayerTree.ts`'s `buildRow` either way, so
 * the `<span>` gets no row of its own anywhere in the layers panel.
 * `navigableChildren(el)` alone doesn't know this: `<span>` isn't a skipped
 * tag or inline-hidden, so it would pass the navigable filter and this
 * would land Enter on an element the layers panel can never show selected.
 * Sharing `isLayerTreeLeaf` with `buildRow` (rather than re-deriving the
 * same leaf-eligibility check here) is what keeps this descent tree and the
 * layers panel's tree from ever disagreeing on where a subtree bottoms out
 * — see that function's own doc comment, including why it deliberately does
 * NOT also require text content (an earlier version of this check did, via
 * a predicate then named `collapsesToTextRow`, which is why an icon
 * wrapper with no text used to let Enter descend into it anyway). */
export function firstChildEmbedElement(el: Element): Element | null {
  if (isLayerTreeLeaf(el)) return null;
  return navigableChildren(el)[0] ?? null;
}

/**
 * Default for `parentEmbedElement`'s `isContentRoot` predicate: recognizes
 * the two synthetic wrapper levels `mountHtmlWithBodyStyles`
 * (`embedHtmlUtils.ts`) inserts between a `ShadowRoot` and the author's real
 * markup, purely by DOM position relative to `root` — this module has no
 * import on `embedElementStyle.ts`'s `CONTENT_CONTAINER_SEGMENT`/
 * `SYNTHETIC_BODY_SEGMENT` string constants, since those describe a PATH
 * shape, not a live-DOM predicate:
 *
 * 1. The mount container `<div>` (`EmbedLayer.tsx` appends it as the
 *    `ShadowRoot`'s sole child) — identified as any element whose OWN
 *    parent is `root` itself.
 * 2. The synthetic `<body>` (only present when the source html has
 *    body-targeted styles) — identified as a `<body>`-tagged element one
 *    level below that: its parent's parent is `root`.
 *
 * Neither wrapper is itself a layers-tree row (the tree starts at THEIR
 * children — see `embedLayerTree.ts`), so `parentEmbedElement` treats
 * reaching one while climbing as "nothing more to climb to", exactly like
 * reaching `root` directly.
 */
function isDefaultContentRoot(candidate: Element, root: ParentNode): boolean {
  const rootNode = root as unknown as Node;
  if (candidate.parentNode === rootNode) return true;
  const grandparent = candidate.parentNode?.parentNode ?? null;
  return candidate.tagName === "BODY" && grandparent === rootNode;
}

/**
 * The parent element of `el` within the embed's navigable tree, or `null`
 * when there's nowhere further to climb — `el`'s parent is `root` itself,
 * or it's one of the synthetic wrapper levels `isDefaultContentRoot`
 * recognizes by default (see its doc comment). Unlike sibling/child
 * navigation, climbing up MUST see through those wrappers: they sit in the
 * live DOM but have no row of their own in the layers tree, so surfacing
 * one as a "parent" would let the user navigate to an element with no
 * matching entry anywhere else in the picker/layers UI.
 *
 * `isContentRoot` is optional and defaults to `isDefaultContentRoot` above.
 * It's a structural guess (DOM position, not an explicit marker) because
 * neither the container `<div>` nor the synthetic `<body>` carries any
 * `data-*` attribute or class identifying them as such in the live DOM —
 * `embedElementStyle.ts`'s `CONTENT_CONTAINER_SEGMENT`/
 * `SYNTHETIC_BODY_SEGMENT` constants describe their PATH shape (always the
 * first, resp. first-after-container, segment) rather than anything
 * queryable on the element itself. Callers with a more precise signal (e.g.
 * one already holding the live `ShadowRoot` and mount metadata) can pass
 * their own predicate instead.
 */
export function parentEmbedElement(
  el: Element,
  root: ParentNode,
  isContentRoot: (el: Element) => boolean = (candidate) => isDefaultContentRoot(candidate, root),
): Element | null {
  const parentNode = el.parentNode;
  if (!parentNode || (parentNode as unknown as Node) === (root as unknown as Node)) return null;
  if (!(parentNode instanceof Element)) return null;
  if (isContentRoot(parentNode)) return null;
  return parentNode;
}

/**
 * The element whose navigable children make up the TOP-LEVEL rows of the
 * embed's layers tree — the container `<div>` `mountHtmlWithBodyStyles`
 * mounts into, or the synthetic `<body>` inside it when the source html has
 * body-targeted styles (see `embedElementStyle.ts`'s module doc comment).
 *
 * Resolved via the same `CONTENT_CONTAINER_SEGMENT`/`SYNTHETIC_BODY_SEGMENT`
 * path constants `embedLayerTree.ts` builds shadow paths from, rather than
 * re-deriving the "is there a synthetic body" guess independently — so this
 * can never disagree with what the layers panel considers a top-level row.
 *
 * Lives here, with the other navigable-tree helpers, rather than in either
 * of its two callers (`components/canvas/embedElementNavigation.ts` for
 * Enter-into-the-embed, `EmbedElementHighlight.tsx` for the dashed
 * top-level child outlines): both need the exact same notion of "top
 * level", and two structurally identical copies would be free to drift.
 */
export function findTopLevelContentRoot(root: ShadowRoot): Element | null {
  const container = resolveElementPath(root, CONTENT_CONTAINER_SEGMENT);
  if (!container) return null;
  const syntheticBody = resolveElementPath(
    root,
    `${CONTENT_CONTAINER_SEGMENT} > ${SYNTHETIC_BODY_SEGMENT}`,
  );
  return syntheticBody ?? container;
}
