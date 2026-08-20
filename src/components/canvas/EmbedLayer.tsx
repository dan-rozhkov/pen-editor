import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useRenderModeStore } from "@/store/renderModeStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import {
  applyEmbedInheritedDefaults,
  mountHtmlWithBodyStyles,
} from "@/utils/embedHtmlUtils";
import { buildVariableStyleBlock } from "@/utils/variableCssUtils";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import type { EmbedNode } from "@/types/scene";
import { topLevelAncestorId } from "@/utils/topLevelAncestor";
import { useOverlayHostRect } from "./useOverlayHostRect";
import {
  buildElementPath,
  describeEmbedElement,
  resolvePickableElement,
} from "@/lib/embedElementPicker";

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
    host.addEventListener("pointerdown", swallow, true);
    host.addEventListener("mousedown", swallow, true);
    host.addEventListener("dblclick", swallow, true);
    host.addEventListener("contextmenu", swallow, true);
    host.addEventListener("wheel", forwardWheel, { capture: true, passive: false });

    return () => {
      host.removeEventListener("pointermove", handleMove);
      host.removeEventListener("pointerleave", handleLeave);
      host.removeEventListener("click", handleClick, true);
      host.removeEventListener("pointerdown", swallow, true);
      host.removeEventListener("mousedown", swallow, true);
      host.removeEventListener("dblclick", swallow, true);
      host.removeEventListener("contextmenu", swallow, true);
      host.removeEventListener("wheel", forwardWheel, true);
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
      // Render only visible, enabled embeds — mirrors the Pixi visibility
      // rule so hiding a layer also hides its DOM overlay.
      if (node?.type !== "embed" || node.visible === false || node.enabled === false) {
        return false;
      }

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
