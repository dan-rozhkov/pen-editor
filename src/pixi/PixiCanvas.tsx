import { useRef, useEffect, useState, useCallback } from "react";
import { Application, Container } from "pixi.js";
import * as PIXI from "pixi.js";

// Expose PIXI for debugging
if (typeof window !== "undefined") {
  (window as any).PIXI = PIXI;
}
import { InlineNameEditor } from "@/components/InlineNameEditor";
import { InlineTextEditor } from "@/components/InlineTextEditor";
import { useCanvasKeyboardShortcuts } from "@/components/canvas/useCanvasKeyboardShortcuts";
import { useCanvasFileDrop } from "@/components/canvas/useCanvasFileDrop";
import { useFpsCounter, useCanvasResize, useAltKeyMeasurement } from "@/hooks/useCanvasEffects";
import { ZoomIndicator, FpsDisplay } from "@/components/canvas/CanvasOverlays";
import { useClipboardStore } from "@/store/clipboardStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useHistoryStore } from "@/store/historyStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import { createPixiSync } from "./pixiSync";
import { setupPixiViewport } from "./pixiViewport";
import { setupPixiInteraction } from "./interaction";
import { createSelectionOverlay } from "./SelectionOverlay";
import { createOverlayRenderer } from "./OverlayRenderer";

export function PixiCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [fps, setFps] = useState<number | null>(null);
  const [, setIsSpacePressed] = useState(false);
  const [isMiddleMouseDown] = useState(false);

  // Store subscriptions for keyboard shortcuts and other React hooks
  const scale = useViewportStore((s) => s.scale);
  const isPanning = useViewportStore((s) => s.isPanning);
  const setIsPanning = useViewportStore((s) => s.setIsPanning);
  const fitToContent = useViewportStore((s) => s.fitToContent);
  const nodes = useSceneStore((state) => state.getNodes());
  const pageBackground = useSceneStore((state) => state.pageBackground);
  const addNode = useSceneStore((state) => state.addNode);
  const addChildToFrame = useSceneStore((state) => state.addChildToFrame);
  const deleteNode = useSceneStore((state) => state.deleteNode);
  const updateNode = useSceneStore((state) => state.updateNode);
  const moveNode = useSceneStore((state) => state.moveNode);
  const groupNodes = useSceneStore((state) => state.groupNodes);
  const ungroupNodes = useSceneStore((state) => state.ungroupNodes);
  const wrapInAutoLayoutFrame = useSceneStore(
    (state) => state.wrapInAutoLayoutFrame,
  );
  const restoreSnapshot = useSceneStore((state) => state.restoreSnapshot);
  const { copiedNodes, copyNodes } = useClipboardStore();
  const {
    clearSelection,
    editingNodeId,
    editingMode,
    exitInstanceEditMode,
  } = useSelectionStore();
  const { undo, redo, saveHistory, startBatch, endBatch } = useHistoryStore();
  const { activeTool, cancelDrawing, toggleTool } = useDrawModeStore();

  // Selection data for inline editors
  const editingTextNode = editingMode === "text" && editingNodeId
    ? useSceneStore.getState().nodesById[editingNodeId]
    : null;
  const editingNameNode = editingMode === "name" && editingNodeId
    ? useSceneStore.getState().nodesById[editingNodeId]
    : null;

  // Calculate editing positions in world coordinates.
  // Inline editors apply viewport transform internally.
  const getEditingPosition = useCallback((nodeId: string) => {
    const nodesTree = useSceneStore.getState().getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    return getNodeAbsolutePositionWithLayout(
      nodesTree,
      nodeId,
      calculateLayoutForFrame,
    );
  }, []);

  const editingTextPosition = editingNodeId && editingMode === "text"
    ? getEditingPosition(editingNodeId)
    : null;
  const editingNamePosition = editingNodeId && editingMode === "name"
    ? getEditingPosition(editingNodeId)
    : null;

  // Keyboard shortcuts (reuse existing hook)
  useCanvasKeyboardShortcuts({
    nodes,
    copiedNodes,
    dimensions,
    isMiddleMouseDown,
    setIsSpacePressed,
    setIsPanning,
    addNode,
    addChildToFrame,
    deleteNode,
    updateNode,
    moveNode,
    groupNodes,
    ungroupNodes,
    wrapInAutoLayoutFrame,
    restoreSnapshot,
    saveHistory,
    startBatch,
    endBatch,
    undo,
    redo,
    fitToContent,
    toggleTool,
    cancelDrawing,
    clearSelection,
    exitInstanceEditMode,
    copyNodes,
  });

  // File drop
  useCanvasFileDrop({
    containerRef,
    addNode,
  });

  // Initialize PixiJS Application
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const app = new Application();
    let destroyed = false;

    app
      .init({
        resizeTo: container,
        antialias: true,
        // Improve SVG path curve tessellation quality (default 0.5 is too coarse).
        bezierSmoothness: 0.9,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })
      .then(() => {
        if (destroyed) {
          app.destroy(true, { children: true });
          return;
        }

        container.appendChild(app.canvas as HTMLCanvasElement);
        appRef.current = app;
        // Expose for debugging
        (window as any).__PIXI_APP__ = app;

        // Scene graph structure:
        // app.stage
        //   └── viewport (Container) — pan/zoom transforms
        //        ├── sceneRoot (Container) — all node containers
        //        ├── overlayContainer (Container) — guides, drop indicators, marquee
        //        └── selectionContainer (Container) — selection outlines + handles

        const viewport = new Container();
        viewport.label = "viewport";
        viewport.isRenderGroup = true;
        app.stage.addChild(viewport);

        const sceneRoot = new Container();
        sceneRoot.label = "sceneRoot";
        viewport.addChild(sceneRoot);

        const overlayContainer = new Container();
        overlayContainer.label = "overlayContainer";
        viewport.addChild(overlayContainer);

        const selectionContainer = new Container();
        selectionContainer.label = "selectionContainer";
        viewport.addChild(selectionContainer);

        // Set up viewport sync (pan/zoom from store)
        const viewportCleanup = setupPixiViewport(viewport);

        // Set up store -> PixiJS sync
        const syncCleanup = createPixiSync(sceneRoot);

        // Set up selection overlay
        const selectionCleanup = createSelectionOverlay(
          selectionContainer,
          sceneRoot,
        );

        // Set up overlay rendering (guides, drop indicator, marquee)
        const overlayCleanup = createOverlayRenderer(overlayContainer);

        // Set up interaction handlers
        const interactionCleanup = setupPixiInteraction(
          app,
          viewport,
          sceneRoot,
        );

        // Store cleanup functions
        (app as any)._pixiCleanup = () => {
          viewportCleanup();
          syncCleanup();
          selectionCleanup();
          overlayCleanup();
          interactionCleanup();
        };
      });

    return () => {
      destroyed = true;
      const a = appRef.current;
      if (a) {
        (a as any)._pixiCleanup?.();
        a.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useCanvasResize(containerRef, setDimensions);
  useFpsCounter(setFps);
  useAltKeyMeasurement();

  return (
    <div
      ref={containerRef}
      data-canvas
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        cursor: isPanning ? "grab" : activeTool ? "crosshair" : "default",
        background: pageBackground,
        position: "relative",
      }}
    >
      <ZoomIndicator scale={scale} onFitToContent={() => fitToContent(nodes, dimensions.width, dimensions.height)} />
      <FpsDisplay fps={fps} />
      {/* PixiJS renderer badge */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          background: "rgba(0, 128, 0, 0.75)",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 10,
          fontFamily: "system-ui, sans-serif",
          color: "#fff",
          zIndex: 10,
          userSelect: "none",
        }}
      >
        PixiJS
      </div>
      {/* Inline text editor overlay */}
      {editingTextNode && editingTextPosition && editingMode === "text" && (
        <InlineTextEditor
          node={editingTextNode as any}
          absoluteX={editingTextPosition.x}
          absoluteY={editingTextPosition.y}
        />
      )}
      {/* Inline name editor overlay */}
      {editingNameNode && editingNamePosition && editingMode === "name" && (
        <InlineNameEditor
          node={editingNameNode as any}
          absoluteX={editingNamePosition.x}
          absoluteY={editingNamePosition.y}
        />
      )}
    </div>
  );
}
