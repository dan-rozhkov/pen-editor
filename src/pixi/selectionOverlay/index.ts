import { Container, Graphics } from "pixi.js";
import { useSelectionStore } from "@/store/selectionStore";
import { useHoverStore } from "@/store/hoverStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { createOverlayHelpers } from "./helpers";
import { redrawSelection } from "./drawSelection";
import { redrawHover } from "./drawHover";
import { redrawFrameNames, cleanupFrameNamePool } from "./drawFrameNames";

// Dirty flags for RAF batching
const DIRTY_SELECTION = 1;
const DIRTY_FRAME_NAMES = 2;
const DIRTY_HOVER = 4;


/**
 * Create the selection overlay that draws selection outlines, transform handles,
 * frame name labels, and node size labels.
 * Returns a cleanup function.
 */
export function createSelectionOverlay(
  selectionContainer: Container,
  sceneRoot: Container,
): () => void {
  const outlinesContainer = new Container();
  outlinesContainer.label = "selection-outlines";
  selectionContainer.addChild(outlinesContainer);

  const hovOutline = new Graphics();
  hovOutline.label = "hover-outline";
  selectionContainer.addChild(hovOutline);

  const spacingOverlay = new Container();
  spacingOverlay.label = "spacing-overlay";
  selectionContainer.addChild(spacingOverlay);

  const childOutlines = new Graphics();
  childOutlines.label = "child-outlines";
  selectionContainer.addChild(childOutlines);

  const selectionTextBaselines = new Graphics();
  selectionTextBaselines.label = "selection-text-baselines";
  selectionContainer.addChild(selectionTextBaselines);

  const hoverTextBaselines = new Graphics();
  hoverTextBaselines.label = "hover-text-baselines";
  selectionContainer.addChild(hoverTextBaselines);

  const handlesContainer = new Container();
  handlesContainer.label = "transform-handles";
  selectionContainer.addChild(handlesContainer);

  const frameNamesContainer = new Container();
  frameNamesContainer.label = "frame-names";
  selectionContainer.addChild(frameNamesContainer);

  const sizeLabelsContainer = new Container();
  sizeLabelsContainer.label = "size-labels";
  selectionContainer.addChild(sizeLabelsContainer);

  const spacingLabel = new Container();
  spacingLabel.label = "spacing-label";
  selectionContainer.addChild(spacingLabel);

  const helpers = createOverlayHelpers(sceneRoot);
  let lastViewport = useViewportStore.getState();
  let dirtyFlags = 0;
  let selectionRafId: number | null = null;
  let hiddenDuringZoom = false;

  function doRedrawSelection() {
    redrawSelection(
      outlinesContainer,
      handlesContainer,
      sizeLabelsContainer,
      selectionTextBaselines,
      helpers,
    );
  }

  function doRedrawHover() {
    redrawHover(hovOutline, childOutlines, hoverTextBaselines, spacingOverlay, spacingLabel, helpers);
  }

  function doRedrawFrameNames() {
    redrawFrameNames(frameNamesContainer);
  }

  function flushSelectionRedraw(): void {
    selectionRafId = null;
    const flags = dirtyFlags;
    dirtyFlags = 0;
    if (flags & DIRTY_SELECTION) doRedrawSelection();
    if (flags & DIRTY_FRAME_NAMES) doRedrawFrameNames();
    if (flags & DIRTY_HOVER) doRedrawHover();
  }

  function scheduleSelectionRedraw(flags: number): void {
    dirtyFlags |= flags;
    if (selectionRafId !== null) return;
    selectionRafId = requestAnimationFrame(flushSelectionRedraw);
  }

  // Selection/hover/scene — batched via RAF (no positional sensitivity)
  const unsubSelection = useSelectionStore.subscribe(() => {
    scheduleSelectionRedraw(DIRTY_SELECTION | DIRTY_FRAME_NAMES | DIRTY_HOVER);
  });

  const unsubHover = useHoverStore.subscribe(() => {
    scheduleSelectionRedraw(DIRTY_HOVER);
  });

  const unsubScene = useSceneStore.subscribe(() => {
    scheduleSelectionRedraw(DIRTY_SELECTION | DIRTY_FRAME_NAMES);
  });

  // Viewport — synchronous to stay in sync with pixiViewport.ts transform.
  // Labels use 1/scale sizing; a 1-frame lag causes visible jitter.
  // Fix 2 (hide during zoom animation) handles the perf-critical path.
  const unsubViewport = useViewportStore.subscribe(() => {
    const state = useViewportStore.getState();
    const scaleChanged = state.scale !== lastViewport.scale;
    const panChanged = state.x !== lastViewport.x || state.y !== lastViewport.y;
    lastViewport = state;

    if (!scaleChanged && !panChanged) return;

    // During active zoom animation: hide expensive overlays (outlines, handles,
    // hover) but keep frame names visible — they're cheap with pooling + culling
    // and users expect them to smoothly track zoom.
    if (state.animationFrameId !== null) {
      if (!hiddenDuringZoom) {
        hiddenDuringZoom = true;
        outlinesContainer.visible = false;
        handlesContainer.visible = false;
        sizeLabelsContainer.visible = false;
        hovOutline.visible = false;
        childOutlines.visible = false;
        spacingOverlay.visible = false;
        spacingLabel.visible = false;
        selectionTextBaselines.visible = false;
        hoverTextBaselines.visible = false;
      }
      // Still redraw frame names synchronously during zoom
      if (scaleChanged) doRedrawFrameNames();
      return;
    }

    // Animation ended — restore visibility and do full redraw
    if (hiddenDuringZoom) {
      hiddenDuringZoom = false;
      outlinesContainer.visible = true;
      handlesContainer.visible = true;
      sizeLabelsContainer.visible = true;
      hovOutline.visible = true;
      childOutlines.visible = true;
      spacingOverlay.visible = true;
      spacingLabel.visible = true;
      selectionTextBaselines.visible = true;
      hoverTextBaselines.visible = true;
    }

    if (scaleChanged) {
      // Scale affects label sizing — synchronous full redraw
      doRedrawSelection();
      doRedrawFrameNames();
      doRedrawHover();
    } else {
      // Pan only — just update frame name culling via RAF (no jitter risk)
      scheduleSelectionRedraw(DIRTY_FRAME_NAMES);
    }
  });

  // Initial draw
  doRedrawSelection();
  doRedrawFrameNames();
  doRedrawHover();

  return () => {
    if (selectionRafId !== null) {
      cancelAnimationFrame(selectionRafId);
      selectionRafId = null;
    }
    unsubSelection();
    unsubHover();
    unsubScene();
    unsubViewport();
    cleanupFrameNamePool();
    outlinesContainer.destroy({ children: true });
    hovOutline.destroy();
    spacingOverlay.destroy({ children: true });
    spacingLabel.destroy({ children: true });
    childOutlines.destroy();
    selectionTextBaselines.destroy();
    hoverTextBaselines.destroy();
    handlesContainer.destroy({ children: true });
    frameNamesContainer.destroy({ children: true });
    sizeLabelsContainer.destroy({ children: true });
  };
}
