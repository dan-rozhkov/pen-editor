import { Container, Graphics } from "pixi.js";
import { useSelectionStore } from "@/store/selectionStore";
import { useHoverStore } from "@/store/hoverStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { createOverlayHelpers } from "./helpers";
import { redrawSelection } from "./drawSelection";
import { redrawHover } from "./drawHover";
import { redrawFrameNames } from "./drawFrameNames";

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
  let lastScale = useViewportStore.getState().scale;

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

  // Subscribe to stores
  const unsubSelection = useSelectionStore.subscribe(() => {
    doRedrawSelection();
    doRedrawFrameNames();
    doRedrawHover();
  });

  const unsubHover = useHoverStore.subscribe(() => {
    doRedrawHover();
  });

  const unsubScene = useSceneStore.subscribe(() => {
    doRedrawSelection();
    doRedrawFrameNames();
  });

  const unsubViewport = useViewportStore.subscribe(() => {
    const currentScale = useViewportStore.getState().scale;
    if (currentScale === lastScale) return;
    lastScale = currentScale;
    doRedrawSelection();
    doRedrawFrameNames();
    doRedrawHover();
  });

  // Initial draw
  doRedrawSelection();
  doRedrawFrameNames();
  doRedrawHover();

  return () => {
    unsubSelection();
    unsubHover();
    unsubScene();
    unsubViewport();
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
