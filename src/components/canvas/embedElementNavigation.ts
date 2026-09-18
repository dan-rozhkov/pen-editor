/**
 * Keyboard navigation for elements PICKED inside an embed's shadow DOM — the
 * embed-picker analog of `keyboardNavigation.ts`'s scene-node handlers
 * (`handleTabNavigation`, the Enter/Shift+Enter branches in
 * `keyboardCommands.ts`), reproducing the same three gestures (Tab/Shift+Tab
 * across siblings, Enter to go deeper, Shift+Enter to go up) against the
 * live element `embedPickerStore.selection` names instead of a scene node.
 *
 * The actual DOM walking is `src/lib/embedElementNavigation.ts`'s job (pure,
 * store-free helpers over a live shadow tree); this module is the glue that
 * reads/writes `embedPickerStore`/`selectionStore`/`sceneStore` and decides,
 * per key, which element becomes the new selection. Kept separate from that
 * module the same way `embedElementPicker.ts` (DOM-only) is kept separate
 * from `EmbedLayer.tsx` (store-wired) elsewhere in this feature.
 */

import {
  findTopLevelContentRoot,
  firstChildEmbedElement,
  isNavigableEmbedElement,
  navigableChildren,
  parentEmbedElement,
  siblingEmbedElement,
} from "@/lib/embedElementNavigation";
import { describeEmbedElement, resolveElementPath } from "@/lib/embedElementPicker";
import { findEmbedShadowRoot } from "@/lib/embedElementStyle";
import { isTextLeaf } from "@/lib/embedTextLeaf";
import { canEditScene, useEditorModeStore } from "@/store/editorModeStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";

interface EmbedElementContext {
  embedId: string;
  /** The live shadow root the picked element resolves against. */
  root: ShadowRoot;
  /** The live element `embedPickerStore.selection.path` currently resolves
   * to — re-resolved fresh on every call rather than trusted from the
   * store, since the shadow DOM can change (an embed's own script, a prior
   * `edit_embed_html`) without the picker selection being told. */
  el: Element;
  path: string;
  /** The owning embed's CURRENT `htmlContent`, to hand to `selectElement` as
   * the staleness snapshot — see `applySelection`'s doc comment. */
  html: string | undefined;
}

/**
 * Resolve the live picker context this module's handlers act on: a picked
 * element (`embedPickerStore.selection`) whose owning embed is still the
 * SOLE native selection — the exact same "is this pick still live" check
 * `keyboardCommands.ts`'s Delete branch and `useEmbedPickerLifecycle` already
 * use to decide whether a picker selection still governs the keyboard.
 *
 * Returns `null` for every way that check (or the live DOM lookup) can fail:
 * no selection at all, the owning embed no longer the sole selection, no
 * mounted shadow root (outline mode, a hidden ancestor), or a path that no
 * longer resolves (the embed's html changed under the pick). Every one of
 * these is a pick `useEmbedPickerLifecycle` is about to clear on its own
 * next run (it subscribes to the same selection/scene stores this reads) —
 * so a handler seeing `null` here should fall back to the native
 * scene-node keyboard path rather than silently doing nothing, exactly like
 * any other "this shortcut doesn't apply right now" case.
 */
function resolveElementContext(): EmbedElementContext | null {
  const selection = useEmbedPickerStore.getState().selection;
  if (!selection) return null;

  const selectedIds = useSelectionStore.getState().selectedIds;
  if (selectedIds.length !== 1 || selectedIds[0] !== selection.embedId) return null;

  const root = findEmbedShadowRoot(selection.embedId);
  if (!root) return null;

  const el = resolveElementPath(root, selection.path);
  if (!el) return null;

  const sceneNode = useSceneStore.getState().nodesById[selection.embedId];
  const html = sceneNode?.type === "embed" ? sceneNode.htmlContent : undefined;

  return { embedId: selection.embedId, root, el, path: selection.path, html };
}

/**
 * Apply `el` as the picker's new selection, describing it fresh off the live
 * DOM and snapshotting the owning embed's html exactly as `LayerItem`'s
 * programmatic selection does (`selectElement(describeEmbedElement(...),
 * html)`). The `html` snapshot is load-bearing, not decorative:
 * `useEmbedPickerLifecycle` compares it against the live node on every
 * selection/scene change and drops the whole selection the instant they
 * disagree, so omitting it (or passing something else) would have this
 * handler's own selection undone on the very next store tick.
 */
function applySelection(ctx: Pick<EmbedElementContext, "embedId" | "root" | "html">, el: Element): void {
  const selection = describeEmbedElement(el, ctx.root, ctx.embedId);
  useEmbedPickerStore.getState().selectElement(selection, ctx.html);
}

/**
 * Tab / Shift+Tab while an embed element is picked: move the selection to
 * the next (Shift+Tab: previous) navigable sibling, wrapping around.
 *
 * Returns `true` (Tab eaten) whenever the picker context resolves AND
 * either `siblingEmbedElement` found somewhere to go, or it returned `null`
 * because the picked element itself IS navigable but has no other
 * navigable siblings — a normal dead end, same as native
 * `handleTabNavigation`'s own no-siblings case, which also still eats the
 * key. Unlike that native handler, this must never fall through to it in
 * THAT case: letting Tab escape to the native scene-node sibling walk here
 * would move the SELECTED EMBED itself to some unrelated sibling on the
 * canvas, as a surprising side effect of pressing Tab while navigating its
 * content.
 *
 * Returns `false` (Tab released to `handleTabNavigation`) only when the
 * picked element ISN'T navigable itself (the layers panel still lets you
 * pick a `display:none` row — see `siblingEmbedElement`'s doc comment) AND
 * there are no navigable siblings for `siblingEmbedElement` to land on
 * either. There is nothing at all to move keyboard focus to inside this
 * embed then, so blocking Tab would leave it permanently dead on that
 * selection — mirrors `handleTabNavigation` itself returning `false` for
 * its own `currentIndex === -1` case.
 */
export function handleEmbedElementTab(e: KeyboardEvent): boolean {
  const ctx = resolveElementContext();
  if (!ctx) return false;

  const next = siblingEmbedElement(ctx.el, ctx.root, e.shiftKey ? -1 : 1);
  if (next) {
    applySelection(ctx, next);
    return true;
  }

  return isNavigableEmbedElement(ctx.el);
}

/**
 * Enter (no Shift) while an embed element is picked — or while the embed
 * itself is the sole selection with nothing picked yet — moves the
 * selection one level DEEPER into the embed's content, mirroring native
 * Enter's "start editing/enter" semantics for a scene node.
 *
 * Three cases, in order:
 * 1. No picker selection yet, but the sole selected node IS an embed with a
 *    mounted shadow root: select its first top-level navigable element —
 *    this is how Enter "enters" an embed the same way it enters a frame.
 *    Gated by the SAME three checks `useEmbedPickerLifecycle`'s auto-start
 *    branch applies before calling `startPicking` itself (`editingMode !==
 *    "embed"`, `!activeEmbedId`, `canEditScene(mode)`) — that hook is the
 *    source of truth for "is it currently legal to start picking on this
 *    embed" and this is a second, keyboard-triggered entry into the same
 *    decision, not a decision of its own. Without repeating them here, Enter
 *    could create a pick (and the element-scoped highlight/properties-panel
 *    switch that follows from it) while the inline HTML editor is open on
 *    this embed, or in a read-only mode — exactly the states
 *    `useEmbedPickerLifecycle` would otherwise never let picking start in.
 * 2. A picked element that's a text leaf (`isTextLeaf`): hand off to
 *    `requestElementEdit`, the same inline-text-edit entry point
 *    `EmbedLayer`'s dblclick gesture uses, rather than descending — a text
 *    leaf by definition has no navigable element children to descend into
 *    that would be more useful than editing its text.
 * 3. Anything else (not a text leaf, or the edit request didn't start):
 *    select the first navigable child, if there is one.
 *
 * Returns `true` whenever there was a picker context to act on at all
 * (cases 2/3), even when there's nowhere to go — Enter on a leaf element
 * must not leak through to native path-edit-mode handling below it in
 * `keyboardCommands.ts`, which expects a scene node, not an embed element.
 */
export function handleEmbedElementEnter(): boolean {
  const selection = useEmbedPickerStore.getState().selection;

  if (!selection) {
    const { selectedIds, editingMode, activeEmbedId } = useSelectionStore.getState();
    if (selectedIds.length !== 1) return false;
    // See the doc comment above: these three mirror
    // `useEmbedPickerLifecycle`'s auto-start gate exactly.
    if (editingMode === "embed") return false;
    if (activeEmbedId) return false;
    if (!canEditScene(useEditorModeStore.getState().mode)) return false;

    const embedId = selectedIds[0];
    const node = useSceneStore.getState().nodesById[embedId];
    if (node?.type !== "embed") return false;

    const root = findEmbedShadowRoot(embedId);
    if (!root) return false;

    const contentRoot = findTopLevelContentRoot(root);
    if (!contentRoot) return false;

    const first = navigableChildren(contentRoot)[0];
    if (!first) return false;

    applySelection({ embedId, root, html: node.htmlContent }, first);
    return true;
  }

  const ctx = resolveElementContext();
  if (!ctx) return false;

  if (isTextLeaf(ctx.el)) {
    const requestElementEdit = useEmbedPickerStore.getState().requestElementEdit;
    if (requestElementEdit?.(ctx.path)) return true;
    // The edit didn't start (path went stale between resolving `ctx` and
    // here, or the live element stopped qualifying) — fall through to the
    // descend branch below instead of doing nothing.
  }

  const child = firstChildEmbedElement(ctx.el);
  if (child) applySelection(ctx, child);

  return true;
}

/**
 * Shift+Enter while an embed element is picked moves the selection one
 * level UP — to the parent element, or, once there's no parent left
 * (top-level content), back out to the embed node itself by clearing the
 * picker selection. Mirrors native Shift+Enter's "select the parent frame".
 *
 * Always returns `true` once the picker context resolves: both outcomes
 * (parent found, or clearing back to the embed) are a handled result, never
 * a "nothing to do" that should fall through to native
 * select-parent-frame handling.
 */
export function handleEmbedElementSelectParent(): boolean {
  const ctx = resolveElementContext();
  if (!ctx) return false;

  const parent = parentEmbedElement(ctx.el, ctx.root);
  if (parent) {
    applySelection(ctx, parent);
  } else {
    useEmbedPickerStore.getState().clearSelection();
  }

  return true;
}
