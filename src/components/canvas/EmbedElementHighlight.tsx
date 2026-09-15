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

// Mirrors the native selection size badge (src/pixi/selectionOverlay/constants.ts
// SIZE_LABEL_* + drawSelection.ts's drawSizeLabel) so a picked embed element
// reads identically to a native node's selection badge.
const SIZE_BADGE_FONT_SIZE = 11;
const SIZE_BADGE_OFFSET_Y = 6;
const SIZE_BADGE_PADDING_X = 6;
const SIZE_BADGE_PADDING_Y = 3;
const SIZE_BADGE_CORNER_RADIUS = 3;
const SIZE_BADGE_BG = "#0d99ff";
const SIZE_BADGE_TEXT_COLOR = "#ffffff";

interface ElementBox {
  left: number;
  top: number;
  width: number;
  height: number;
  tagName: string;
  /** Untransformed CSS-pixel layout size of the live element, for the size
   * badge text. `left/top/width/height` above come from
   * `getBoundingClientRect()` — screen pixels, correct for positioning this
   * overlay (which lives in the same, also-unscaled, canvas-container
   * coordinate space) but wrong for a size *label* once the embed host is
   * zoomed via `transform: scale(zoom)`: a 100px-wide element then measures
   * 200 at 200% zoom. `offsetWidth`/`offsetHeight` are the element's own
   * layout box and are unaffected by an ancestor's CSS transform, so prefer
   * those; fall back to dividing the screen rect by the current viewport
   * zoom only when the element isn't an `HTMLElement` (e.g. `SVGElement`,
   * which has no `offsetWidth`). */
  cssWidth: number;
  cssHeight: number;
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

  let cssWidth: number;
  let cssHeight: number;
  if (el instanceof HTMLElement) {
    cssWidth = el.offsetWidth;
    cssHeight = el.offsetHeight;
  } else {
    const zoom = useViewportStore.getState().scale || 1;
    cssWidth = elRect.width / zoom;
    cssHeight = elRect.height / zoom;
  }

  return {
    left: elRect.left - originRect.left,
    top: elRect.top - originRect.top,
    width: elRect.width,
    height: elRect.height,
    tagName: el.tagName.toLowerCase(),
    cssWidth,
    cssHeight,
  };
}

/** Convert a sortable drop indicator's rect — CLIENT coordinates, as
 * published by `EmbedLayer`'s drag gesture via `setDropIndicator` — into
 * this overlay's canvas-relative coordinate space, the same way
 * `resolveElementBox` does for hover/selection boxes: subtract the
 * `[data-canvas]` container's own client rect. `embedId` locates that
 * container via the dragged embed's host, exactly like `resolveElementBox`.
 * Returns null when the embed host isn't currently resolvable (e.g. it was
 * unmounted mid-drag). */
function resolveDropIndicatorBox(
  embedId: string,
  indicator: { left: number; top: number; width: number; height: number },
): { left: number; top: number; width: number; height: number } | null {
  const host = document.querySelector<HTMLElement>(`[data-embed-id="${CSS.escape(embedId)}"]`);
  if (!host) return null;
  const origin = (host.closest("[data-canvas]") as HTMLElement | null) ?? document.body;
  const originRect = origin.getBoundingClientRect();
  return {
    left: indicator.left - originRect.left,
    top: indicator.top - originRect.top,
    width: indicator.width,
    height: indicator.height,
  };
}

/** The insertion-line drawn while a sortable element drag is in flight (see
 * `embedElementSortable.ts`'s `DropSlot.indicator`). `box` is already
 * converted into this overlay's canvas-relative coordinate space by
 * `resolveDropIndicatorBox`. */
function DropIndicatorLine({
  box,
}: {
  box: { left: number; top: number; width: number; height: number };
}) {
  return (
    <div
      data-embed-drop-indicator
      style={{
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        background: "#0d99ff",
        borderRadius: 1,
        pointerEvents: "none",
      }}
    />
  );
}

/** Size badge under a selection box, visually matching the native
 * selection's Pixi-drawn size label (drawSizeLabel in
 * src/pixi/selectionOverlay/drawSelection.ts): centered horizontally under
 * the box, `SIZE_BADGE_OFFSET_Y` below its bottom edge, `${w} × ${h}` in
 * CSS pixels of the embed's content — never the screen-space box size,
 * which is zoom-scaled (see `ElementBox.cssWidth`/`cssHeight`). */
function SizeBadge({ box }: { box: ElementBox }) {
  const text = `${Math.round(box.cssWidth)} × ${Math.round(box.cssHeight)}`;
  return (
    <div
      data-embed-element-size-badge
      className="text-white"
      style={{
        position: "absolute",
        left: "50%",
        top: box.height + SIZE_BADGE_OFFSET_Y,
        transform: "translateX(-50%)",
        background: SIZE_BADGE_BG,
        color: SIZE_BADGE_TEXT_COLOR,
        fontSize: SIZE_BADGE_FONT_SIZE,
        lineHeight: "14px",
        whiteSpace: "nowrap",
        padding: `${SIZE_BADGE_PADDING_Y}px ${SIZE_BADGE_PADDING_X}px`,
        borderRadius: SIZE_BADGE_CORNER_RADIUS,
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
}

function OutlineBox({
  box,
  strokeWidth,
  color,
  kind,
  label,
  showSizeBadge,
}: {
  box: ElementBox;
  strokeWidth: number;
  color: string;
  kind: "hover" | "selection";
  label?: string;
  showSizeBadge?: boolean;
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
      {showSizeBadge && <SizeBadge box={box} />}
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
 * (picking, holding a selection, or hovering a row in the layers panel).
 * Idle (`!pickingEmbedId && !hoveredEmbedId && !selection`, i.e. this
 * component renders `null`), it subscribes to nothing at all: it's mounted
 * for the full lifetime of `PixiCanvas`, so an unconditional subscription
 * would schedule a React state update — and, once a selection exists, a
 * `querySelector` plus two `getBoundingClientRect()` layout reads — on
 * every pan/zoom/scene-mutation tick (~60/s while panning), almost always
 * just to re-render `null`. The `nodesById` selector below narrows to
 * just the active embed's node, so unrelated scene mutations don't
 * re-render this component either.
 *
 * The `dragVersion`/`dropIndicator` selectors below are the same kind of
 * narrow, always-safe subscription as `nodesById`: plain Zustand selectors
 * (not the imperative `useEffect` subscriptions above), so they only
 * re-render this component when a drag is actually in progress — never on
 * every idle render, and they cost nothing while idle.
 */
export function EmbedElementHighlight() {
  const editorMode = useEditorModeStore((s) => s.mode);
  const pickingEmbedId = useEmbedPickerStore((s) => s.pickingEmbedId);
  const hoveredPath = useEmbedPickerStore((s) => s.hoveredPath);
  const hoveredEmbedId = useEmbedPickerStore((s) => s.hoveredEmbedId);
  const selection = useEmbedPickerStore((s) => s.selection);
  // While picking, `hoveredPath` is always resolved against the embed being
  // picked — `hoveredEmbedId` only matters for a layers-panel row hover,
  // which happens with `pickingEmbedId` null. Picking takes priority so this
  // never changes behaviour while the canvas picker is active.
  const hoverEmbedId = pickingEmbedId ?? hoveredEmbedId;
  // Bumped on every frame of an in-progress embed-element drag so the box
  // and size badge keep following the element — see the field's doc comment
  // in embedPickerStore.ts for why no other subscription here covers this.
  useEmbedPickerStore((s) => s.dragVersion);
  // Narrow, always-safe selector (same reasoning as `dragVersion` above):
  // only re-renders while a sortable drag is actually publishing an
  // indicator rect, never on every idle render.
  const dropIndicator = useEmbedPickerStore((s) => s.dropIndicator);
  const activeEmbedNode = useSceneStore((s) =>
    selection ? s.nodesById[selection.embedId] : undefined,
  );

  const [, setTick] = useState(0);
  useEffect(() => {
    const activeEmbedId = hoverEmbedId ?? selection?.embedId ?? null;
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
  }, [hoverEmbedId, selection]);

  // Same gate as EmbedActionBar: the picker is purely an editing affordance
  // and must never paint over a presented slide or a view-mode canvas.
  // Placed after the hooks above (Rules of Hooks) but before any of the
  // work below, so a non-edit mode also skips the querySelector/rect-read
  // work, not just the subscriptions.
  if (!canEditScene(editorMode)) return null;

  const hoverBox =
    hoverEmbedId && hoveredPath ? resolveElementBox(hoverEmbedId, hoveredPath) : null;
  const selectionBox =
    selection && activeEmbedNode
      ? resolveElementBox(selection.embedId, selection.path)
      : null;
  const dropIndicatorEmbedId = pickingEmbedId ?? selection?.embedId ?? null;
  const indicatorBox =
    dropIndicator && dropIndicatorEmbedId
      ? resolveDropIndicatorBox(dropIndicatorEmbedId, dropIndicator)
      : null;

  if (!hoverBox && !selectionBox && !indicatorBox) return null;

  // The tag label is a *picking* affordance: it tells you what you're about
  // to select. Once an element IS selected, hovering it again adds nothing —
  // and the label would collide with the size badge the selection already
  // draws. So suppress it when the hover box is the selected element itself;
  // hovering any *other* element still labels it, which is the whole point
  // of the mode.
  const hoverIsSelected =
    !!selection &&
    selection.embedId === hoverEmbedId &&
    selection.path === hoveredPath;

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
          showSizeBadge
        />
      )}
      {hoverBox && (
        <OutlineBox
          box={hoverBox}
          strokeWidth={HOVER_STROKE_WIDTH}
          color={HOVER_COLOR}
          kind="hover"
          label={hoverIsSelected ? undefined : hoverBox.tagName}
        />
      )}
      {indicatorBox && <DropIndicatorLine box={indicatorBox} />}
    </div>
  );
}
