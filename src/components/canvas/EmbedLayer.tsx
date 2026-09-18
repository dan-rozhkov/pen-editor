import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useRenderModeStore } from "@/store/renderModeStore";
import { useEditorModeStore, canEditScene } from "@/store/editorModeStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useViewportStore } from "@/store/viewportStore";
import {
  applyEditorVariableProperties,
  applyEmbedInheritedDefaults,
  mountHtmlWithBodyStyles,
  stripForcedEagerImageLoading,
} from "@/utils/embedHtmlUtils";
import { collectVariableValues } from "@/utils/variableCssUtils";
import { useVariableStore } from "@/store/variableStore";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import { findHiddenSelfOrAncestor } from "@/utils/nodeUtils";
import type { EmbedNode } from "@/types/scene";
import { topLevelAncestorId } from "@/utils/topLevelAncestor";
import { useOverlayHostRect } from "./useOverlayHostRect";
import {
  buildElementPath,
  describeEmbedElement,
  resolveElementPath,
  resolvePickableElement,
} from "@/lib/embedElementPicker";
import { applyEmbedElementEdit, applyEmbedElementReorder } from "@/lib/embedElementStyle";
import { isTextLeaf } from "@/lib/embedTextLeaf";
import {
  buildDropSlots,
  collectSortCandidates,
  isSortable,
  pickDropSlot,
  isNoOpSlot,
  type DropSlot,
} from "@/lib/embedElementSortable";

/** Screen-px movement past which a pointerdown-then-move becomes a drag
 * rather than a click. */
const DRAG_THRESHOLD_PX = 3;

interface ElementDragState {
  el: HTMLElement;
  /** Shadow-relative path to `el`, as produced by `buildElementPath`. */
  path: string;
  /** `el`'s in-flow candidate siblings, computed ONCE — right when the drag
   * crosses `DRAG_THRESHOLD_PX` — since which siblings are in-flow is a
   * function of computed style, and computed styles don't change over the
   * course of a gesture (see `collectSortCandidates`'s doc comment). `null`
   * until the threshold is crossed. Slots themselves are rebuilt from this
   * on EVERY `pointermove` via `buildDropSlots`, not cached: `forwardWheel`
   * deliberately keeps zoom/pan (and therefore every sibling's rect) live
   * while picking, so a slot list computed once would silently go stale —
   * the indicator would draw between the wrong siblings, and a commit would
   * follow it. */
  candidates: Element[] | null;
  /** `el`'s own rect, captured in the SAME moment as `candidates` — before
   * the visual-only ghost transform below is ever applied to `el`. Passed to
   * `buildDropSlots` every move only to decide the indicator axis at the
   * edges of the candidate list (see `embedElementSortable.ts`'s
   * `determineAxis`); using a live (transformed) rect there would drift the
   * axis decision as the drag progressed. Frozen, not re-measured — unlike
   * the *candidates'* rects, which `buildDropSlots` re-reads every frame. */
  elRect: DOMRect | null;
  /** The slot the pointer is currently over, or null when it isn't over any
   * slot (e.g. `candidates` is null, or empty). Read by `handleDragEnd` to
   * decide what to commit. */
  currentSlot: DropSlot | null;
  startClientX: number;
  startClientY: number;
  /** Only true once the pointer has moved past `DRAG_THRESHOLD_PX` — before
   * that, this is still a candidate click. */
  dragging: boolean;
  /** `el`'s original `style` attribute (or null if it had none), restored on
   * cancel/Escape. */
  originalStyle: string | null;
  /** `el`'s own computed `transform` at the moment the drag crossed the
   * threshold, or `""` when it computes to `none`. The ghost drag below must
   * not simply overwrite `transform` with its own `translate(...)` — that
   * would clobber whatever the element's own CSS was expressing (e.g. a
   * centering `translateX(-50%)`, or a `rotate(...)`), visibly snapping the
   * element to an untransformed position the instant the drag starts.
   * Composed as `translate(dx, dy) ${baseTransform}` (translate OUTSIDE, so
   * the drag offset stays in screen axes regardless of what the base
   * transform does to the element's own coordinate system). */
  baseTransform: string;
  /** The `pointerId` that started this drag — move/up/cancel from any other
   * pointer (a second finger/stylus landing anywhere while this drag is in
   * flight) must be ignored rather than ending or steering THIS drag. */
  pointerId: number;
  /** The embed's `htmlContent` at the moment this drag started, so
   * pointerup can detect it changed mid-gesture (a streamed
   * `edit_embed_html`/`batch_design` mutation, or an undo) — see the
   * staleness check in `handleDragEnd`. */
  htmlAtPointerDown: string;
}

/** A single text-leaf element mid inline-edit (see the dblclick handler
 * below), from the moment it's made `contenteditable` to commit/cancel. */
interface ElementEditState {
  el: HTMLElement;
  /** Shadow-relative path to `el`, as produced by `buildElementPath` — same
   * shape `applyEmbedElementEdit` (and the sortable drag above) expects. */
  path: string;
  /** `el.innerHTML` at the moment editing started (captured BEFORE
   * `contenteditable` is ever set — see `beginElementEdit`), for both the
   * changed-or-not check on commit and the full revert on Escape.
   * Deliberately `innerHTML`, not `textContent`: `isTextLeaf` (see
   * `embedTextLeaf.ts`) lets a text leaf carry structural children it
   * doesn't itself require to have text (`SKIP_TAGS` — `<img>`, `<svg>`,
   * `<br>`, ... — exactly the Phosphor-icon-inside-a-button idiom the
   * showcase's HTML is full of), and `target.textContent = value` deletes
   * every child ELEMENT outright on both the commit and the revert path.
   * `innerHTML` round-trips them because the element stays
   * `contenteditable="plaintext-only"` for the whole edit — the browser
   * itself refuses to let the user type markup into it, so nothing but
   * this element's own original markup (plus plain-text edits to its own
   * text nodes) can ever end up here. */
  originalInnerHtml: string;
  /** `originalInnerHtml` with `mountHtmlWithBodyStyles`'s mount-time-only
   * additions (`forceEagerImageLoading`'s `loading`/`decoding` attributes on
   * descendant `<img>`/`<iframe>` elements — `isTextLeaf` explicitly allows
   * those as `SKIP_TAGS` children of a text leaf) stripped back out via
   * `stripForcedEagerImageLoading`. `commitElementEdit` diffs the live
   * element's (likewise-stripped) `innerHTML` against THIS, not
   * `originalInnerHtml` — the live element was mounted through the same
   * forcing pass, so comparing against the unstripped baseline would just
   * cancel out for "nothing changed" but would let the attributes the
   * author never wrote ride along into `htmlContent` the moment a real
   * change is committed. Never used for the Escape revert (see
   * `originalInnerHtml`'s own doc comment) — that puts these attributes
   * BACK onto the live DOM on purpose, since removing them would be exactly
   * the WebKit lazy-load regression `forceEagerImageLoading` exists to
   * prevent. */
  commitBaselineInnerHtml: string;
  /** The embed's `htmlContent` at the moment editing started, so a commit
   * can detect it changed mid-edit (a streamed `edit_embed_html`/
   * `batch_design` mutation, or an undo) — mirrors
   * `ElementDragState.htmlAtPointerDown`. */
  htmlAtEditStart: string;
  /** Bound to `el` itself (not `window`), so Enter — which has no window-level
   * counterpart at all — can be handled locally, and so Escape still reverts
   * the live element even in a context with no global keyboard handler
   * mounted (e.g. this component's own unit tests). This is NOT what makes
   * Escape safe against `keyboardCommands.ts`'s global `window`-capture
   * handler, despite an earlier version of this comment claiming so: a
   * capture-phase listener on `window` always runs before ANY listener
   * scoped to a descendant target, `el` included, regardless of registration
   * order — capture phase visits ancestors top-down, and `window` is the
   * topmost one. What actually makes Escape safe is `cancelElementEdit`
   * being registered on `embedPickerStore` (mirroring `cancelElementDrag`)
   * and invoked by that global handler BEFORE it falls through to
   * `exitContainer()` — see `keyboardCommands.ts`'s Escape block. This
   * listener's own Escape branch still runs afterwards (the global handler
   * never calls `stopPropagation`), but by then `edit` is already `null` and
   * `cancelElementEdit` is a no-op. */
  handleKeyDown: (e: KeyboardEvent) => void;
  handleBlur: () => void;
  /** Intercepts `paste` on `el` and inserts clipboard PLAIN text only — see
   * its registration in `beginElementEdit` for why `contenteditable=
   * "plaintext-only"` alone can't be trusted to keep markup out (an
   * unsupported value silently degrades to plain `"true"` in some engines,
   * and a degraded editable region has no built-in protection against a
   * pasted `<b>`/`<a>`/... fragment landing verbatim in `innerHTML`). */
  handlePaste: (e: ClipboardEvent) => void;
}

/** An in-progress "move the embed NODE itself" gesture. A pointerdown that
 * lands in the embed anywhere other than the element the picker already has
 * selected (see `handlePointerDown`'s `isCurrentSelection` gate) is not a
 * sortable reorder — it is forwarded to Pixi's own `dragController` so the
 * embed moves on the canvas exactly like a native node (snapping, smart
 * guides, one history entry), instead of reimplementing that here with
 * hand-rolled coordinates. Once the gesture crosses `DRAG_THRESHOLD_PX`, a
 * synthetic `pointerdown` is dispatched at the Pixi `<canvas>` (see
 * `beginNodeDragForward`/`forwardPointerEvent`), and every later real
 * pointermove/pointerup for the SAME pointer is forwarded there too — never
 * processed locally, since from that moment `dragController` owns the
 * gesture.
 *
 * Lives at MODULE scope, not inside any one embed's picking effect —
 * deliberately, unlike the sortable element drag right above, which stays
 * effect-local. The synthetic `pointerdown` this forwards can make
 * `dragController` call `select(hitId)` against whatever Pixi node the
 * hit-test finds at that point, which may be a DIFFERENT node drawn over
 * this embed; that flips `pickingEmbedId` away from this embed and tears
 * down the very picking effect that started the gesture. A gesture already
 * forwarded to Pixi must keep receiving its `pointermove`/`pointerup`
 * regardless of which (if any) embed's picking effect is currently
 * mounted, or the user's own drag would silently die the instant Pixi's
 * hit-test picked something other than this embed — see the code review
 * finding this fixed. Only one such gesture can be in flight at a time,
 * pointerId-gated like every other gesture in this file. */
interface NodeDragForwardState {
  pointerId: number;
  /** The page-coordinate position of the ORIGINAL pointerdown — reused as
   * the synthetic pointerdown's `clientX/Y` once the threshold is crossed.
   * See `handleNodeDragForwardMove`'s doc comment for why this must be the
   * original position rather than wherever the pointer has drifted to by
   * then. */
  startClientX: number;
  startClientY: number;
  /** Resolved once, at pointerdown (`beginNodeDragForward`) — the DOM
   * around the host can't change mid-gesture, so there is nothing to gain
   * by re-querying it on every move. */
  canvas: HTMLCanvasElement;
  /** True once the gesture has crossed `DRAG_THRESHOLD_PX` and the initial
   * synthetic pointerdown has been dispatched. Before that, this is still a
   * candidate click and nothing has been forwarded to Pixi at all. */
  started: boolean;
}

let nodeDragForward: NodeDragForwardState | null = null;

/** Set right after a STARTED node-drag forward's `pointerup` reaches Pixi,
 * and consumed by the next `click` any embed host's picking effect sees.
 * Module-level for the same reason `nodeDragForward` itself is: the forward
 * can outlive the effect that began it, so the effect that eventually
 * receives the browser's own trailing `click` (mouseup landed on the same
 * host it went down on) may not be the one whose `handleNodeDragForward*`
 * ran at all. */
let suppressNextEmbedClickAfterNodeDrag = false;

/** One-shot read: returns whether the next `click` should be swallowed, and
 * clears the flag either way — a `click` this function is never asked about
 * (e.g. one landing on a wholly unrelated embed) must not leave a stale
 * `true` around to wrongly swallow some later, unrelated click. */
function takeSuppressNextEmbedClickAfterNodeDrag(): boolean {
  const value = suppressNextEmbedClickAfterNodeDrag;
  suppressNextEmbedClickAfterNodeDrag = false;
  return value;
}

/** Re-dispatches a real DOM `PointerEvent` at the Pixi canvas, copying every
 * field `pixiInteractionCore`'s own handlers read — see the (now removed)
 * per-effect copy's doc comment history for the full rationale; unchanged
 * here, just lifted to module scope so it has no per-embed closure to
 * depend on. `bubbles: false` remains load-bearing for the same
 * infinite-forward-loop reason. */
function forwardPointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  e: PointerEvent,
  canvas: HTMLCanvasElement,
  overrideClientX?: number,
  overrideClientY?: number,
): void {
  canvas.dispatchEvent(
    new PointerEvent(type, {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      isPrimary: e.isPrimary,
      button: e.button,
      buttons: e.buttons,
      clientX: overrideClientX ?? e.clientX,
      clientY: overrideClientY ?? e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      bubbles: false,
      cancelable: true,
    }),
  );
}

/** Aborts a forwarded gesture at the canvas end without a live event to copy
 * fields from — same as before, lifted to module scope. */
function sendSyntheticCancel(pointerId: number, canvas: HTMLCanvasElement): void {
  canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId, bubbles: false, cancelable: true }));
}

function endNodeDragForward(): void {
  nodeDragForward = null;
  window.removeEventListener("pointermove", handleNodeDragForwardMove);
  window.removeEventListener("pointerup", handleNodeDragForwardEnd);
  window.removeEventListener("pointercancel", handleNodeDragForwardCancel);
}

/** Self-heals a previous forward that never got a matching pointerup/
 * pointercancel (e.g. the button was released over browser chrome outside
 * the window) — mirrors the sortable drag's own self-healing in
 * `handlePointerDown`, but for the module-level forward. Called both before
 * starting a fresh forward and directly from every embed's own
 * `handlePointerDown`, so a stale forward is cleaned up regardless of which
 * kind of gesture the next pointerdown turns out to start. */
function healStaleNodeDragForward(): void {
  if (!nodeDragForward) return;
  const stale = nodeDragForward;
  endNodeDragForward();
  if (stale.started) sendSyntheticCancel(stale.pointerId, stale.canvas);
}

function handleNodeDragForwardMove(e: PointerEvent): void {
  if (!nodeDragForward || e.pointerId !== nodeDragForward.pointerId) return;
  if (!nodeDragForward.started) {
    const dxScreen = e.clientX - nodeDragForward.startClientX;
    const dyScreen = e.clientY - nodeDragForward.startClientY;
    if (Math.hypot(dxScreen, dyScreen) <= DRAG_THRESHOLD_PX) return;
    nodeDragForward.started = true;
    // Mirrors the sortable drag's own gate right after ITS threshold
    // crossing: once this is unambiguously a drag, a hover box chasing the
    // cursor over the embed's own content would be pure noise on top of
    // whatever Pixi now draws for the node drag (a selection outline, smart
    // guides, ...).
    useEmbedPickerStore.getState().setHoveredPath(null);
    // The FIRST synthetic event must be a `pointerdown` at the ORIGINAL
    // pointerdown position: `dragController` reads that position once, as
    // `startWorldX/Y`, and computes every later move as a delta against
    // it. Forwarding this move's (already-past-threshold) position as the
    // pointerdown instead would silently discount the first
    // `DRAG_THRESHOLD_PX` of motion from that delta — the node would jump
    // back by a few pixels the instant the forwarded drag caught up with
    // the real cursor.
    forwardPointerEvent(
      "pointerdown",
      e,
      nodeDragForward.canvas,
      nodeDragForward.startClientX,
      nodeDragForward.startClientY,
    );
  }
  forwardPointerEvent("pointermove", e, nodeDragForward.canvas);
}

function handleNodeDragForwardEnd(e: PointerEvent): void {
  if (!nodeDragForward || e.pointerId !== nodeDragForward.pointerId) return;
  const d = nodeDragForward;
  endNodeDragForward();
  if (!d.started) return; // never crossed the threshold: a plain click
  forwardPointerEvent("pointerup", e, d.canvas);
  // The `click` the browser still fires right after this pointerup (mouseup
  // landed on the same element it went down on) must not re-run picker
  // selection on WHICHEVER embed host ends up receiving it — mirrors the
  // sortable drag's own `suppressNextClick`, but module-level since the
  // host that receives the trailing click may not be the one whose effect
  // started this forward (see `nodeDragForward`'s own doc comment).
  suppressNextEmbedClickAfterNodeDrag = true;
  // A browser fires that trailing `click` synchronously as part of the same
  // native input-processing pass as this `pointerup` — but NOT in the same
  // microtask checkpoint: the call stack empties between the browser's
  // internal dispatch of `pointerup`, `mouseup` and `click` (they are
  // separate top-level `dispatchEvent` calls, not one nested call), so a
  // `queueMicrotask` reset here used to run and clear the flag BEFORE the
  // trailing `click` handler in this same file ever got a chance to read
  // it — the exact bug this comment now documents rather than repeats.
  // `setTimeout(0)` is a real MACROtask boundary: nothing scheduled via
  // `setTimeout` can run before the browser's own trailing `click` has
  // already been dispatched (a synchronous native follow-on to `pointerup`
  // can never be delayed behind a task the event loop hasn't even reached
  // yet). That is also why this still can't leak into a later, unrelated
  // click: if the trailing `click` never happens at all (mouseup released
  // over the Pixi canvas or off-window), the flag still gets cleared a
  // macrotask later, long before a user could physically produce another
  // click of their own.
  setTimeout(() => {
    suppressNextEmbedClickAfterNodeDrag = false;
  }, 0);
}

function handleNodeDragForwardCancel(e: PointerEvent): void {
  if (!nodeDragForward || e.pointerId !== nodeDragForward.pointerId) return;
  const d = nodeDragForward;
  endNodeDragForward();
  if (d.started) sendSyntheticCancel(d.pointerId, d.canvas);
}

/** Starts a candidate node-move gesture — see `NodeDragForwardState`'s doc
 * comment for the overall approach. Self-heals any stray previous forward
 * first (see `healStaleNodeDragForward`). */
function beginNodeDragForward(e: PointerEvent, canvas: HTMLCanvasElement): void {
  healStaleNodeDragForward();
  nodeDragForward = {
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    canvas,
    started: false,
  };
  // Window-level, not host-level: the pointer routinely leaves the
  // (possibly small) host bounds mid-drag.
  window.addEventListener("pointermove", handleNodeDragForwardMove);
  window.addEventListener("pointerup", handleNodeDragForwardEnd);
  window.addEventListener("pointercancel", handleNodeDragForwardCancel);
}

/** One Shadow-DOM host for a single embed node, synced to the viewport. */
function EmbedHost({ nodeId }: { nodeId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // The element `mountHtmlWithBodyStyles` actually applied custom properties
  // to — `contentRef.current` itself for most embeds, but a synthetic
  // `<body>` NESTED inside it for a body-targeted one (see `MountResult`).
  // The live variable-update effect below must target the same element the
  // mount did, or `applyEditorVariableProperties` would set properties on an
  // element the embed's own CSS never inherits from.
  const mountRootRef = useRef<HTMLElement | null>(null);

  const node = useSceneStore((s) => s.nodesById[nodeId]) as EmbedNode | undefined;
  const isActive = useSelectionStore((s) => s.activeEmbedId === nodeId);
  const isPicking = useEmbedPickerStore((s) => s.pickingEmbedId === nodeId);
  const isEditingElement = useEmbedPickerStore((s) => s.editingEmbedId === nodeId);

  const htmlContent = node?.htmlContent;
  const width = node?.width;
  const height = node?.height;

  // Scale the inner content to match the viewport zoom. The outer host rect and
  // the store subscriptions are handled by the shared overlay hook; this callback
  // is the embed-specific extra. (Geometry stays imperative so a React re-render —
  // e.g. on active toggle — never clobbers it.)
  const syncContentScale = useCallback((scale: number) => {
    const content = contentRef.current;
    if (content) content.style.transform = `scale(${scale})`;
  }, []);

  const position = useOverlayHostRect(hostRef, nodeId, syncContentScale);

  // (Re)mount embed content into the shadow root on html/size/theme change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || htmlContent == null || width == null || height == null) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.replaceChildren();

    const content = document.createElement("div");
    content.style.transformOrigin = "top left";
    content.style.width = `${width}px`;
    content.style.height = `${height}px`;
    content.style.overflow = "auto";
    applyEmbedInheritedDefaults(content);
    // mountHtmlWithBodyStyles hoists allowlisted external font stylesheets
    // (Google Fonts / Phosphor icon fonts) to document level — Chrome only
    // registers `@font-face` fonts from document-level styles, never from a
    // shadow tree, so without this icon/text web fonts render as tofu.
    //
    // Editor variables are deliberately NOT baked into `htmlContent` as an
    // extra `<style>:root{...}</style>` block here (an earlier version of
    // this mount did exactly that, via `buildVariableStyleBlock`). That
    // block would become literal, permanent markup inside `content` —
    // indistinguishable, on any later re-harvest, from an authored `:root`
    // rule the embed's own HTML actually declares. `applyEditorVariableProperties`
    // below needs to tell those apart (an authored rule is the fallback when
    // a variable is deleted; the editor's own injected rule must never be
    // mistaken for it) — see that function's doc comment — so the ONLY path
    // that ever sets editor values onto the mounted root is that call,
    // both here and in the live-update effect right below.
    const mountResult = mountHtmlWithBodyStyles(content, htmlContent, width, height);
    shadow.appendChild(content);
    contentRef.current = content;
    mountRootRef.current = mountResult.root;

    applyEditorVariableProperties(
      content,
      mountResult.root,
      collectVariableValues(undefined, getEffectiveThemeForNode(nodeId)),
    );

    // Position now that content exists (applies the current scale transform).
    position();

    return () => { contentRef.current = null; mountRootRef.current = null; };
  }, [position, nodeId, htmlContent, width, height]);

  // Live-update editor variables on the already-mounted content root when the
  // Variables tab changes, WITHOUT remounting the shadow DOM (the effect
  // above) — a remount would reset the embed's scroll position and tear down
  // any live element-picker gesture (`ElementDragState`/`ElementEditState`
  // above are both anchored to specific live DOM nodes a remount detaches).
  // Uses the store's imperative `subscribe` rather than a reactive
  // `useVariableStore(s => s.variables)` selector on purpose: the `variables`
  // array is a new reference on every store mutation, so a selector would
  // re-render this component (and re-run this effect) on every keystroke of
  // an unrelated edit elsewhere in the app; subscribing lets this effect
  // decide for itself when to touch the DOM (mirrors `pixiSync.ts`'s own
  // `useVariableStore.subscribe` idiom for scene-wide theme updates).
  //
  // Theme changes (a frame's `themeOverride`, or the global active theme)
  // are NOT wired up here — this mirrors the existing mount effect, whose
  // deps also don't include theme, so an embed already doesn't live-update
  // on a theme change today. That gap is out of scope for this change.
  useEffect(() => {
    const applyVariables = () => {
      const container = contentRef.current;
      const root = mountRootRef.current;
      if (!container || !root) return; // not mounted (yet, or anymore)
      applyEditorVariableProperties(
        container,
        root,
        collectVariableValues(undefined, getEffectiveThemeForNode(nodeId)),
      );
    };
    return useVariableStore.subscribe(applyVariables);
  }, [nodeId]);

  // Element-picking mode: hover highlights, click selects, and a drag past
  // the threshold REORDERS the element among its in-flow siblings — it does
  // NOT reposition it via coordinates. A free coordinate drag (the gesture's
  // previous form) wrote `position`/`left`/`top`/`margin`, which took the
  // element out of the layout its own CSS specified and broke whatever
  // alignment that CSS was expressing; sortable reordering never writes a
  // coordinate at all; the only committed mutation is moving the node in the
  // DOM (`applyEmbedElementReorder` in `embedElementStyle.ts`). Out-of-flow
  // elements (`position: absolute`/`fixed`) are excluded from the drag
  // entirely (see `isSortable` in `embedElementSortable.ts`): such an
  // element is placed relative to its containing block, not its position in
  // the DOM, so reordering it among siblings would change paint order but
  // move nothing on screen — the drag would look like a no-op. Guarded
  // against inline-edit mode (isActive) — that mode already owns pointer
  // events on the host for real interaction with the embedded page.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !isPicking || isActive) return;

    const shadowRoot = () => host.shadowRoot ?? null;

    /** Locates the real Pixi `<canvas>` sitting alongside this host — the
     * host is a *sibling* DOM subtree (a Shadow-DOM overlay), not a Pixi
     * container, so nothing about it reaches Pixi's own listeners via
     * bubbling; every forward in this effect (wheel, multitouch, and the
     * initial pointerdown that hands a node-move gesture off to the
     * module-level forward above) has to look the canvas up explicitly and
     * dispatch directly at it. Shared by all of them rather than duplicated,
     * since they all need the exact same canvas. */
    const findPixiCanvas = (): HTMLCanvasElement | null =>
      host.closest<HTMLElement>("[data-canvas]")?.querySelector<HTMLCanvasElement>("canvas") ??
      null;

    // Last composedPath()[0] seen by handleMove, so a run of pointermove
    // events over the *same* element (60+/s while the pointer drifts a
    // pixel at a time) skips buildElementPath (a querySelectorAll per
    // ancestor id) and the store write entirely instead of repeating both
    // on every raw event.
    let lastMoveTarget: EventTarget | null = null;

    // In-progress element drag (pointerdown -> pointermove* -> pointerup),
    // or null when idle. A plain local (not a React ref) since it's only
    // ever read/written from the imperative listeners this effect owns.
    // (The "move the embed node itself" counterpart lives at module scope —
    // see `nodeDragForward` above — because unlike this one it must survive
    // this very effect tearing down mid-gesture.)
    let drag: ElementDragState | null = null;
    // Set true by pointerup right after committing (or by Escape right after
    // reverting) a drag that actually moved past the threshold, so the
    // `click` event the browser still fires afterwards (mouseup landed on
    // the same element it went down on) doesn't re-run selection logic.
    let suppressNextClick = false;
    // True for the duration of a touch series (since the last touchstart
    // with zero already-active touches) that started as multitouch — see
    // `handleTouchStart` below for why the gesture keeps forwarding even
    // after the finger count later drops below 2.
    let multitouchForwardActive = false;
    // A deferred re-entry into text-edit mode, queued by `handleDblClick`
    // right after committing a previous edit — see that handler's own
    // comment for why entry has to wait a frame. Tracked so effect teardown
    // can cancel a still-pending one rather than leave it to fire against a
    // host that may no longer even be picking.
    let pendingEditFrame: number | null = null;
    // Flipped true at the top of this effect's cleanup, and checked inside
    // `pendingEditFrame`'s callback — `requestAnimationFrame` has no cancel
    // that also runs a "cancelled" branch, so a check-the-flag guard is what
    // stops the deferred edit-entry from firing against a host that may no
    // longer even be picking (or may have been torn down entirely) by the
    // time the frame lands.
    let disposed = false;

    // In-progress single-element text edit (dblclick on a text leaf ->
    // contenteditable -> commit/cancel), or null when idle. Local, like
    // `drag`, for the same reason: only ever read/written from the
    // imperative listeners this effect owns.
    let edit: ElementEditState | null = null;

    /** True when `e` targets (or targets a descendant of) the element
     * currently being inline-edited. Used to let native caret placement,
     * text selection and word-selecting dblclicks through untouched, while
     * every other picker gesture still treats the embed as fully inert. */
    const eventTargetsEditingElement = (e: Event): boolean =>
      edit !== null && e.composedPath().includes(edit.el);

    /** True when `root` implements its own `getSelection` (real Chrome gives
     * every shadow tree one). Shared by `getShadowSelection` and
     * `clearTextSelectionIn` so the two agree on which browser path we're
     * on — see `clearTextSelectionIn`'s comment for why that matters. */
    const shadowHasOwnSelection = (root: ShadowRoot): boolean =>
      typeof (root as unknown as { getSelection?: unknown }).getSelection === "function";

    /** The live `Selection` for content mounted inside `root` — prefers the
     * shadow root's own `getSelection` (real browsers give each shadow tree
     * its own), falling back to `document.getSelection()` where that isn't
     * implemented. Shared by `selectAllTextIn` and `insertPlainTextAtCaret`
     * so the two can't drift on how they find it. `null` in an environment
     * with neither (happy-dom, in unit tests) — every caller treats that as
     * "no live selection to work with" rather than an error. */
    const getShadowSelection = (root: ShadowRoot): Selection | null => {
      if (shadowHasOwnSelection(root)) {
        return (root as unknown as { getSelection: () => Selection | null }).getSelection();
      }
      return document.getSelection();
    };

    /** Select `el`'s full text content, so typing right after entering edit
     * mode replaces it (matching double-click-to-edit conventions
     * elsewhere in the editor). Best-effort: happy-dom (unit tests) has no
     * real `Selection` implementation and no `ShadowRoot.getSelection`, and
     * a degraded/empty selection here is not worth failing edit-mode entry
     * over. */
    const selectAllTextIn = (el: HTMLElement, root: ShadowRoot) => {
      try {
        const selection = getShadowSelection(root);
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        // See the comment above — never let a selection failure block entry.
      }
    };

    /** Clears the live `Selection` left over from text-edit mode, but only
     * when it's actually still inside `el` — the same containment check
     * `insertPlainTextAtCaret` uses, so we never rip out a selection the
     * user made elsewhere (e.g. they clicked into a different element while
     * this one's blur handler is still unwinding). `beginElementEdit` calls
     * `selectAllTextIn` to select the whole element on entry; removing
     * `contenteditable` on exit does NOT clear that selection by itself, so
     * without this the highlighted text stays visibly selected on screen
     * after edit mode ends. Best-effort/try-catch for the same reason as
     * `selectAllTextIn`: no real `Selection`/`ShadowRoot.getSelection` in
     * happy-dom.
     *
     * `el.contains(...)` alone is a Chrome-only check. `getShadowSelection`
     * only gets a shadow-scoped `Selection` when `root.getSelection` exists
     * (Chrome); in WebKit/Firefox, which don't implement
     * `ShadowRoot.getSelection`, it falls back to `document.getSelection()`
     * — and the browser RETARGETS nodes crossing a shadow boundary for that
     * call, so `range.commonAncestorContainer` comes back as the shadow HOST
     * (or an ancestor of it) rather than the actual editable node inside the
     * shadow tree. `el.contains(host)` is always false, so without a second
     * path this silently never clears the selection outside Chrome — exactly
     * the kind of WebKit-only regression that's easy to ship unnoticed. When
     * `root` has no own `getSelection`, we instead ask the retargeted range
     * whether it `intersectsNode(host)` — `host` is the actual DOM node the
     * (possibly retargeted) range can still be compared against, so this
     * still refuses to touch a selection that's genuinely outside our embed. */
    const clearTextSelectionIn = (el: HTMLElement, root: ShadowRoot | null, host: HTMLElement) => {
      if (!root) return;
      try {
        const selection = getShadowSelection(root);
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        const insideViaContainment = el.contains(range.commonAncestorContainer);
        const insideViaRetargetedIntersection =
          !shadowHasOwnSelection(root) &&
          typeof range.intersectsNode === "function" &&
          range.intersectsNode(host);
        if (!insideViaContainment && !insideViaRetargetedIntersection) return;
        selection.removeAllRanges();
      } catch {
        // See the comment above — never let a selection failure block exit.
      }
    };

    /** Inserts plain-text `text` at the live caret inside `el` (replacing
     * any active selection first, matching normal paste semantics), and
     * reports whether it managed to. Used by `handlePaste` below to keep
     * pasted content plain regardless of whether `contenteditable=
     * "plaintext-only"` is actually honoured — see that handler's own
     * comment. Returns `false` (does nothing) rather than throwing when
     * there's no usable `Selection`/`Range`, or the caret isn't inside
     * `el` at all (a paste can only legitimately land in the element that
     * dispatched it, but a defensive check costs nothing here). */
    const insertPlainTextAtCaret = (el: HTMLElement, root: ShadowRoot | null, text: string): boolean => {
      if (!root) return false;
      try {
        const selection = getShadowSelection(root);
        if (!selection || selection.rangeCount === 0) return false;
        const range = selection.getRangeAt(0);
        if (!el.contains(range.commonAncestorContainer)) return false;
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      } catch {
        return false;
      }
    };

    /** Leave text-edit mode, reverting `el`'s content and writing nothing to
     * the scene — the Escape path. `innerHTML`, not `textContent` — see
     * `ElementEditState.originalInnerHtml`'s doc comment: a `textContent`
     * revert would drop every structural child (an icon `<i>`, a `<br>`,
     * ...) the element started with, "reverting" it into something worse
     * than what the user typed. */
    const cancelElementEdit = () => {
      if (!edit) return;
      const e = edit;
      edit = null;
      e.el.removeEventListener("keydown", e.handleKeyDown, true);
      e.el.removeEventListener("blur", e.handleBlur);
      e.el.removeEventListener("paste", e.handlePaste);
      e.el.innerHTML = e.originalInnerHtml;
      e.el.removeAttribute("contenteditable");
      // Removing `contenteditable` doesn't clear the selection `beginElementEdit`
      // made with `selectAllTextIn` — left alone, the highlight stays visible
      // on screen after Escape. See `clearTextSelectionIn`'s own comment.
      clearTextSelectionIn(e.el, shadowRoot(), host);
      useEmbedPickerStore.getState().stopElementEdit();
      // Unregister — a stale callback here would let a LATER Escape (once
      // some other gesture has re-armed `cancelElementDrag`, say) find a
      // dangling reference into this already-finished edit. Symmetric with
      // `setCancelElementDrag(null)` in `endDrag`.
      useEmbedPickerStore.getState().setCancelElementEdit(null);
    };

    /** Leave text-edit mode, committing changed markup to `htmlContent` —
     * the Enter/blur/pointerdown-elsewhere/teardown path. Idempotent: safe
     * to call when nothing is being edited. */
    const commitElementEdit = () => {
      if (!edit) return;
      const e = edit;
      edit = null;
      e.el.removeEventListener("keydown", e.handleKeyDown, true);
      e.el.removeEventListener("blur", e.handleBlur);
      e.el.removeEventListener("paste", e.handlePaste);
      // Symmetric with `cancelElementEdit` — see that function's own comment.
      useEmbedPickerStore.getState().setCancelElementEdit(null);

      // `contenteditable` must be gone from the live element BEFORE reading
      // `innerHTML` for either the changed-or-not compare below or the
      // value handed to `applyEmbedElementEdit` — otherwise the attribute
      // that only ever exists to make typing possible would ride along
      // into `htmlContent` itself.
      e.el.removeAttribute("contenteditable");
      // Symmetric with `cancelElementEdit` — see `clearTextSelectionIn`'s own
      // comment. Safe to do before the innerHTML read/diff below: it only
      // touches the live `Selection`, never `e.el`'s content.
      clearTextSelectionIn(e.el, shadowRoot(), host);

      // Read off a detached CLONE, never `e.el` itself: the live element was
      // mounted through `mountHtmlWithBodyStyles`, which ran
      // `forceEagerImageLoading` over it and may have added `loading`/
      // `decoding` attributes to a descendant `<img>`/`<iframe>` the author's
      // own markup never had (`isTextLeaf` allows those as `SKIP_TAGS`
      // children of a text leaf, so this is a real, reachable case, not a
      // hypothetical one). Stripping the LIVE element instead would revert
      // that image right back to lazy loading — the WebKit off-screen bug
      // `forceEagerImageLoading` exists to prevent — for no reason, since
      // this edit has nothing to do with image loading at all.
      const clone = e.el.cloneNode(true) as HTMLElement;
      stripForcedEagerImageLoading(clone);
      const innerHtml = clone.innerHTML;

      useEmbedPickerStore.getState().stopElementEdit();

      // Diffed against the STRIPPED baseline (see
      // `ElementEditState.commitBaselineInnerHtml`'s doc comment), not
      // `originalInnerHtml` — both sides of this comparison must have gone
      // through the same stripping for "nothing changed" to mean what it
      // says rather than just happening to cancel out.
      if (innerHtml === e.commitBaselineInnerHtml) return; // nothing changed — no write

      // Mirrors the sortable drag commit's permission gate below: a picker
      // edit must not be able to write to the scene in a non-editable mode,
      // even though entry (the dblclick handler) already checked this —
      // the mode can change while an edit is in flight.
      if (!canEditScene(useEditorModeStore.getState().mode)) return;

      const currentHtml = useSceneStore.getState().nodesById[nodeId] as EmbedNode | undefined;
      const html = currentHtml?.htmlContent ?? "";

      // The embed's htmlContent (and therefore its shadow DOM) may have
      // changed mid-edit — a streamed `edit_embed_html`/`batch_design`
      // mutation or an undo. `e.el` can then be detached, and even when
      // it's still connected, `e.path` may now resolve to a different
      // element in the new html. Bail without writing rather than
      // overwriting whatever now occupies that path with this element's
      // typed text.
      if (!e.el.isConnected || html !== e.htmlAtEditStart) return;

      const result = applyEmbedElementEdit(html, e.path, { innerHtml });
      if (!result) return;

      // ORDER MATTERS — see the sortable drag's commit below and
      // EmbedElementProperties.applyEdit: `noteSelectionEdit` must land
      // before `updateNode` writes the new `htmlContent`, or
      // `useEmbedPickerLifecycle`'s synchronous staleness check clears the
      // selection it was meant to keep alive.
      useEmbedPickerStore.getState().noteSelectionEdit(result.html, result.outerHtml);
      useSceneStore.getState().updateNode(nodeId, { htmlContent: result.html });
    };

    /** Enter text-edit mode for `el` (already confirmed to be a text leaf
     * inside this embed's content) at `path`. */
    const beginElementEdit = (el: HTMLElement, path: string) => {
      // Captured BEFORE `contenteditable` is ever set below, and the
      // picker-selection snapshot taken BEFORE it too: `describeEmbedElement`
      // reads `el.outerHTML` off the live element, and an attribute that
      // exists only to make typing possible must never show up in either
      // the revert snapshot or the `outerHtml` handed to the properties
      // panel / agent's `canvasContext`.
      const originalInnerHtml = el.innerHTML;
      // See `ElementEditState.commitBaselineInnerHtml`'s doc comment: a
      // stripped baseline, computed once here so `commitElementEdit`'s diff
      // (also stripped) compares like with like.
      const baselineClone = el.cloneNode(true) as HTMLElement;
      stripForcedEagerImageLoading(baselineClone);
      const commitBaselineInnerHtml = baselineClone.innerHTML;
      const currentHtml = useSceneStore.getState().nodesById[nodeId] as EmbedNode | undefined;
      const htmlAtEditStart = currentHtml?.htmlContent ?? "";

      const root = shadowRoot();
      if (root) {
        const current = useEmbedPickerStore.getState().selection;
        if (!current || current.embedId !== nodeId || current.path !== path) {
          const selection = describeEmbedElement(el, root, nodeId);
          if (selection.path) {
            useEmbedPickerStore.getState().selectElement(selection, htmlAtEditStart);
          }
        }
      }

      // Chrome degrades an unsupported `contenteditable` value to the
      // nearest one it knows (here, plain "true") rather than throwing, so
      // this is safe everywhere even though `plaintext-only` isn't
      // universal yet; happy-dom just stores whatever string it's given.
      el.setAttribute("contenteditable", "plaintext-only");
      el.focus();

      if (root) selectAllTextIn(el, root);

      const handleKeyDown = (ke: KeyboardEvent) => {
        if (ke.key === "Escape") {
          ke.preventDefault();
          ke.stopPropagation();
          cancelElementEdit();
          return;
        }
        if (ke.key === "Enter" && !ke.shiftKey) {
          ke.preventDefault();
          ke.stopPropagation();
          commitElementEdit();
        }
      };
      const handleBlur = () => commitElementEdit();

      // `contenteditable="plaintext-only"` is what's SUPPOSED to make
      // `innerHtml`'s "verbatim, safe to trust" guarantee (see
      // `EmbedElementEdit.innerHtml`'s doc comment in `embedElementStyle.ts`)
      // hold — but an engine that doesn't support the value degrades it to
      // plain `"true"` rather than throwing (the same fact `el.setAttribute`
      // above relies on), and a degraded editable region has NO built-in
      // protection against a pasted rich-text fragment landing as real
      // markup. Intercepting `paste` here and inserting plain text ourselves
      // makes the guarantee hold independent of that browser support matrix,
      // rather than merely on browsers where the degradation happens not to
      // occur. Bound to `el` itself, inside the shadow tree, for the same
      // reason `handleKeyDown`/`handleBlur` are.
      const handlePaste = (pe: ClipboardEvent) => {
        pe.preventDefault();
        const text = pe.clipboardData?.getData("text/plain") ?? "";
        if (!text) return;
        if (!insertPlainTextAtCaret(el, root, text)) {
          // No usable Selection/Range in this environment — see
          // `selectAllTextIn`'s own comment (happy-dom has neither a real
          // `Selection` nor `ShadowRoot.getSelection`). Appending at the end
          // loses caret position but keeps the one invariant this handler
          // exists for: plain text only, never markup.
          el.appendChild(document.createTextNode(text));
        }
      };

      el.addEventListener("keydown", handleKeyDown, true);
      el.addEventListener("blur", handleBlur);
      el.addEventListener("paste", handlePaste);

      edit = {
        el,
        path,
        originalInnerHtml,
        commitBaselineInnerHtml,
        htmlAtEditStart,
        handleKeyDown,
        handleBlur,
        handlePaste,
      };
      useEmbedPickerStore.getState().startElementEdit(nodeId, path);
      // Registered so the GLOBAL Escape handler (`keyboardCommands.ts`) can
      // cancel this edit before it falls through to `exitContainer()` —
      // mirrors `cancelElementDrag` right above, and fixes the same class of
      // bug: `exitContainer()`'s own Escape handling sees this edit's
      // `selectElement` picker selection and, without this, would clear it
      // as an unrelated side effect of an Escape that was only ever meant to
      // cancel the text edit. See `ElementEditState.handleKeyDown`'s doc
      // comment for why this can't instead be won by listener registration
      // order.
      useEmbedPickerStore.getState().setCancelElementEdit(cancelElementEdit);
    };

    /** Registered as `embedPickerStore`'s `requestElementEdit` — see that
     * field's own doc comment for why the keyboard handler can't just call
     * `beginElementEdit` directly. Resolves `path` against the CURRENT
     * shadow DOM (never trusts a caller-held element reference, matching
     * the dblclick handler's own re-resolve-by-path discipline above) and
     * only proceeds for a live text-leaf element.
     *
     * This is `beginElementEdit`'s THIRD entry point, alongside
     * `handlePointerDown`/`handleDblClick` above — but unlike them it's
     * called from `embedElementNavigation.ts`'s Enter handler, which is
     * dispatched from `keyboardCommands.ts`'s plain-Enter branch, BELOW the
     * read-only gate there (unlike Tab, which sits above it — see that
     * branch's own comment for why Tab is the exception). So in the current
     * wiring `canEditScene` is already enforced before this ever runs. Both
     * invariants the other two entry points enforce right before touching
     * `beginElementEdit` are repeated here anyway, not assumed:
     * - `canEditScene(...)` — checked FIRST, before touching anything else:
     *   defense-in-depth, not load-bearing today (this callback is
     *   reachable only through `handleEmbedElementEnter()`, which is
     *   already behind the read-only gate in `keyboardCommands.ts`), but it
     *   must run before `commitElementEdit()` below, not after — the commit
     *   is the one write this guard exists to prevent, so gating AFTER it
     *   would let a rejected request still flush a still-open edit into the
     *   embed's `htmlContent`. It stays here so this function is safe on
     *   its own terms if a future refactor calls it from somewhere that
     *   isn't already gated — e.g. if Enter's dispatch in
     *   `keyboardCommands.ts` ever moved above the gate the way Tab's did,
     *   this would otherwise start writing to embed content in view/
     *   shared-view mode with no guard of its own.
     * - `if (edit) commitElementEdit();` — without it, a second
     *   `beginElementEdit` on top of a still-open one would attach a
     *   second set of `keydown`/`blur`/`paste` listeners to a (possibly
     *   different) element while the first edit's listeners/contenteditable
     *   state never get torn down, leaking listeners and leaving an
     *   element permanently editable. */
    const requestElementEdit = (path: string): boolean => {
      if (!canEditScene(useEditorModeStore.getState().mode)) return false;
      if (edit) commitElementEdit();

      const root = shadowRoot();
      if (!root) return false;
      const el = resolveElementPath(root, path);
      if (!el || !(el instanceof HTMLElement) || !isTextLeaf(el)) return false;
      beginElementEdit(el, path);
      return true;
    };

    const revertDrag = (d: ElementDragState) => {
      // Restore the live element's original `style` attribute — undoes the
      // visual-only transform/opacity `handleDragMove` applied below. This
      // is a REVERT, never a commit: the sortable reorder itself is only
      // ever written via `applyEmbedElementReorder` in `handleDragEnd`.
      if (d.originalStyle === null) d.el.removeAttribute("style");
      else d.el.setAttribute("style", d.originalStyle);
      useEmbedPickerStore.getState().setDropIndicator(null);
      useEmbedPickerStore.getState().bumpDragVersion();
    };

    const endDrag = () => {
      drag = null;
      useEmbedPickerStore.getState().setCancelElementDrag(null);
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      window.removeEventListener("pointercancel", handleDragCancel);
    };

    const handleDragMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      // The embed may have re-mounted its shadow DOM mid-drag (htmlContent
      // changed — see the staleness check in `handleDragEnd`), detaching
      // `drag.el`. Moving a detached element is a no-op visually; skip the
      // work rather than mutate a dead node every frame.
      if (!drag.el.isConnected) return;
      const dxScreen = e.clientX - drag.startClientX;
      const dyScreen = e.clientY - drag.startClientY;

      if (!drag.dragging) {
        if (Math.hypot(dxScreen, dyScreen) <= DRAG_THRESHOLD_PX) return;
        drag.dragging = true;
        // Capture the candidate siblings and `el`'s own rect NOW, before any
        // visual transform is ever applied to `drag.el` — see the field doc
        // comments on `ElementDragState.candidates`/`elRect`. Slots
        // themselves are rebuilt from these every move, below.
        drag.candidates = collectSortCandidates(drag.el);
        drag.elRect = drag.el.getBoundingClientRect();
        // Capture the element's own authored transform (if any) before it's
        // overwritten by the ghost drag below — see
        // `ElementDragState.baseTransform`.
        const computedTransform = getComputedStyle(drag.el).transform;
        drag.baseTransform = computedTransform === "none" ? "" : computedTransform;
        // The dragged element itself gets `pointer-events: none` below, so
        // from this point on `handleMove`'s `composedPath()[0]` resolves to
        // whatever sibling is under the cursor — stop steering the hover
        // highlight from that (see `handleMove`'s own gate) and clear
        // whatever it was last set to, so the insertion-line indicator isn't
        // joined by a hover box chasing the cursor across siblings.
        useEmbedPickerStore.getState().setHoveredPath(null);
        // Only a drag that actually moved is cancellable — below the
        // threshold the gesture is still just a click, and Escape must keep
        // its normal meaning (exit the picker).
        useEmbedPickerStore.getState().setCancelElementDrag(cancelElementDrag);

        // Make sure the dragged element ends up selected, matching what a
        // native-node drag does — but only if it isn't already the
        // selection (avoids clobbering `outerHtml`/snapshot state for no
        // reason on every drag).
        const current = useEmbedPickerStore.getState().selection;
        if (!current || current.embedId !== nodeId || current.path !== drag.path) {
          const root = shadowRoot();
          if (root) {
            const selection = describeEmbedElement(drag.el, root, nodeId);
            if (selection.path) {
              const currentHtml = useSceneStore.getState().nodesById[nodeId] as
                | EmbedNode
                | undefined;
              useEmbedPickerStore
                .getState()
                .selectElement(selection, currentHtml?.htmlContent ?? "");
            }
          }
        }
      }

      // The embed's content is scaled by the viewport zoom
      // (`syncContentScale`), so a screen-px cursor delta must be divided by
      // the current zoom to get a delta in the content's own CSS px —
      // otherwise the element would visibly outrun (or lag) the cursor at
      // any zoom other than 100%.
      // Known, deliberately unfixed cosmetic gap: `startClientX/Y` (the
      // ghost's zero point) was captured at pointerdown under whatever zoom
      // was active then. If the zoom changes mid-drag (the wheel forwarding
      // above keeps that live on purpose), this delta — and therefore the
      // ghost's on-screen offset from the cursor — no longer matches the
      // CURRENT zoom, so the ghost drifts away from the pointer. Nothing
      // about the COMMIT is affected: the drop slot below is still picked
      // from the live cursor position against live sibling rects, so the
      // wrong thing never gets reordered — only the translucent ghost looks
      // slightly offset while dragging through a zoom change.
      const zoom = useViewportStore.getState().scale || 1;
      const dx = dxScreen / zoom;
      const dy = dyScreen / zoom;

      // Visual-only: the element follows the cursor via a temporary
      // transform, never committed (see `revertDrag`) — the actual reorder
      // is a DOM move among siblings, decided by the nearest drop slot, not
      // a coordinate offset. Composed with `baseTransform` (translate
      // OUTSIDE it) rather than overwriting `transform` outright — see the
      // field's doc comment on `ElementDragState.baseTransform`.
      const translate = `translate(${dx}px, ${dy}px)`;
      drag.el.style.setProperty(
        "transform",
        drag.baseTransform ? `${translate} ${drag.baseTransform}` : translate,
      );
      drag.el.style.setProperty("opacity", "0.75");
      drag.el.style.setProperty("pointer-events", "none");

      // Slots are rebuilt from the frozen `candidates`/`elRect` on EVERY
      // move, not cached — see `ElementDragState.candidates`'s doc comment
      // for why (zoom/pan stay live while picking, so a stale slot list
      // would draw the indicator, and commit, against the wrong siblings).
      const slots = drag.candidates && drag.elRect ? buildDropSlots(drag.candidates, drag.elRect) : [];
      const slot = pickDropSlot(slots, e.clientX, e.clientY);
      drag.currentSlot = slot;
      useEmbedPickerStore.getState().setDropIndicator(slot?.indicator ?? null);
      useEmbedPickerStore.getState().bumpDragVersion();
    };

    const handleDragEnd = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag;
      endDrag();
      if (!d.dragging) return; // never crossed the threshold: a plain click

      suppressNextClick = true;

      // Always revert the live element's visual-only transform FIRST —
      // whatever happens below (permission gate, staleness, no-op slot,
      // unresolvable path), the temporary transform/opacity must never be
      // what's left on screen or what a subsequent read of `style` sees.
      revertDrag(d);

      // Permission gate, mirroring EmbedElementProperties.applyEdit's
      // `if (readOnly) return;` and EmbedElementHighlight's `canEditScene`
      // gate — a picker drag must not be able to write to the scene in a
      // non-editable mode.
      if (!canEditScene(useEditorModeStore.getState().mode)) return;

      // Commit as ONE undo step: read the current htmlContent, apply the
      // reorder to it, and write it back — never the live element's
      // per-frame transform mutated above.
      const currentHtml = useSceneStore.getState().nodesById[nodeId] as EmbedNode | undefined;
      const html = currentHtml?.htmlContent ?? "";

      // The embed's htmlContent (and therefore its shadow DOM) may have
      // changed mid-drag — a streamed `edit_embed_html`/`batch_design`
      // mutation (applied progressively, not just on completion) or an
      // undo. `d.el` can then be a detached node, and even when it's still
      // connected, `d.path`'s `nth-of-type` positions may now resolve to a
      // DIFFERENT element in the new html. Bail without writing rather than
      // silently reordering whatever now occupies that path.
      if (!d.el.isConnected || html !== d.htmlAtPointerDown) return;

      const slot = d.currentSlot;
      if (!slot || isNoOpSlot(d.el, slot)) return; // nothing to commit

      // `slot.before` is a live shadow-DOM element; translate it to the
      // shadow-relative path `applyEmbedElementReorder` expects (mirroring
      // `d.path`, built the same way at pointerdown).
      const beforeShadowPath = slot.before ? buildElementPath(slot.before, shadowRoot()!) : null;
      if (slot.before && !beforeShadowPath) return; // no anchor to resolve back to

      const result = applyEmbedElementReorder(html, d.path, beforeShadowPath);
      if (!result) return;
      // ORDER MATTERS — see EmbedElementProperties.tsx's `applyEdit`:
      // `noteSelectionEdit` must land before `updateNode` writes the new
      // `htmlContent`, or `useEmbedPickerLifecycle`'s synchronous staleness
      // check clears the selection it was meant to keep alive.
      useEmbedPickerStore
        .getState()
        .noteSelectionEdit(result.html, result.outerHtml, result.newPath);
      useSceneStore.getState().updateNode(nodeId, { htmlContent: result.html });
    };

    const handleDragCancel = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag;
      endDrag();
      if (d.dragging) revertDrag(d);
    };

    /** Abort the in-flight drag, reverting the live element and writing
     * nothing to the scene. Registered in `embedPickerStore` the moment a
     * drag crosses the threshold, and invoked by the global Escape handler
     * (`keyboardCommands.ts`) — the same contract `useDragStore.cancelDrag`
     * has for a native-node drag.
     *
     * This is deliberately NOT a capture-phase `keydown` listener of our
     * own: capture listeners on the same target (`window`) fire in
     * REGISTRATION order, and the global canvas handler is registered at app
     * mount, long before picking starts. It therefore always ran first and
     * had already called `exitContainer()` -> `stopPicking()` — so Escape
     * cancelled the drag AND threw the user out of the picker. Caught live
     * by `e2e/embed-element-sortable.spec.ts`. */
    const cancelElementDrag = () => {
      if (!drag) return;
      const d = drag;
      endDrag();
      if (d.dragging) {
        revertDrag(d);
        // The gesture is still physically in progress (the button is down);
        // the browser will still fire a `click` on release, which must not
        // re-run selection.
        suppressNextClick = true;
      }
    };

    /** Re-dispatches a real DOM `PointerEvent` at the Pixi canvas, copying
     * every field `pixiInteractionCore`'s own handlers read: `clientX/Y`
     * (all its hit-testing and drag-delta math is `getBoundingClientRect`-
     * relative, nothing else), `pointerId`/`pointerType`/`isPrimary` (so its
     * pointerId-keyed drag state lines up across this call and the next),
     * `button`/`buttons`, and every modifier key (smart-guide modifiers,
     * shift/meta multi-select on the initial hit). `overrideClientX/Y` is
     * used exactly once per gesture, for the synthetic `pointerdown` — see
     * `handleNodeDragMove`'s doc comment for why that one must carry the
     * ORIGINAL pointerdown position rather than wherever the pointer has
     * drifted to by the time the threshold is crossed.
     *
     * `bubbles: false` is load-bearing, not cosmetic: `pixiInteractionCore`
     * registers its own pointerdown/move/up listeners directly on the
     * canvas (target phase), so they fire regardless of the bubbles flag —
     * but this effect ALSO has its own `pointermove`/`pointerup`/
     * `pointercancel` listeners on `window` for the sortable drag, and the
     * module-level node-drag forward has its own on `window` too. A
     * `bubbles: true` event dispatched at the canvas bubbles up through its
     * ancestors all the way to `window`, landing right back on one of those
     * handlers for the SAME pointerId — which would forward it again, which
     * would bubble to `window` again, forever. This was caught immediately
     * by a stack overflow in `EmbedLayer.nodeDragForward.test.tsx`.
     *
     * The gesture itself now lives at module scope (`beginNodeDragForward`
     * and friends, above `EmbedHost`) rather than in this effect's own
     * closure — see `NodeDragForwardState`'s doc comment for why: the
     * forwarded `pointerdown` can make Pixi select a different node and
     * tear down this very effect mid-gesture, and the gesture must survive
     * that. `beginNodeDrag` here is just the thin per-embed entry point
     * that resolves the canvas and hands off. */
    const beginNodeDrag = (e: PointerEvent) => {
      const canvas = findPixiCanvas();
      if (!canvas) return; // nothing to forward to — same fallback `forwardWheel` uses below
      beginNodeDragForward(e, canvas);
    };

    const handlePointerDown = (e: PointerEvent) => {
      // A pointerdown that lands inside the element currently being
      // inline-edited must reach it untouched — this is how the browser
      // places a caret or starts a native text selection. Every other gate
      // below (preventDefault, drag-start, click-select) is for the
      // embed's OWN content, which must stay inert while picking; a
      // contenteditable element we just created is not that.
      if (edit && eventTargetsEditingElement(e)) return;

      // A pointerdown anywhere else while an edit is in flight commits it
      // first, so the gesture that follows (selecting a different element,
      // starting a drag) acts on ordinary picker state rather than a
      // half-finished text edit.
      if (edit) commitElementEdit();

      // Self-healing: a previous drag may never have gotten a matching
      // pointerup/pointercancel (e.g. the button was released over browser
      // chrome outside the window) — always end and, if it had crossed the
      // drag threshold, revert it BEFORE any of the early returns below, so
      // a stale drag never keeps steering the live element while a fresh
      // gesture starts.
      suppressNextClick = false;
      if (drag) {
        const stale = drag;
        endDrag();
        if (stale.dragging) revertDrag(stale);
      }
      // Same self-healing for a node-drag forward that never got a matching
      // pointerup/pointercancel — delegated to the module-level function
      // since the forward's own state lives there now (see
      // `NodeDragForwardState`'s doc comment), not in this closure.
      healStaleNodeDragForward();

      // Keep the embed fully inert — same rationale as `swallow` below —
      // regardless of which button/pointer triggered this.
      e.preventDefault();
      e.stopPropagation();

      // Only the primary mouse button (or the primary touch/pen contact)
      // may start a drag. A right/middle-click drag has no visible warning
      // — `contextmenu` is swallowed too — besides the element silently
      // ending up moved.
      if (e.button !== 0 || !e.isPrimary) return;

      const root = shadowRoot();
      if (!root) return;
      const target = e.composedPath()[0] ?? null;
      const el = resolvePickableElement(target, root);
      // Only an HTMLElement can be reordered this way: sortability is
      // decided by CSS `position`/layout among *element* siblings, neither
      // of which means anything for the internals of an inline `<svg>` (an
      // SVGElement) — a deliberate limitation, not a bug. A non-HTMLElement
      // target falls through to the node-move drag below like every other
      // "not the current picker selection" case.
      const path = el instanceof HTMLElement ? buildElementPath(el, root) : null;

      // Sortable reorder (see `handleDragMove` and friends above) now only
      // re-enters when the pointer lands on the element that is ALREADY the
      // picker's current selection. Before this, ANY sortable element under
      // the pointer started a reorder drag — which meant there was no
      // gesture left that ever reached Pixi at all, since the picker
      // auto-activates for the sole selected embed and most of an embed's
      // content is some sortable element. A drag anywhere else in the embed
      // (an element that isn't selected yet, an out-of-flow one, an SVG,
      // empty space) now moves the embed NODE itself instead — see
      // `beginNodeDrag`.
      const currentSelection = useEmbedPickerStore.getState().selection;
      const isCurrentSelection =
        !!path && !!currentSelection && currentSelection.embedId === nodeId && currentSelection.path === path;

      if (
        isCurrentSelection &&
        el instanceof HTMLElement &&
        path &&
        // Out-of-flow elements (position: absolute/fixed) and elements with
        // no other in-flow sibling to reorder against don't start a
        // sortable drag at all — see `isSortable`'s doc comment for why —
        // and fall through to the node-move drag below instead.
        isSortable(el, getComputedStyle(el))
      ) {
        const currentHtml = useSceneStore.getState().nodesById[nodeId] as EmbedNode | undefined;
        drag = {
          el,
          path,
          candidates: null,
          elRect: null,
          currentSlot: null,
          startClientX: e.clientX,
          startClientY: e.clientY,
          dragging: false,
          originalStyle: el.getAttribute("style"),
          baseTransform: "",
          pointerId: e.pointerId,
          htmlAtPointerDown: currentHtml?.htmlContent ?? "",
        };
        // Window-level, not host-level: the pointer routinely leaves the
        // (possibly small) host bounds mid-drag, and a host-scoped listener
        // would stop firing the moment that happens.
        window.addEventListener("pointermove", handleDragMove);
        window.addEventListener("pointerup", handleDragEnd);
        window.addEventListener("pointercancel", handleDragCancel);
        return;
      }

      beginNodeDrag(e);
    };

    const handleMove = (e: PointerEvent) => {
      // While a sortable drag is in flight the dragged element itself has
      // `pointer-events: none` (see `handleDragMove`), so `composedPath()[0]`
      // resolves to whichever SIBLING the cursor happens to be over instead —
      // without this gate, `setHoveredPath` would fire on every sibling the
      // cursor crosses, drawing a hover box that chases the cursor on top of
      // the insertion-line indicator. `hoveredPath` is reset to null once, at
      // the moment the drag crosses the threshold (see `handleDragMove`), so
      // there's nothing stale left over once the drag ends either. A
      // node-move forward is gated the same way: once it's `started`, the
      // embed itself is being repositioned by `dragController`, and the
      // pointer keeps generating ordinary `pointermove`s on this same host
      // as it moves — without this, a hover box would chase the cursor over
      // whatever content now happens to sit under it mid-drag.
      if (drag?.dragging || nodeDragForward?.started) return;
      const target = e.composedPath()[0] ?? null;
      if (target === lastMoveTarget) return;
      lastMoveTarget = target;
      const root = shadowRoot();
      if (!root) return;
      const el = resolvePickableElement(target, root);
      // The element mid inline-edit already has a caret/selection of its
      // own — a hover box chasing the cursor on top of that would be pure
      // visual noise, and the highlight would need `hoveredPath` fighting
      // for the same real estate contenteditable is using.
      if (edit && el === edit.el) {
        useEmbedPickerStore.getState().setHoveredPath(null);
        return;
      }
      // An empty path (e.g. `el` resolving to `root` itself, or to the
      // synthetic content container `mountHtmlWithBodyStyles` mounts
      // directly into `root`) isn't a meaningful hover target — there's no
      // anchor to resolve back to a specific element later. Treat it as "not
      // hovering anything" rather than drawing an empty-path hover box.
      const path = el ? buildElementPath(el, root) : "";
      useEmbedPickerStore.getState().setHoveredPath(path || null);
    };

    const handleLeave = () => {
      lastMoveTarget = null;
      useEmbedPickerStore.getState().setHoveredPath(null);
    };

    const handleClick = (e: MouseEvent) => {
      // Capture-phase, so this runs before any click handler inside the
      // embed's own HTML (links, buttons) and before the event can reach the
      // Pixi canvas underneath.
      e.preventDefault();
      e.stopPropagation();
      // Both flags are read (and the module-level one cleared) UNCONDITIONALLY,
      // before either early-return below gets a chance to decide the outcome —
      // an un-cleared module flag would wrongly suppress some unrelated LATER
      // click, possibly on a different embed entirely. This must run ahead of
      // the `eventTargetsEditingElement` check right after it: that check used
      // to sit first, so a click landing inside an actively-edited element
      // left `suppressForward` stuck pending for whichever click read it next.
      const suppressLocal = suppressNextClick;
      const suppressForward = takeSuppressNextEmbedClickAfterNodeDrag();
      suppressNextClick = false;
      if (edit && eventTargetsEditingElement(e)) {
        // The click that follows a pointerdown+mouseup inside the element
        // being edited is just how the caret got placed — not a new pick.
        return;
      }
      if (suppressLocal || suppressForward) {
        // The click the browser fires right after a pointerup that ended a
        // drag (mouseup landed on the same element it went down on) — the
        // drag already selected and committed this element, so re-running
        // selection here would be redundant at best and, since the element
        // just re-mounted with the new inline style, could resolve a
        // different node than the one actually dragged. `suppressForward` is
        // the module-level equivalent for a node-drag forward (see its own
        // doc comment): that gesture can outlive THIS effect, so its
        // "suppress the next click" flag can't live in this closure either.
        return;
      }
      const root = shadowRoot();
      if (!root) return;
      const target = e.composedPath()[0] ?? null;
      const el = resolvePickableElement(target, root);
      if (!el) return;
      const selection = describeEmbedElement(el, root, nodeId);
      // Reject an empty-path selection outright: with no anchor to resolve
      // back to a specific element, drawing a highlight for it is
      // impossible, and shipping it to the agent as "the element the user
      // pointed at" would be actively misleading — it would carry the
      // whole embed's outerHtml with no path to locate it by, and no
      // highlight is ever drawn to tell the user anything was picked at all.
      if (!selection.path) return;
      // Read htmlContent fresh from the store rather than closing over the
      // `node` prop — this effect's deps don't include htmlContent, so a
      // closed-over `node` could be stale by the time of a click, which
      // would snapshot the wrong "at pick time" html for staleness checks.
      const currentHtml = useSceneStore.getState().nodesById[nodeId] as EmbedNode | undefined;
      useEmbedPickerStore.getState().selectElement(selection, currentHtml?.htmlContent ?? "");
    };

    // While picking, the embed's own content must be fully inert: swallow
    // every event that could trigger the embed's own behaviour (a
    // prototype's mousedown handler, a native contextmenu) before it
    // reaches the embed's DOM. `click` is handled above instead of
    // swallowed here — it's the picker's own selection signal. `dblclick`
    // has its own handler below instead of being swallowed — it's now the
    // entry point for single-element text editing.
    const swallow = (e: Event) => {
      // A mousedown/contextmenu landing inside the element being
      // inline-edited needs to reach it — same rationale as
      // `handlePointerDown`'s own gate.
      if (edit && eventTargetsEditingElement(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    /** Double-click entry point for single-element text editing. Only a
     * text-leaf HTMLElement (see `isTextLeaf`) is eligible — anything else
     * (an SVG, an image, a container with its own child elements) is just
     * glued shut, matching the old blanket `swallow` this replaces. */
    const handleDblClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (edit && eventTargetsEditingElement(e)) {
        // A dblclick on the element already being edited is the browser's
        // own word-selection gesture — let it happen, don't re-run entry.
        return;
      }
      // A dblclick anywhere else while an edit is in flight commits that
      // edit first, mirroring `handlePointerDown`. Remembered so the entry
      // below knows whether it needs to defer (see the comment further
      // down) — `edit` itself is already null again by the time we get
      // there.
      const hadPriorEdit = edit !== null;
      if (edit) commitElementEdit();

      if (!canEditScene(useEditorModeStore.getState().mode)) return;

      const root = shadowRoot();
      if (!root) return;
      const target = e.composedPath()[0] ?? null;
      const el = resolvePickableElement(target, root);
      if (!el || !(el instanceof HTMLElement) || !isTextLeaf(el)) return;
      const path = buildElementPath(el, root);
      if (!path) return; // no anchor to resolve back to later

      if (!hadPriorEdit) {
        beginElementEdit(el, path);
        return;
      }

      // The commit just above wrote a new `htmlContent` (assuming the text
      // actually changed), which makes `EmbedHost`'s OTHER effect — the one
      // keyed on `htmlContent`, above — tear down and rebuild this embed's
      // entire shadow-DOM content on its next passive-effect pass, which
      // runs AFTER this synchronous handler returns. `el` was resolved
      // against the DOM as it exists right now, before that rebuild:
      // entering edit mode on it immediately would have the rebuild
      // destroy the very element we just made `contenteditable` a moment
      // later — no caret, and the next commit fails its `isConnected`
      // guard (this is the code-review finding this fixes). Deferring one
      // frame lets the rebuild happen first; re-resolving BY PATH against a
      // FRESH shadow root afterwards (never reusing `el`, which may already
      // be a detached node by then) is what makes this correct rather than
      // just "usually works" — the rebuilt DOM has the identical structure
      // (a text commit changes text, not element order), so the same
      // positional path still names the same element.
      pendingEditFrame = requestAnimationFrame(() => {
        pendingEditFrame = null;
        if (disposed) return; // this effect tore down before the frame fired
        const freshRoot = shadowRoot();
        if (!freshRoot) return;
        const freshEl = resolveElementPath(freshRoot, path);
        if (!freshEl || !(freshEl instanceof HTMLElement) || !isTextLeaf(freshEl)) return;
        beginElementEdit(freshEl, path);
      });
    };

    // Pixi's wheel listener is bound to the canvas element, which is a
    // *sibling* of this host, not an ancestor — so a wheel event landing on
    // the host (pointerEvents: "auto" while picking) never reaches it via
    // bubbling. Re-dispatch a matching WheelEvent at the canvas so zoom/pan
    // keeps working while picking a small element is exactly when you need
    // to zoom in first. Preserve every field panController reads.
    const forwardWheel = (e: WheelEvent) => {
      e.preventDefault();
      const canvas = findPixiCanvas();
      if (!canvas) return;
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    // Multitouch (pan/zoom) forwarding. `pixiInteractionCore.handlePointerDown`
    // ignores `pointerType === "touch"` outright — touch has always been
    // read-only navigation, handled entirely by `touchController`'s own
    // touchstart/move/end/cancel listeners on the canvas, never by the
    // pointer-event path — and this host was never forwarding touch events
    // at all, so a two-finger pan/zoom gesture starting over a SELECTED
    // embed (host is `pointerEvents: "auto"` whenever `isActive || isPicking`)
    // silently did nothing. A single touch must stay untouched: it's the
    // picker's own tap-to-select gesture, and `touchController` never
    // reacts to one touch anyway. Only ever forwarded to the canvas, never
    // processed locally — this host has no pan/zoom of its own to do.
    const forwardTouch = (
      type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
      e: TouchEvent,
      canvas: HTMLCanvasElement,
    ) => {
      canvas.dispatchEvent(
        new TouchEvent(type, {
          // The ORIGINAL Touch objects, not synthesized ones —
          // `touchController` only ever reads `clientX/Y` off individual
          // touches, and passing the live touches through verbatim is both
          // simplest and exactly right: they already describe every finger
          // in this exact native event. `TouchEventInit` wants a `Touch[]`,
          // not the array-like `TouchList` the native event carries, hence
          // the `Array.from`.
          touches: Array.from(e.touches),
          targetTouches: Array.from(e.targetTouches),
          changedTouches: Array.from(e.changedTouches),
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          // No bubbling need here (unlike the pointer forwards above) —
          // this effect has no window-level touch listeners of its own for
          // it to loop back into — but `false` costs nothing and keeps the
          // same defensive posture.
          bubbles: false,
          cancelable: true,
        }),
      );
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) multitouchForwardActive = true;
      if (!multitouchForwardActive) return; // single touch: the picker's own tap-to-select
      e.preventDefault();
      const canvas = findPixiCanvas();
      if (canvas) forwardTouch("touchstart", e, canvas);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!multitouchForwardActive) return;
      e.preventDefault();
      const canvas = findPixiCanvas();
      if (canvas) forwardTouch("touchmove", e, canvas);
    };

    /** Shared by touchend/touchcancel: once a gesture started as multitouch,
     * see it through to the end of the whole series — including the tail
     * where the finger count has already dropped back below 2 — rather than
     * dropping out early and leaving the canvas mid-pinch with no closing
     * touchend/touchcancel of its own. Reset only once every finger is up. */
    const handleTouchEndOrCancel = (
      type: "touchend" | "touchcancel",
      e: TouchEvent,
    ) => {
      if (!multitouchForwardActive) return;
      const canvas = findPixiCanvas();
      if (canvas) forwardTouch(type, e, canvas);
      if (e.touches.length === 0) multitouchForwardActive = false;
    };
    const handleTouchEnd = (e: TouchEvent) => handleTouchEndOrCancel("touchend", e);
    const handleTouchCancel = (e: TouchEvent) => handleTouchEndOrCancel("touchcancel", e);

    host.addEventListener("pointermove", handleMove);
    host.addEventListener("pointerleave", handleLeave);
    host.addEventListener("click", handleClick, true);
    // pointerdown gets its own handler (drag-start candidate) instead of the
    // generic `swallow` below, but still preventDefault/stopPropagation's the
    // event itself — see handlePointerDown.
    host.addEventListener("pointerdown", handlePointerDown, true);
    host.addEventListener("mousedown", swallow, true);
    host.addEventListener("dblclick", handleDblClick, true);
    host.addEventListener("contextmenu", swallow, true);
    host.addEventListener("wheel", forwardWheel, { capture: true, passive: false });
    host.addEventListener("touchstart", handleTouchStart, { capture: true, passive: false });
    host.addEventListener("touchmove", handleTouchMove, { capture: true, passive: false });
    host.addEventListener("touchend", handleTouchEnd, { capture: true, passive: false });
    host.addEventListener("touchcancel", handleTouchCancel, { capture: true, passive: false });

    // Registered for the duration of this picking session so the global
    // keyboard handler can start an inline text edit on the currently
    // selected element — see `requestElementEdit`'s own doc comment (and
    // `embedPickerStore`'s field doc) for why this can't instead be reached
    // via listener order.
    useEmbedPickerStore.getState().setRequestElementEdit(requestElementEdit);

    return () => {
      disposed = true;
      if (pendingEditFrame !== null) {
        cancelAnimationFrame(pendingEditFrame);
        pendingEditFrame = null;
      }
      host.removeEventListener("pointermove", handleMove);
      host.removeEventListener("pointerleave", handleLeave);
      host.removeEventListener("click", handleClick, true);
      host.removeEventListener("pointerdown", handlePointerDown, true);
      host.removeEventListener("mousedown", swallow, true);
      host.removeEventListener("dblclick", handleDblClick, true);
      host.removeEventListener("contextmenu", swallow, true);
      host.removeEventListener("wheel", forwardWheel, true);
      host.removeEventListener("touchstart", handleTouchStart, true);
      host.removeEventListener("touchmove", handleTouchMove, true);
      host.removeEventListener("touchend", handleTouchEnd, true);
      host.removeEventListener("touchcancel", handleTouchCancel, true);
      // Mirrors `setCancelElementDrag(null)`/`setCancelElementEdit(null)`
      // elsewhere in this effect: `requestElementEdit` closes over this
      // effect's `shadowRoot`/`beginElementEdit`, both dead once this
      // teardown runs, so the store must not keep calling it after this
      // picking session ends (isPicking flipping off, the embed switching,
      // or a full unmount).
      useEmbedPickerStore.getState().setRequestElementEdit(null);
      // In case the effect tears down mid-edit (isPicking flips off, or
      // isActive flips on) while an element is still being typed into —
      // commit whatever was typed rather than silently discarding it,
      // matching every other exit path from edit mode (Enter/blur/
      // pointerdown-elsewhere all commit too; only Escape reverts).
      // `commitElementEdit`'s own `e.el.isConnected` guard is what makes
      // this safe to call unconditionally here even on a full component
      // unmount (embed deleted, host navigated away): React already
      // detaches the DOM before running any passive-effect cleanup, so by
      // the time this line runs in that case `el` is disconnected and the
      // guard abandons the write instead of committing text against an
      // element (and possibly a stale `htmlContent`) that's already gone.
      if (edit) commitElementEdit();
      // In case the effect tears down mid-drag (e.g. isPicking flips off
      // while dragging) — leave neither a stray live-style mutation nor
      // dangling window listeners behind.
      if (drag) {
        const d = drag;
        endDrag();
        if (d.dragging) revertDrag(d);
      }
      // Deliberately NO teardown of an in-flight node-drag forward here —
      // unlike the sortable drag right above, that gesture lives at module
      // scope precisely so THIS effect tearing down (which can itself be a
      // direct consequence of the forwarded pointerdown moving selection
      // away from this embed — see `NodeDragForwardState`'s doc comment)
      // never kills it. It keeps receiving real pointermove/pointerup on
      // `window` regardless, and cleans up its own listeners when that
      // arrives (`endNodeDragForward`) or via the next gesture's
      // self-heal (`healStaleNodeDragForward`) if it never does.
    };
  }, [isPicking, isActive, nodeId]);

  if (!node) return null;

  return (
    <div
      ref={hostRef}
      data-embed-id={nodeId}
      style={{
        position: "absolute",
        overflow: "hidden",
        pointerEvents: isActive || isPicking ? "auto" : "none",
        // Forcing "default" is what turns off the crosshair while merely
        // hovering in pick mode, but a forced (non-"auto") cursor value
        // inherits into shadow content — during `isEditingElement` that
        // would paint an arrow over the contenteditable text instead of
        // letting the browser show its native I-beam caret. So we simply
        // don't force anything while editing; the shadow content picks its
        // own cursor as normal.
        cursor: isPicking && !isActive && !isEditingElement ? "default" : undefined,
      }}
    />
  );
}

/**
 * DOM overlay that renders every embed node as live browser DOM above the Pixi
 * canvas. Always on top; transparent to pointer events except for the active
 * (double-click-entered) embed.
 */
export function EmbedLayer() {
  const nodesById = useSceneStore((s) => s.nodesById);
  const parentById = useSceneStore((s) => s.parentById);
  const mode = useEditorModeStore((s) => s.mode);
  const activeSlideId = useEditorModeStore(
    (s) => s.presentFrameIds[s.presentIndex],
  );
  // Outline mode renders every embed as a plain bbox stroke in Pixi
  // (embedRenderer.ts) instead — the live HTML content has no wireframe
  // form of its own, so it's hidden entirely rather than shown on top of a
  // wireframe scene.
  const isOutline = useRenderModeStore((s) => s.renderMode === "outline");
  const embedIds = useMemo(() => {
    if (isOutline) return [];

    return Object.keys(nodesById).filter((id) => {
      const node = nodesById[id];
      if (node?.type !== "embed") return false;

      // Render only embeds that are actually drawn on the canvas: hidden or
      // disabled on themselves, OR on any ancestor, takes the whole subtree
      // off screen (Pixi containment — a hidden/disabled frame hides its
      // children too, not just itself). This embed is DOM content mounted
      // outside Pixi's own render tree, so nothing else enforces that
      // containment for it: without this ancestor walk, an embed nested
      // inside a frame the user just hid would keep rendering as a live
      // Shadow-DOM overlay on top of the (now empty) canvas underneath it.
      // The walk only runs per embed (post the type filter above), not per
      // node, so it stays cheap even in large documents — bounded by
      // (embed count × tree depth), not document size.
      if (findHiddenSelfOrAncestor(nodesById, parentById, id)) return false;

      if (mode !== "present") return true;
      return topLevelAncestorId(parentById, id) === activeSlideId;
    });
  }, [nodesById, parentById, isOutline, mode, activeSlideId]);

  return (
    <div
      data-embed-layer
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {embedIds.map((id) => (
        <EmbedHost key={id} nodeId={id} />
      ))}
    </div>
  );
}
