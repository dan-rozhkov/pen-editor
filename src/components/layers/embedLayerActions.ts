/**
 * React-free "read html from the store -> run a pure mutation -> write it
 * back correctly" glue for the Layers panel's embed-element rows. The four
 * pure mutations in `embedHtmlStructure.ts` only know how to transform an
 * html *string*; this module is the one place that knows how that string
 * lives in the scene graph and in `embedPickerStore`'s selection, and gets
 * the two write-ordering invariants right:
 *
 * 1. `useEmbedPickerStore.getState().noteSelectionEdit(...)` / `selectElement`
 *    / `clearSelection` MUST run BEFORE
 *    `useSceneStore.getState().updateNode(embedId, { htmlContent })` — see
 *    `EmbedElementProperties.applyEdit`, the reference implementation this
 *    mirrors. `useEmbedPickerLifecycle` subscribes to the scene store
 *    synchronously and drops the picker selection the instant it sees
 *    `htmlContent` diverge from the snapshot it was given; writing the
 *    scene first would make that check fire before the snapshot update
 *    lands, dropping the very selection this edit is trying to keep in
 *    sync.
 * 2. Element paths in this module are POSITIONAL (`nth-of-type`), not
 *    identity-based — see `embedHtmlStructure.ts`'s module doc comment. So
 *    ANY structural mutation (delete, move — anything that adds, removes,
 *    or reorders a sibling) can renumber paths OTHER than the one the
 *    mutation was aimed at: deleting `<p>A</p>` from
 *    `<p>A</p><p>B</p><p>C</p>` renumbers B and C, not just A's slot.
 *    A picker selection or an expand-state key that was computed from the
 *    PRE-mutation tree is therefore not just possibly-stale after such a
 *    mutation, it can silently resolve to the WRONG element post-mutation
 *    (whatever slid into its old positional slot) rather than failing
 *    loudly. `applyStructuralMutation` below is the one place that
 *    recovers from this: it stamps every element that needs to survive a
 *    structural mutation with a throwaway, uniquely-tokened marker
 *    attribute BEFORE the mutation runs, then finds each marker's element
 *    by TOKEN (not by path) in the result to learn where it ended up —
 *    rather than re-deriving new positions from the mutation's own
 *    before/after paths, which would duplicate (and could drift from)
 *    each pure mutation's placement rules. `deleteEmbedElement` and
 *    `reorderEmbedElement` both go through it so this is fixed once, not
 *    per-caller.
 *
 * Every exported function returns `false` and writes nothing — neither to
 * `htmlContent` nor to any store — when the underlying pure mutation
 * returns `null` (stale path, illegal op, or a true no-op).
 */

import { useSceneStore } from "@/store/sceneStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { buildSourceEmbedElementSelection, collapseText } from "@/lib/embedLayerTree";
import type { EmbedElementLayer } from "@/lib/embedLayerTree";
import { getEmbedElementLayerKey } from "./layerTypes";
import { resolveElementPath, buildElementPath } from "@/lib/embedElementPicker";
import { shadowPathToSourcePath } from "@/lib/embedElementStyle";
import { parseEmbedHtml, serializeEmbedDoc } from "@/lib/embedHtmlDocument";
import {
  setEmbedElementName,
  setEmbedElementHidden,
  removeEmbedElement,
  moveEmbedElement,
  type MovePosition,
} from "@/lib/embedHtmlStructure";

/** Read the owning embed's current `htmlContent` fresh from the store, or
 * `null` when `embedId` doesn't name a live embed node — every exported
 * function below bails out on `null` rather than operating on stale data
 * captured by a caller that re-rendered since. */
function readEmbedHtml(embedId: string): string | null {
  const node = useSceneStore.getState().nodesById[embedId];
  if (!node || node.type !== "embed") return null;
  return node.htmlContent ?? "";
}

/** Shared tail of every mutation below: note the edit in the picker store
 * (invariant 1) before writing the new html into the scene. `outerHtml` is
 * left undefined — none of these four mutations change what the picker's
 * `outerHtml` preview should say for an element whose identity (not
 * content) is what changed; `EmbedElementProperties` is the one place a
 * text/style edit needs to refresh it. */
function commitHtml(embedId: string, newHtml: string): void {
  useEmbedPickerStore.getState().noteSelectionEdit(newHtml);
  useSceneStore.getState().updateNode(embedId, { htmlContent: newHtml });
}

/** Attribute used to track an element's identity across a structural
 * mutation — see `applyStructuralMutation`'s doc comment. Space-separated
 * token *list* (like `class`) rather than one value, so an element that is
 * BOTH the current picker selection AND an expanded row (a "frame"-kind
 * element with children can be both) carries both tokens without one
 * `setAttribute` clobbering the other. */
const ELEMENT_TRACK_ATTR = "data-pen-track";

/** Stamp `el` with a new, unique tracking token (appended to any existing
 * ones) and return it. */
function trackElement(el: Element): string {
  const token = `t${Math.random().toString(36).slice(2)}`;
  const existing = el.getAttribute(ELEMENT_TRACK_ATTR);
  el.setAttribute(ELEMENT_TRACK_ATTR, existing ? `${existing} ${token}` : token);
  return token;
}

/** Resolve an already-positional `sourcePath` (as stored in an expand-state
 * key, or as `shadowPathToSourcePath` below produces) to a live element to
 * stamp/track.
 *
 * `""` — the embed's content container, i.e. the source `<body>` — is
 * deliberately NOT trackable, and needs no tracking: it is the one path a
 * structural mutation of its descendants can never renumber, so it survives
 * every mutation unchanged. Marking it would also be unsound for a
 * bare-fragment embed, where `serializeEmbedDoc` emits
 * `doc.head.innerHTML + doc.body.innerHTML` and drops every `<body>`
 * attribute — the marker would never reach the mutated html, `findTracked`
 * would report the element gone, and a container-level selection would be
 * cleared by any unrelated delete or reorder. */
function resolveTrackableSourcePath(doc: Document, sourcePath: string): Element | null {
  return sourcePath === "" ? null : resolveElementPath(doc.body, sourcePath);
}

/** Resolve a SHADOW path (as `embedPickerStore.selection.path` is stored —
 * possibly `#id`-anchored, and prefixed with the synthetic mount wrappers)
 * to a live element to stamp/track. */
function resolveTrackable(doc: Document, shadowPath: string): Element | null {
  const sourcePath = shadowPathToSourcePath(shadowPath);
  if (sourcePath === null) return null;
  return resolveTrackableSourcePath(doc, sourcePath);
}

/** `~=` matches one token out of a whitespace-separated attribute value —
 * exactly the semantics `trackElement`'s token list needs.
 *
 * `doc.body.querySelector(All)` never matches `doc.body` itself — but
 * `resolveTrackableSourcePath` above deliberately treats `""` (the body) as
 * a legal trackable element, so both this lookup and `stripTrackMarkers`
 * below have to check the body explicitly too, or a body-targeted
 * selection/expand-key is stamped with a marker that's never found (silently
 * cleared) and never stripped (leaking into the user's `htmlContent`
 * permanently). */
function findTracked(doc: Document, token: string): Element | null {
  const bodyTokens = doc.body.getAttribute(ELEMENT_TRACK_ATTR);
  if (bodyTokens && bodyTokens.split(/\s+/).includes(token)) return doc.body;
  return doc.body.querySelector(`[${ELEMENT_TRACK_ATTR}~="${token}"]`);
}

function stripTrackMarkers(doc: Document): void {
  doc.body.removeAttribute(ELEMENT_TRACK_ATTR);
  for (const el of Array.from(doc.body.querySelectorAll(`[${ELEMENT_TRACK_ATTR}]`))) {
    el.removeAttribute(ELEMENT_TRACK_ATTR);
  }
}

type TrackedItem =
  | { kind: "selection" }
  | { kind: "expand"; oldKey: string };

/**
 * Shared engine behind `deleteEmbedElement` and `reorderEmbedElement` (this
 * module's doc comment, point 2): runs a structural `mutate` (delete, move
 * — anything that can renumber positional paths beyond the element it was
 * aimed at) with the picker selection, and optionally this embed's
 * expand-state keys, tracked THROUGH the mutation by identity rather than
 * by re-deriving their new positions from `mutate`'s own before/after paths.
 *
 * `mutate` receives html with tracking markers already stamped in — a new
 * attribute, never a structural change, so it can't have shifted any
 * `nth-of-type` index the caller's own path arguments (closed over by
 * `mutate`) resolve against.
 *
 * Returns the final html written to the scene, or `null` (writing nothing,
 * to any store) when `mutate` itself rejects the op.
 */
function applyStructuralMutation(
  embedId: string,
  html: string,
  mutate: (markedHtml: string) => string | null,
  options?: { trackExpandKeys?: boolean },
): string | null {
  const doc = parseEmbedHtml(html);
  if (!doc) return null;

  const tracked = new Map<string, TrackedItem>();

  const selection = useEmbedPickerStore.getState().selection;
  const trackingSelectionForThisEmbed = !!selection && selection.embedId === embedId;
  if (selection && trackingSelectionForThisEmbed) {
    const el = resolveTrackable(doc, selection.path);
    if (el) tracked.set(trackElement(el), { kind: "selection" });
  }

  if (options?.trackExpandKeys) {
    const { expandedFrameIds } = useSceneStore.getState();
    const keyPrefix = `embed:${embedId}:`;
    for (const key of expandedFrameIds) {
      if (!key.startsWith(keyPrefix)) continue;
      const el = resolveTrackableSourcePath(doc, key.slice(keyPrefix.length));
      if (el) tracked.set(trackElement(el), { kind: "expand", oldKey: key });
    }
  }

  const markedHtml = serializeEmbedDoc(html, doc);
  const resultHtml = mutate(markedHtml);
  if (resultHtml === null) return null;

  if (tracked.size === 0) {
    // Nothing of ours needed to survive the mutation — still refresh the
    // selection snapshot (if any) so the lifecycle doesn't trip on this
    // embed's html changing for an unrelated reason (invariant 1).
    commitHtml(embedId, resultHtml);
    return resultHtml;
  }

  const resultDoc = parseEmbedHtml(resultHtml);
  if (!resultDoc) {
    // Defensive — `mutate` just produced this html, so it should always
    // re-parse. `resultHtml` still has the tracking markers stamped in at
    // this point (only `stripTrackMarkers` below removes them, and it never
    // ran) — writing it here (as an earlier version of this branch did)
    // would permanently leak `data-pen-track` into the user's htmlContent.
    // Match the module's "returns null / writes nothing" contract instead.
    return null;
  }

  let selectionResult: { newSourcePath: string } | "clear" | null = null;
  let expandKeysChanged = false;
  const nextExpandedKeys = new Set(useSceneStore.getState().expandedFrameIds);
  // Collected, then applied in two passes below. Doing delete+add per item
  // as we go is wrong whenever one tracked row's NEW key equals another's
  // OLD key — which is the normal case when a mutation shifts a run of
  // same-tag siblings past each other. The later item's `delete` would
  // remove the key the earlier item had just added, silently collapsing a
  // row, and which row lost depended on `tracked`'s insertion order.
  const expandRemovals: string[] = [];
  const expandAdditions: string[] = [];

  for (const [token, item] of tracked) {
    const el = findTracked(resultDoc, token);
    if (item.kind === "expand") {
      if (el) {
        const newSourcePath = buildElementPath(el, resultDoc.body, { anchorOnId: false });
        const newKey = getEmbedElementLayerKey(embedId, newSourcePath);
        // Only record a change (and flag a write) when the key actually
        // moved — most tracked expand-rows in a structural mutation are
        // bystanders whose path didn't shift at all, and re-writing an
        // unchanged key would fire the scene-store notification for nothing.
        if (newKey !== item.oldKey) {
          expandRemovals.push(item.oldKey);
          expandAdditions.push(newKey);
          expandKeysChanged = true;
        }
      } else {
        // The expanded element didn't survive (deleted, or inside a deleted
        // subtree) — its key is dropped, not carried forward.
        expandRemovals.push(item.oldKey);
        expandKeysChanged = true;
      }
    } else {
      selectionResult = el
        ? { newSourcePath: buildElementPath(el, resultDoc.body, { anchorOnId: false }) }
        : "clear";
    }
  }

  for (const key of expandRemovals) nextExpandedKeys.delete(key);
  for (const key of expandAdditions) nextExpandedKeys.add(key);

  stripTrackMarkers(resultDoc);
  const finalHtml = serializeEmbedDoc(resultHtml, resultDoc);

  // WHY this write is FIRST, before the picker-store writes below (which
  // invariant 1 otherwise requires to land before the scene write): this
  // `setState` touches `useSceneStore`, and `useEmbedPickerLifecycle`
  // subscribes to the ENTIRE scene store synchronously — it re-runs its
  // check on any sceneStore change, not just `htmlContent`. If this ran
  // AFTER the picker-store writes (as an earlier version of this function
  // did), that synchronous check would fire at the one moment where
  // `selectionHtmlSnapshot` is already the NEW html (just written by
  // `selectElement`/`noteSelectionEdit` below) but `embedNode.htmlContent`
  // is still the OLD one (not written until `updateNode` at the very end) —
  // `htmlChangedSincePick` reads true and drops the very selection this
  // function is trying to carry forward. Doing this expand-state write
  // first keeps both sides of that comparison on the OLD html until the
  // picker store is updated, so the check never trips prematurely.
  if (expandKeysChanged) {
    useSceneStore.setState({ expandedFrameIds: nextExpandedKeys });
  }

  // Picker-store writes (invariant 1) before the final scene write below.
  if (selectionResult === "clear") {
    useEmbedPickerStore.getState().clearSelection();
  } else if (selectionResult) {
    const newSelection = buildSourceEmbedElementSelection(finalHtml, selectionResult.newSourcePath, embedId);
    if (newSelection) {
      // `selectElement` (not `noteSelectionEdit`, which only patches the
      // existing selection's `outerHtml`/snapshot) since the path itself
      // may have changed, not just the content behind it.
      useEmbedPickerStore.getState().selectElement(newSelection, finalHtml);
    } else {
      useEmbedPickerStore.getState().clearSelection();
    }
  } else if (trackingSelectionForThisEmbed) {
    // A selection exists for this embed but wasn't trackable (already
    // stale before this mutation ran) — still refresh the snapshot so the
    // lifecycle doesn't drop it over this html change alone.
    useEmbedPickerStore.getState().noteSelectionEdit(finalHtml);
  }

  useSceneStore.getState().updateNode(embedId, { htmlContent: finalHtml });

  return finalHtml;
}

/**
 * The name to seed the rename input with when a layers-panel row's
 * double-click starts editing it. `element.name` (from `embedLayerTree.ts`'s
 * `resolveName`) is already the FULL name for every row EXCEPT a "text" row
 * with no explicit `data-layer-name` override — that one case truncates a
 * long derived text label to 28 chars + `…` for DISPLAY. Seeding the edit
 * field with that ellipsis would, on a blur with no actual edit, submit the
 * truncated text as the new `data-layer-name` and make the truncation
 * permanent. So: prefer a live `data-layer-name` attribute (untruncated by
 * construction — `resolveName` never truncates it), and only fall back to
 * `element.name` when the element can't be resolved fresh (stale row).
 */
export function resolveEmbedElementEditName(embedId: string, element: EmbedElementLayer): string {
  if (element.kind !== "text") return element.name;

  const html = readEmbedHtml(embedId);
  if (html === null) return element.name;
  const doc = parseEmbedHtml(html);
  if (!doc) return element.name;
  const el = resolveTrackable(doc, element.shadowPath);
  if (!el) return element.name;

  const dataName = el.getAttribute("data-layer-name")?.trim();
  if (dataName) return dataName;
  return collapseText(el.textContent) || element.name;
}

export function renameEmbedElement(embedId: string, shadowPath: string, name: string): boolean {
  const html = readEmbedHtml(embedId);
  if (html === null) return false;
  const newHtml = setEmbedElementName(html, shadowPath, name);
  if (newHtml === null) return false;
  commitHtml(embedId, newHtml);
  return true;
}

export function toggleEmbedElementHidden(embedId: string, shadowPath: string, hidden: boolean): boolean {
  const html = readEmbedHtml(embedId);
  if (html === null) return false;
  const newHtml = setEmbedElementHidden(html, shadowPath, hidden);
  if (newHtml === null) return false;
  commitHtml(embedId, newHtml);
  return true;
}

/**
 * Delete the element at `shadowPath`. Goes through `applyStructuralMutation`
 * so the picker selection is tracked by IDENTITY through the removal, not
 * just checked against the deleted path up front — deleting `<p>A</p>`
 * while `<p>B</p>` is selected still renumbers B's path even though B
 * itself is untouched, so a selection that merely "wasn't the deleted
 * element" can still be left pointing at the wrong one without this (see
 * this module's doc comment, point 2). Clears the selection instead when
 * the deleted element (or an ancestor of it, taking the whole subtree with
 * it) WAS the selection.
 *
 * Tracks expand-state keys too (`trackExpandKeys: true`) — a delete
 * renumbers surviving siblings exactly like a move does, so an expanded row
 * elsewhere in this embed can silently collapse (or a different row can
 * silently read as expanded) without this, same as it would for
 * `reorderEmbedElement`.
 */
export function deleteEmbedElement(embedId: string, shadowPath: string): boolean {
  const html = readEmbedHtml(embedId);
  if (html === null) return false;

  const result = applyStructuralMutation(
    embedId,
    html,
    (markedHtml) => removeEmbedElement(markedHtml, shadowPath),
    { trackExpandKeys: true },
  );
  return result !== null;
}

/**
 * Move the element at `shadowPath` to `position` of `targetShadowPath` (see
 * `moveEmbedElement`'s doc comment for exact semantics). Goes through
 * `applyStructuralMutation` with expand-key tracking enabled: a move
 * renumbers same-tag siblings in BOTH the old and new neighborhoods, not
 * just inside the moved subtree, so any expanded row anywhere in this
 * embed (not only the moved one) can have its path shift — tracking every
 * expanded element by identity, not just rewriting the moved subtree's own
 * key prefix, is what makes this correct for that case too.
 */
export function reorderEmbedElement(
  embedId: string,
  shadowPath: string,
  targetShadowPath: string,
  position: MovePosition,
): boolean {
  const html = readEmbedHtml(embedId);
  if (html === null) return false;

  const result = applyStructuralMutation(
    embedId,
    html,
    (markedHtml) => moveEmbedElement(markedHtml, shadowPath, targetShadowPath, position),
    { trackExpandKeys: true },
  );
  return result !== null;
}
