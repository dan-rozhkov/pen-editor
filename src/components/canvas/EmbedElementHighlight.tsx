import { useEffect, useState } from "react";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useEditorModeStore, canEditScene } from "@/store/editorModeStore";
import { resolveElementPath } from "@/lib/embedElementPicker";

const HOVER_COLOR = "#0d99ff";
const SELECTION_COLOR = "#0d99ff";
const HOVER_STROKE_WIDTH = 2;
const SELECTION_STROKE_WIDTH = 1;

interface ElementBox {
  left: number;
  top: number;
  width: number;
  height: number;
  tagName: string;
}

/** Resolve the on-screen box of `path` inside embed `embedId`'s live shadow
 * DOM, relative to the canvas container. Returns null when the embed host or
 * the element itself can't currently be resolved (host not mounted, embed
 * off-screen, path stale after an HTML edit, etc.) — callers simply skip
 * rendering rather than treating this as an error. */
function resolveElementBox(embedId: string, path: string): ElementBox | null {
  const host = document.querySelector<HTMLElement>(
    `[data-embed-id="${CSS.escape(embedId)}"]`,
  );
  const root = host?.shadowRoot;
  if (!host || !root) return null;

  const el = resolveElementPath(root, path);
  if (!el) return null;

  const origin = (host.closest("[data-canvas]") as HTMLElement | null) ?? document.body;
  const elRect = el.getBoundingClientRect();
  const originRect = origin.getBoundingClientRect();

  return {
    left: elRect.left - originRect.left,
    top: elRect.top - originRect.top,
    width: elRect.width,
    height: elRect.height,
    tagName: el.tagName.toLowerCase(),
  };
}

function OutlineBox({
  box,
  strokeWidth,
  color,
  kind,
  label,
}: {
  box: ElementBox;
  strokeWidth: number;
  color: string;
  kind: "hover" | "selection";
  label?: string;
}) {
  const strokeHalf = strokeWidth / 2;
  return (
    <div
      data-embed-element-box
      data-kind={kind}
      style={{
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        pointerEvents: "none",
      }}
    >
      <div
        data-embed-element-outline
        style={{
          position: "absolute",
          left: -strokeHalf,
          top: -strokeHalf,
          right: -strokeHalf,
          bottom: -strokeHalf,
          border: `${strokeWidth}px solid ${color}`,
          boxSizing: "border-box",
          pointerEvents: "none",
        }}
      />
      {label && (
        <div
          data-embed-element-label
          className="bg-[#0d99ff] text-white text-[10px]"
          style={{
            position: "absolute",
            left: 0,
            top: -18,
            padding: "1px 5px",
            borderRadius: 3,
            lineHeight: "14px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

/**
 * DOM overlay that draws the hovered/selected element box while the embed
 * element picker is active. Rendered once at the PixiCanvas level (not
 * per-embed), above the embed layer and the embed selection frame.
 *
 * Boxes are resolved imperatively against `getBoundingClientRect()` (the
 * only reliable source for an element's live layout inside a shadow tree),
 * so this component re-renders — a cheap tick, not a store subscription of
 * the resolved geometry itself — on viewport pan/zoom, scene mutation of the
 * selected embed node, and the picked embed's own internal layout changes
 * (content scroll/resize), but ONLY while the picker is actually active
 * (picking, or holding a selection). Idle (`!pickingEmbedId && !selection`,
 * i.e. this component renders `null`), it subscribes to nothing at all: it's
 * mounted for the full lifetime of `PixiCanvas`, so an unconditional
 * subscription would schedule a React state update — and, once a selection
 * exists, a `querySelector` plus two `getBoundingClientRect()` layout reads
 * — on every pan/zoom/scene-mutation tick (~60/s while panning), almost
 * always just to re-render `null`. The `nodesById` selector below narrows to
 * just the active embed's node, so unrelated scene mutations don't
 * re-render this component either.
 */
export function EmbedElementHighlight() {
  const editorMode = useEditorModeStore((s) => s.mode);
  const pickingEmbedId = useEmbedPickerStore((s) => s.pickingEmbedId);
  const hoveredPath = useEmbedPickerStore((s) => s.hoveredPath);
  const selection = useEmbedPickerStore((s) => s.selection);
  const activeEmbedNode = useSceneStore((s) =>
    selection ? s.nodesById[selection.embedId] : undefined,
  );

  const [, setTick] = useState(0);
  useEffect(() => {
    const activeEmbedId = pickingEmbedId ?? selection?.embedId ?? null;
    if (!activeEmbedId) return;
    const rerender = () => setTick((t) => t + 1);
    const unsubViewport = useViewportStore.subscribe(rerender);
    const unsubLayout = useLayoutStore.subscribe(rerender);

    // The picked embed's box can also go stale from a layout change purely
    // *inside* its shadow content — the content scrolled, or an element
    // animated/resized after mount — which neither viewportStore nor
    // layoutStore (both about the outer canvas/scene) ever sees. Listen
    // directly on the embed's own shadow tree for that. `scroll` is not a
    // composed event, so a capture listener on the shadow root (the
    // furthest ancestor reachable from inside that tree) is the only way to
    // hear it without piping a listener through every scrollable descendant.
    const host = document.querySelector<HTMLElement>(
      `[data-embed-id="${CSS.escape(activeEmbedId)}"]`,
    );
    const shadowRoot = host?.shadowRoot ?? null;
    const contentRoot = (shadowRoot?.firstElementChild as HTMLElement | null) ?? null;
    shadowRoot?.addEventListener("scroll", rerender, true);
    let resizeObserver: ResizeObserver | null = null;
    if (contentRoot && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(rerender);
      resizeObserver.observe(contentRoot);
    }

    return () => {
      unsubViewport();
      unsubLayout();
      shadowRoot?.removeEventListener("scroll", rerender, true);
      resizeObserver?.disconnect();
    };
  }, [pickingEmbedId, selection]);

  // Same gate as EmbedActionBar: the picker is purely an editing affordance
  // and must never paint over a presented slide or a view-mode canvas.
  // Placed after the hooks above (Rules of Hooks) but before any of the
  // work below, so a non-edit mode also skips the querySelector/rect-read
  // work, not just the subscriptions.
  if (!canEditScene(editorMode)) return null;

  const hoverBox =
    pickingEmbedId && hoveredPath ? resolveElementBox(pickingEmbedId, hoveredPath) : null;
  const selectionBox =
    selection && activeEmbedNode
      ? resolveElementBox(selection.embedId, selection.path)
      : null;

  if (!hoverBox && !selectionBox) return null;

  return (
    <div
      data-embed-element-highlight
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 12 }}
    >
      {selectionBox && (
        <OutlineBox
          box={selectionBox}
          strokeWidth={SELECTION_STROKE_WIDTH}
          color={SELECTION_COLOR}
          kind="selection"
        />
      )}
      {hoverBox && (
        <OutlineBox
          box={hoverBox}
          strokeWidth={HOVER_STROKE_WIDTH}
          color={HOVER_COLOR}
          kind="hover"
          label={hoverBox.tagName}
        />
      )}
    </div>
  );
}
