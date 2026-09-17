import { useEffect, useState } from "react";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useEditorModeStore, canEditScene } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useMeasureStore, type MeasureLine } from "@/store/measureStore";
import { resolveElementPath } from "@/lib/embedElementPicker";
import { formatMeasureLine } from "@/lib/inspect/units";
import { computeMeasurementLines, measureLineEndpoints, type NodeBounds } from "@/utils/measureUtils";
import { EmbedElementAgentButton } from "@/components/canvas/EmbedElementAgentButton";

const HOVER_COLOR = "#0d99ff";
const SELECTION_COLOR = "#0d99ff";
const MEASURE_COLOR = "#f24822";
const HOVER_STROKE_WIDTH = 2;
const SELECTION_STROKE_WIDTH = 1;

// Mirrors the floating labels and end-caps painted by OverlayRenderer's
// `redrawMeasureLines`, in screen-space DOM rather than its world-space Pixi
// layer. The embed content itself is DOM, so the Pixi overlay sits behind it.
const MEASURE_STROKE_WIDTH = 1;
const MEASURE_CAP_SIZE = 4;
const MEASURE_LABEL_FONT_SIZE = 11;
const MEASURE_LABEL_PADDING_X = 4;
const MEASURE_LABEL_PADDING_Y = 2;
const MEASURE_LABEL_RADIUS = 2;

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
  /** The owning embed host's own box, in the same canvas-relative space as
   * `left`/`top`. Not an anchor any more (the element-scoped agent button
   * anchors on the element itself) — it is the clamp that keeps that button
   * on the embed: `left/top/width/height` come from the element's
   * *unclipped* rect, so an element wider than the embed's clipped viewport,
   * or one scrolled out of it, would otherwise put the trigger in empty
   * canvas with nothing under it. */
  host: { left: number; top: number; right: number; bottom: number };
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

  const hostRect = host.getBoundingClientRect();

  return {
    left: elRect.left - originRect.left,
    top: elRect.top - originRect.top,
    host: {
      left: hostRect.left - originRect.left,
      top: hostRect.top - originRect.top,
      right: hostRect.right - originRect.left,
      bottom: hostRect.bottom - originRect.top,
    },
    width: elRect.width,
    height: elRect.height,
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
      style={{
        position: "absolute",
        left: "50%",
        top: box.height + SIZE_BADGE_OFFSET_Y,
        transform: "translateX(-50%)",
        background: SIZE_BADGE_BG,
        color: SIZE_BADGE_TEXT_COLOR,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: SIZE_BADGE_FONT_SIZE,
        lineHeight: `${SIZE_BADGE_FONT_SIZE}px`,
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

/** Where the element-scoped agent trigger goes: the picked element's own
 * top-right corner — the same corner `NodeAgentButton` uses for a native
 * node, so the affordance is where the user just clicked instead of across
 * the embed. It is clamped into the embed host's box because the element
 * rect is unclipped: a full-bleed or scrolled-out-of-view element would
 * otherwise anchor the trigger onto empty canvas.
 *
 * The cost this accepts, deliberately: the trigger (and the composer it
 * opens) overlaps live embed HTML and, being an overlay above the embed
 * layer, takes the pointer events for that small area. Sitting beside the
 * *embed* avoided that, but put the affordance arbitrarily far from the
 * element it acts on, which is the bug this replaces. */
function elementAgentAnchor(box: ElementBox): { x: number; y: number } {
  return {
    x: Math.min(box.left + box.width, box.host.right),
    y: Math.min(Math.max(box.top, box.host.top), box.host.bottom),
  };
}

/** Convert an on-screen element box back to the embed's CSS-pixel coordinate
 * system. `getBoundingClientRect()` is zoomed by the canvas viewport, but
 * native measurements are expressed in design (world) pixels. */
function toCssBounds(box: ElementBox, zoom: number): NodeBounds {
  return {
    x: box.left / zoom,
    y: box.top / zoom,
    width: box.width / zoom,
    height: box.height / zoom,
  };
}

function getElementRelation(
  embedId: string,
  selectedPath: string,
  hoveredPath: string,
): "to-is-ancestor" | "sibling" {
  const host = document.querySelector<HTMLElement>(
    `[data-embed-id="${CSS.escape(embedId)}"]`,
  );
  const root = host?.shadowRoot;
  if (!root) return "sibling";

  const selected = resolveElementPath(root, selectedPath);
  const hovered = resolveElementPath(root, hoveredPath);
  if (!selected || !hovered) return "sibling";
  // Match measurementController's directed native-hover semantics exactly:
  // parent distances are shown only when the hovered target contains the
  // selection. Selecting a parent and hovering its child follows the sibling
  // path (which produces no lines for overlapping/nested bounds).
  if (hovered.contains(selected)) return "to-is-ancestor";
  return "sibling";
}

function MeasureLineOverlay({ line, zoom }: { line: MeasureLine; zoom: number }) {
  const { x1, y1, x2, y2 } = measureLineEndpoints(line);
  const horizontal = line.orientation === "horizontal";
  const startX = Math.min(x1, x2) * zoom;
  const startY = Math.min(y1, y2) * zoom;
  const length = Math.abs((horizontal ? x2 - x1 : y2 - y1) * zoom);
  const centerX = ((x1 + x2) / 2) * zoom;
  const centerY = ((y1 + y2) / 2) * zoom;
  const capStyle = horizontal
    ? {
        left: -MEASURE_STROKE_WIDTH / 2,
        top: -MEASURE_CAP_SIZE,
        width: MEASURE_STROKE_WIDTH,
        height: MEASURE_CAP_SIZE * 2,
      }
    : {
        left: -MEASURE_CAP_SIZE,
        top: -MEASURE_STROKE_WIDTH / 2,
        width: MEASURE_CAP_SIZE * 2,
        height: MEASURE_STROKE_WIDTH,
      };

  return (
    <>
      <div
        data-embed-measure-line
        data-orientation={line.orientation}
        style={{
          position: "absolute",
          left: startX,
          top: startY,
          width: horizontal ? length : MEASURE_STROKE_WIDTH,
          height: horizontal ? MEASURE_STROKE_WIDTH : length,
          background: MEASURE_COLOR,
          pointerEvents: "none",
        }}
      >
        <div
          data-embed-measure-cap="start"
          style={{ position: "absolute", background: MEASURE_COLOR, ...capStyle }}
        />
        <div
          data-embed-measure-cap="end"
          style={{
            position: "absolute",
            background: MEASURE_COLOR,
            ...capStyle,
            ...(horizontal
              ? { left: length - MEASURE_STROKE_WIDTH / 2 }
              : { top: length - MEASURE_STROKE_WIDTH / 2 }),
          }}
        />
      </div>
      <div
        data-embed-measure-label
        style={{
          position: "absolute",
          left: centerX,
          top: centerY,
          transform: "translate(-50%, -50%)",
          background: MEASURE_COLOR,
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: MEASURE_LABEL_FONT_SIZE,
          lineHeight: `${MEASURE_LABEL_FONT_SIZE}px`,
          whiteSpace: "nowrap",
          padding: `${MEASURE_LABEL_PADDING_Y}px ${MEASURE_LABEL_PADDING_X}px`,
          borderRadius: MEASURE_LABEL_RADIUS,
          pointerEvents: "none",
        }}
      >
        {line.label}
      </div>
    </>
  );
}

function EmbedElementMeasures({
  embedId,
  selectionPath,
  hoveredPath,
  selectionBox,
  hoverBox,
  active,
  formatLabels,
  units,
  remBase,
}: {
  embedId: string;
  selectionPath: string;
  hoveredPath: string;
  selectionBox: ElementBox;
  hoverBox: ElementBox;
  active: boolean;
  formatLabels: boolean;
  units: "px" | "rem";
  remBase: number;
}) {
  if (!active || selectionPath === hoveredPath) return null;

  const zoom = useViewportStore.getState().scale || 1;
  const relation = getElementRelation(embedId, selectionPath, hoveredPath);
  const lines = computeMeasurementLines(
    toCssBounds(selectionBox, zoom),
    toCssBounds(hoverBox, zoom),
    relation,
  ).map((line) => (formatLabels ? formatMeasureLine(line, units, remBase) : line));

  if (lines.length === 0) return null;
  return (
    <div
      data-embed-element-measures
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {lines.map((line, index) => (
        <MeasureLineOverlay key={`${line.orientation}-${index}`} line={line} zoom={zoom} />
      ))}
    </div>
  );
}

function OutlineBox({
  box,
  strokeWidth,
  color,
  kind,
  showSizeBadge,
}: {
  box: ElementBox;
  strokeWidth: number;
  color: string;
  kind: "hover" | "selection";
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
  const devMode = useDevModeStore((s) => s);
  const modifierHeld = useMeasureStore((s) => s.modifierHeld);
  const pickingEmbedId = useEmbedPickerStore((s) => s.pickingEmbedId);
  const hoveredPath = useEmbedPickerStore((s) => s.hoveredPath);
  const hoveredEmbedId = useEmbedPickerStore((s) => s.hoveredEmbedId);
  const selection = useEmbedPickerStore((s) => s.selection);
  // The element currently being typed into (see `embedPickerStore.ts`'s doc
  // comment on these two fields) — the selection box drawn for it below
  // must be withheld, or it sits on top of the live caret/text for the
  // whole edit.
  const editingEmbedId = useEmbedPickerStore((s) => s.editingEmbedId);
  const editingPath = useEmbedPickerStore((s) => s.editingPath);
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

  // The picker is purely an editing affordance and must never paint over a
  // presented slide or a view-mode canvas — same gate useEmbedPickerLifecycle
  // uses to decide whether to auto-start picking in the first place.
  // Placed after the hooks above (Rules of Hooks) but before any of the
  // work below, so a non-edit mode also skips the querySelector/rect-read
  // work, not just the subscriptions.
  if (!canEditScene(editorMode)) return null;

  const hoverBox =
    hoverEmbedId && hoveredPath ? resolveElementBox(hoverEmbedId, hoveredPath) : null;
  // Withhold the selection box entirely while its element is the one being
  // typed into — `EmbedLayer`'s dblclick handler puts the picker's own
  // selection on that same element (see `beginElementEdit`), so without this
  // check the box + size badge would be drawn right on top of the caret for
  // the whole edit.
  const isEditingSelection =
    editingPath !== null &&
    !!selection &&
    selection.embedId === editingEmbedId &&
    selection.path === editingPath;
  const selectionBox =
    !isEditingSelection && selection && activeEmbedNode
      ? resolveElementBox(selection.embedId, selection.path)
      : null;
  // This exactly mirrors `measurementController`: a native selection is
  // measured against a different hovered node on Alt, or unconditionally in
  // Dev Mode. Here both targets must be elements of the same embed.
  const showMeasures =
    !!selectionBox &&
    !!hoverBox &&
    !!selection &&
    !!hoveredPath &&
    hoverEmbedId === selection.embedId &&
    (modifierHeld || devMode.active);
  const isSelfHover =
    !!selection &&
    !!hoveredPath &&
    hoverEmbedId === selection.embedId &&
    hoveredPath === selection.path;
  const dropIndicatorEmbedId = pickingEmbedId ?? selection?.embedId ?? null;
  const indicatorBox =
    dropIndicator && dropIndicatorEmbedId
      ? resolveDropIndicatorBox(dropIndicatorEmbedId, dropIndicator)
      : null;

  if (!hoverBox && !selectionBox && !indicatorBox) return null;

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
          color={devMode.active && selection && !isSelfHover ? MEASURE_COLOR : HOVER_COLOR}
          kind="hover"
        />
      )}
      {showMeasures && selection && hoveredPath && selectionBox && hoverBox && (
        <EmbedElementMeasures
          embedId={selection.embedId}
          selectionPath={selection.path}
          hoveredPath={hoveredPath}
          selectionBox={selectionBox}
          hoverBox={hoverBox}
          active={showMeasures}
          formatLabels={devMode.active}
          units={devMode.units}
          remBase={devMode.remBase}
        />
      )}
      {indicatorBox && <DropIndicatorLine box={indicatorBox} />}
      {selectionBox && selection && (
        // Keyed by embed id alone, NOT by the element path: a sortable
        // reorder rewrites `selection.path` for the very element being
        // dragged (`noteSelectionEdit` in EmbedLayer), and keying on it would
        // remount the composer mid-gesture, silently discarding a prompt the
        // user had already typed into it.
        <div key={selection.embedId} style={{ pointerEvents: "auto" }}>
          <EmbedElementAgentButton
            selection={selection}
            anchor={elementAgentAnchor(selectionBox)}
          />
        </div>
      )}
    </div>
  );
}
