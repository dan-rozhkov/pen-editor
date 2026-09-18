import { useEffect, useState } from "react";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useEditorModeStore, canEditScene } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useMeasureStore, type MeasureLine } from "@/store/measureStore";
import { resolveElementPath } from "@/lib/embedElementPicker";
import { findTopLevelContentRoot, navigableChildren } from "@/lib/embedElementNavigation";
import { isLayerTreeLeaf } from "@/lib/embedLayerTree";
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

// Mirrors drawDashedRect (src/pixi/selectionOverlay/helpers.ts): dash === gap
// (4/scale world px each) and a 1/scale stroke. Those are WORLD-space, but
// `resolveElementBox` already reports boxes in SCREEN px (post-zoom, via
// `getBoundingClientRect()`), which is exactly what `4/scale` converts BACK
// to once multiplied by `scale` — so the plain, unscaled 4px/4px/1px numbers
// below are the correct 1:1 match at any zoom level, not an approximation.
const CHILD_OUTLINE_DASH = 4;
const CHILD_OUTLINE_GAP = 4;
const CHILD_OUTLINE_STROKE_WIDTH = 1;

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

/** Compute `el`'s on-screen box (relative to `origin`), given the embed
 * `host` it lives under — the shared geometry step behind both
 * `resolveElementBox` (path-addressed) and the child-outline resolvers below
 * (already holding a live `Element`, so re-resolving it by path would be
 * redundant DOM work). See `ElementBox`'s doc comment for what each field
 * means. */
function computeElementBox(host: HTMLElement, origin: HTMLElement, el: Element): ElementBox {
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
  return computeElementBox(host, origin, el);
}

/** Boxes for every navigable child of `parent` (a live element or the
 * embed's content root), in the same canvas-relative coordinate space
 * `resolveElementBox` uses. Shared by both child-outline cases below —
 * "selected element's children" and "embed's top-level children". */
function resolveChildBoxes(host: HTMLElement, origin: HTMLElement, parent: ParentNode): ElementBox[] {
  return navigableChildren(parent).map((el) => computeElementBox(host, origin, el));
}

/** Case A: dashed outlines around the navigable children of the currently
 * hovered-and-selected embed element (`isSelfHover` at the call site) —
 * the embed analog of native `drawHover`'s `childOutlines` for a hovered
 * selected node.
 *
 * Gated on `isLayerTreeLeaf(el)` rather than going straight to
 * `navigableChildren(el)`: `navigableChildren` only filters out skipped
 * tags/inline-hidden elements, so on a `leafEligible` element (only inline-
 * formatting markup below it, e.g. `<div><span>x</span></div>`) it would
 * still return the `<span>` — a child that never gets a row in the layers
 * panel (`embedLayerTree.ts`'s `buildRow` collapses `el` itself to a
 * childless row there) and that keyboard navigation's `firstChildEmbedElement`
 * (same `isLayerTreeLeaf` gate) can never land on via Enter either. Without
 * this the dashed outline promised children the rest of the picker
 * disagrees exist. */
function resolveSelectedElementChildBoxes(embedId: string, path: string): ElementBox[] {
  const host = document.querySelector<HTMLElement>(`[data-embed-id="${CSS.escape(embedId)}"]`);
  const root = host?.shadowRoot;
  if (!host || !root) return [];

  const el = resolveElementPath(root, path);
  if (!el || isLayerTreeLeaf(el)) return [];

  const origin = (host.closest("[data-canvas]") as HTMLElement | null) ?? document.body;
  return resolveChildBoxes(host, origin, el);
}

/** Case B: dashed outlines around the embed's own top-level elements, drawn
 * while the embed node itself is selected (no element picked yet) and the
 * pointer is somewhere over its content — the embed analog of a selected
 * native frame showing its children's outlines.
 *
 * Same `isLayerTreeLeaf` gate as case A above, applied to the content root
 * itself: an embed whose entire visible content is one leaf-eligible
 * wrapper (unusual, but not impossible — a single-icon embed) must show no
 * top-level outlines rather than reaching into markup the layers tree
 * doesn't expose as rows. */
function resolveTopLevelChildBoxes(embedId: string): ElementBox[] {
  const host = document.querySelector<HTMLElement>(`[data-embed-id="${CSS.escape(embedId)}"]`);
  const root = host?.shadowRoot;
  if (!host || !root) return [];

  const contentRoot = findTopLevelContentRoot(root);
  if (!contentRoot || isLayerTreeLeaf(contentRoot)) return [];

  const origin = (host.closest("[data-canvas]") as HTMLElement | null) ?? document.body;
  return resolveChildBoxes(host, origin, contentRoot);
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

/** A single dashed child-outline rect (see `CHILD_OUTLINE_*` constants for
 * where the 4/4/1 numbers come from). SVG rather than a CSS `dashed` border:
 * CSS's dash length is UA-dependent and not independently controllable from
 * the gap, so it can't reproduce `drawDashedRect`'s equal dash/gap ritm.
 * `stroke-dasharray` restarts at (0,0) of the rect's own path rather than
 * being phase-continuous around the corners the way `drawDashedRect`'s
 * per-edge `moveTo`/`lineTo` calls are — a corner can land mid-dash or
 * mid-gap slightly differently than the Pixi original. Visually
 * indistinguishable at the 4px/4px rhythm used here; noted as the accepted
 * compromise between the two renderers rather than something worth a heavier
 * fix (e.g. a `<canvas>`). */
function ChildOutlineRect({ box, color }: { box: ElementBox; color: string }) {
  if (box.width <= 0 || box.height <= 0) return null;
  return (
    <svg
      data-embed-child-outline
      style={{
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        pointerEvents: "none",
        overflow: "visible",
      }}
      width={box.width}
      height={box.height}
    >
      <rect
        x={CHILD_OUTLINE_STROKE_WIDTH / 2}
        y={CHILD_OUTLINE_STROKE_WIDTH / 2}
        width={Math.max(0, box.width - CHILD_OUTLINE_STROKE_WIDTH)}
        height={Math.max(0, box.height - CHILD_OUTLINE_STROKE_WIDTH)}
        fill="none"
        stroke={color}
        strokeWidth={CHILD_OUTLINE_STROKE_WIDTH}
        strokeDasharray={`${CHILD_OUTLINE_DASH} ${CHILD_OUTLINE_GAP}`}
      />
    </svg>
  );
}

/** Clip `box` to the host embed's own on-screen rect (`box.host`), returning
 * a new box with `left`/`top`/`width`/`height` narrowed to the visible
 * intersection, or `null` when there's no overlap at all. The embed's host
 * container clips its content via `height: <node height>px; overflow:
 * auto`, so a child positioned below the fold (tall content in a short
 * embed, or a scrolled embed) reports its full, UNCLIPPED
 * `getBoundingClientRect()` — `left`/`top`/`width`/`height` on `ElementBox`
 * come straight from that rect (see its own doc comment). Without this
 * clip, `ChildOutlineRect` draws the dashed rect at that raw position,
 * spilling out of the host and onto whatever sits below it on the canvas.
 * Deliberately CLIPS rather than drops outright for a partially visible
 * child: the visible sliver still gets a (smaller) outline, matching what's
 * actually on screen, rather than the child vanishing entirely the instant
 * it crosses the fold. Single hover/selection outlines (`OutlineBox`) have
 * the same unclipped-rect issue but are deliberately left alone here — out
 * of scope for this fix; see the review notes this addresses. */
function clipBoxToHost(box: ElementBox): ElementBox | null {
  const left = Math.max(box.left, box.host.left);
  const top = Math.max(box.top, box.host.top);
  const right = Math.min(box.left + box.width, box.host.right);
  const bottom = Math.min(box.top + box.height, box.host.bottom);
  if (right <= left || bottom <= top) return null;
  return { ...box, left, top, width: right - left, height: bottom - top };
}

/** Dashed outlines for every box in `boxes` — the DOM analog of native
 * `drawHover`'s `childOutlines` Graphics layer. Rendered as its own group so
 * it can be placed earlier in DOM order than the hover/selection
 * `OutlineBox`es and the size badge, which must paint on top of it (see the
 * two call sites in `EmbedElementHighlight` below). Each box is clipped to
 * the embed host via `clipBoxToHost` before rendering — see that function's
 * doc comment. */
function ChildOutlines({ boxes, color }: { boxes: ElementBox[]; color: string }) {
  const clipped = boxes
    .map(clipBoxToHost)
    .filter((box): box is ElementBox => box !== null);
  if (clipped.length === 0) return null;
  return (
    <div
      data-embed-child-outlines
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {clipped.map((box, index) => (
        // Positional key: boxes are recomputed fresh every render from a
        // live DOM walk, with no stable per-element id to key on (same
        // reasoning as the rest of this file's imperative box resolution).
        <ChildOutlineRect key={index} box={box} color={color} />
      ))}
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

  // Dashed child outlines, mirroring native `drawHover`'s `childOutlines`
  // for a hovered-and-selected node. Two mutually exclusive cases:
  //  A. An embed element IS selected, and the pointer is over that very
  //     element (`isSelfHover`) — outline its own navigable children.
  //  B. Nothing is picked yet (`selection === null`), the embed itself is
  //     what's being picked (`pickingEmbedId`), and the pointer is
  //     somewhere over its content (`hoveredPath !== null`) — outline the
  //     embed's top-level elements, the same way a selected native frame
  //     shows its children's outlines before any child is selected.
  const childOutlineBoxes =
    selectionBox && isSelfHover && selection
      ? resolveSelectedElementChildBoxes(selection.embedId, selection.path)
      : !selection && pickingEmbedId && hoveredPath
        ? resolveTopLevelChildBoxes(pickingEmbedId)
        : [];

  if (!hoverBox && !selectionBox && !indicatorBox) return null;

  return (
    <div
      data-embed-element-highlight
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 12 }}
    >
      {/* Painted first (= below) so it never sits on top of the hover/
          selection outlines or the size badge, which are drawn after it. */}
      <ChildOutlines boxes={childOutlineBoxes} color={SELECTION_COLOR} />
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
