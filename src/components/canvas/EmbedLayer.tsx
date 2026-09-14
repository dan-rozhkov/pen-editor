import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useRenderModeStore } from "@/store/renderModeStore";
import { useEditorModeStore, canEditScene } from "@/store/editorModeStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useViewportStore } from "@/store/viewportStore";
import {
  applyEmbedInheritedDefaults,
  mountHtmlWithBodyStyles,
} from "@/utils/embedHtmlUtils";
import { buildVariableStyleBlock } from "@/utils/variableCssUtils";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import { findHiddenSelfOrAncestor } from "@/utils/nodeUtils";
import type { EmbedNode } from "@/types/scene";
import { topLevelAncestorId } from "@/utils/topLevelAncestor";
import { useOverlayHostRect } from "./useOverlayHostRect";
import {
  buildElementPath,
  describeEmbedElement,
  resolvePickableElement,
} from "@/lib/embedElementPicker";
import { applyEmbedElementEdit } from "@/lib/embedElementStyle";
import { captureDragBase, computeDragStyles, type DragBase } from "@/lib/embedElementDrag";

/** Screen-px movement past which a pointerdown-then-move becomes a drag
 * rather than a click. */
const DRAG_THRESHOLD_PX = 3;

interface ElementDragState {
  el: HTMLElement;
  /** Shadow-relative path to `el`, as produced by `buildElementPath`. */
  path: string;
  base: DragBase;
  startClientX: number;
  startClientY: number;
  /** Only true once the pointer has moved past `DRAG_THRESHOLD_PX` — before
   * that, this is still a candidate click. */
  dragging: boolean;
  /** `el`'s original `style` attribute (or null if it had none), restored on
   * cancel/Escape. */
  originalStyle: string | null;
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

/** One Shadow-DOM host for a single embed node, synced to the viewport. */
function EmbedHost({ nodeId }: { nodeId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const node = useSceneStore((s) => s.nodesById[nodeId]) as EmbedNode | undefined;
  const isActive = useSelectionStore((s) => s.activeEmbedId === nodeId);
  const isPicking = useEmbedPickerStore((s) => s.pickingEmbedId === nodeId);

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
    const themeBlock = buildVariableStyleBlock(undefined, getEffectiveThemeForNode(nodeId));
    const html = themeBlock ? htmlContent + themeBlock : htmlContent;
    // mountHtmlWithBodyStyles hoists allowlisted external font stylesheets
    // (Google Fonts / Phosphor icon fonts) to document level — Chrome only
    // registers `@font-face` fonts from document-level styles, never from a
    // shadow tree, so without this icon/text web fonts render as tofu.
    mountHtmlWithBodyStyles(content, html, width, height);
    shadow.appendChild(content);
    contentRef.current = content;

    // Position now that content exists (applies the current scale transform).
    position();

    return () => { contentRef.current = null; };
  }, [position, nodeId, htmlContent, width, height]);

  // Element-picking mode: hover highlights, click selects. Guarded against
  // inline-edit mode (isActive) — that mode already owns pointer events on
  // the host for real interaction with the embedded page.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !isPicking || isActive) return;

    const shadowRoot = () => host.shadowRoot ?? null;

    // Last composedPath()[0] seen by handleMove, so a run of pointermove
    // events over the *same* element (60+/s while the pointer drifts a
    // pixel at a time) skips buildElementPath (a querySelectorAll per
    // ancestor id) and the store write entirely instead of repeating both
    // on every raw event.
    let lastMoveTarget: EventTarget | null = null;

    // In-progress element drag (pointerdown -> pointermove* -> pointerup),
    // or null when idle. A plain local (not a React ref) since it's only
    // ever read/written from the imperative listeners this effect owns.
    let drag: ElementDragState | null = null;
    // Set true by pointerup right after committing (or by Escape right after
    // reverting) a drag that actually moved past the threshold, so the
    // `click` event the browser still fires afterwards (mouseup landed on
    // the same element it went down on) doesn't re-run selection logic.
    let suppressNextClick = false;

    const revertDrag = (d: ElementDragState) => {
      if (d.originalStyle === null) d.el.removeAttribute("style");
      else d.el.setAttribute("style", d.originalStyle);
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
      const zoom = useViewportStore.getState().scale || 1;
      const dx = dxScreen / zoom;
      const dy = dyScreen / zoom;

      const styles = computeDragStyles(drag.base, dx, dy);
      for (const [prop, value] of Object.entries(styles)) {
        drag.el.style.setProperty(prop, value);
      }
      useEmbedPickerStore.getState().bumpDragVersion();
    };

    const handleDragEnd = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag;
      endDrag();
      if (!d.dragging) return; // never crossed the threshold: a plain click

      suppressNextClick = true;

      // Permission gate, mirroring EmbedElementProperties.applyEdit's
      // `if (readOnly) return;` and EmbedElementHighlight's `canEditScene`
      // gate — a picker drag must not be able to write to the scene in a
      // non-editable mode. Revert the live element's visual drag either way
      // so it doesn't end up sitting displaced with nothing committed.
      if (!canEditScene(useEditorModeStore.getState().mode)) {
        revertDrag(d);
        return;
      }

      // Commit as ONE undo step: read the current htmlContent, apply the
      // final style to it, and write it back — never the per-frame styles
      // mutated onto the live element above.
      const currentHtml = useSceneStore.getState().nodesById[nodeId] as EmbedNode | undefined;
      const html = currentHtml?.htmlContent ?? "";

      // The embed's htmlContent (and therefore its shadow DOM) may have
      // changed mid-drag — a streamed `edit_embed_html`/`batch_design`
      // mutation (applied progressively, not just on completion) or an
      // undo. `d.el` can then be a detached node, and even when it's still
      // connected, `d.path`'s `nth-of-type` positions may now resolve to a
      // DIFFERENT element in the new html. Bail without writing rather than
      // silently repositioning whatever now occupies that path.
      if (!d.el.isConnected || html !== d.htmlAtPointerDown) {
        revertDrag(d);
        return;
      }

      const dxScreen = e.clientX - d.startClientX;
      const dyScreen = e.clientY - d.startClientY;
      const zoom = useViewportStore.getState().scale || 1;
      const styles = computeDragStyles(d.base, dxScreen / zoom, dyScreen / zoom);

      const result = applyEmbedElementEdit(html, d.path, { styles });
      if (!result) {
        revertDrag(d);
        return;
      }
      // ORDER MATTERS — see EmbedElementProperties.tsx's `applyEdit`:
      // `noteSelectionEdit` must land before `updateNode` writes the new
      // `htmlContent`, or `useEmbedPickerLifecycle`'s synchronous staleness
      // check clears the selection it was meant to keep alive.
      useEmbedPickerStore.getState().noteSelectionEdit(result.html, result.outerHtml);
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
     * by `e2e/embed-element-drag.spec.ts`. */
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

    const handlePointerDown = (e: PointerEvent) => {
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
      // Only an HTMLElement can be dragged this way: the gesture positions
      // via CSS `left`/`top`/margin, which don't apply to the internals of
      // an inline `<svg>` (an SVGElement) at all — a deliberate limitation,
      // not a bug.
      if (!el || !(el instanceof HTMLElement)) return;
      const path = buildElementPath(el, root);
      if (!path) return; // no anchor to resolve back to later — see handleClick

      const base = captureDragBase(el, getComputedStyle(el));
      const currentHtml = useSceneStore.getState().nodesById[nodeId] as EmbedNode | undefined;
      drag = {
        el,
        path,
        base,
        startClientX: e.clientX,
        startClientY: e.clientY,
        dragging: false,
        originalStyle: el.getAttribute("style"),
        pointerId: e.pointerId,
        htmlAtPointerDown: currentHtml?.htmlContent ?? "",
      };
      // Window-level, not host-level: the pointer routinely leaves the
      // (possibly small) host bounds mid-drag, and a host-scoped listener
      // would stop firing the moment that happens.
      window.addEventListener("pointermove", handleDragMove);
      window.addEventListener("pointerup", handleDragEnd);
      window.addEventListener("pointercancel", handleDragCancel);
    };

    const handleMove = (e: PointerEvent) => {
      const target = e.composedPath()[0] ?? null;
      if (target === lastMoveTarget) return;
      lastMoveTarget = target;
      const root = shadowRoot();
      if (!root) return;
      const el = resolvePickableElement(target, root);
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
      if (suppressNextClick) {
        // The click the browser fires right after a pointerup that ended a
        // drag (mouseup landed on the same element it went down on) — the
        // drag already selected and committed this element, so re-running
        // selection here would be redundant at best and, since the element
        // just re-mounted with the new inline style, could resolve a
        // different node than the one actually dragged.
        suppressNextClick = false;
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
    // prototype's mousedown handler, a native contextmenu, a text-selecting
    // dblclick) before it reaches the embed's DOM. `click` is handled above
    // instead of swallowed here — it's the picker's own selection signal.
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Pixi's wheel listener is bound to the canvas element, which is a
    // *sibling* of this host, not an ancestor — so a wheel event landing on
    // the host (pointerEvents: "auto" while picking) never reaches it via
    // bubbling. Re-dispatch a matching WheelEvent at the canvas so zoom/pan
    // keeps working while picking a small element is exactly when you need
    // to zoom in first. Preserve every field panController reads.
    const forwardWheel = (e: WheelEvent) => {
      e.preventDefault();
      const canvas = host
        .closest<HTMLElement>("[data-canvas]")
        ?.querySelector<HTMLCanvasElement>("canvas");
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

    host.addEventListener("pointermove", handleMove);
    host.addEventListener("pointerleave", handleLeave);
    host.addEventListener("click", handleClick, true);
    // pointerdown gets its own handler (drag-start candidate) instead of the
    // generic `swallow` below, but still preventDefault/stopPropagation's the
    // event itself — see handlePointerDown.
    host.addEventListener("pointerdown", handlePointerDown, true);
    host.addEventListener("mousedown", swallow, true);
    host.addEventListener("dblclick", swallow, true);
    host.addEventListener("contextmenu", swallow, true);
    host.addEventListener("wheel", forwardWheel, { capture: true, passive: false });

    return () => {
      host.removeEventListener("pointermove", handleMove);
      host.removeEventListener("pointerleave", handleLeave);
      host.removeEventListener("click", handleClick, true);
      host.removeEventListener("pointerdown", handlePointerDown, true);
      host.removeEventListener("mousedown", swallow, true);
      host.removeEventListener("dblclick", swallow, true);
      host.removeEventListener("contextmenu", swallow, true);
      host.removeEventListener("wheel", forwardWheel, true);
      // In case the effect tears down mid-drag (e.g. isPicking flips off
      // while dragging) — leave neither a stray live-style mutation nor
      // dangling window listeners behind.
      if (drag) {
        const d = drag;
        endDrag();
        if (d.dragging) revertDrag(d);
      }
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
        cursor: isPicking && !isActive ? "crosshair" : undefined,
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
