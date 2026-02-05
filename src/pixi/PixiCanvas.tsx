import { useRef, useEffect, useState, useCallback } from "react";
import { Application, Container } from "pixi.js";
import { InlineNameEditor } from "@/components/InlineNameEditor";
import { InlineTextEditor } from "@/components/InlineTextEditor";
import { useCanvasKeyboardShortcuts } from "@/components/canvas/useCanvasKeyboardShortcuts";
import { useCanvasFileDrop } from "@/components/canvas/useCanvasFileDrop";
import { useClipboardStore } from "@/store/clipboardStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useHistoryStore } from "@/store/historyStore";
import { useMeasureStore } from "@/store/measureStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { createPixiSync } from "./pixiSync";
import { setupPixiViewport } from "./pixiViewport";
import { setupPixiInteraction } from "./pixiInteraction";
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

  // Calculate editing positions using viewport transform
  const getEditingPosition = useCallback((nodeId: string) => {
    const state = useSceneStore.getState();
    const node = state.nodesById[nodeId];
    if (!node) return null;
    // Walk up the parent chain to get absolute position
    let absX = node.x;
    let absY = node.y;
    let current = state.parentById[nodeId];
    while (current) {
      const parentNode = state.nodesById[current];
      if (parentNode) {
        absX += parentNode.x;
        absY += parentNode.y;
      }
      current = state.parentById[current];
    }
    const vs = useViewportStore.getState();
    return {
      x: absX * vs.scale + vs.x,
      y: absY * vs.scale + vs.y,
    };
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

  // Resize handler
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // FPS counter in dev mode
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let rafId = 0;
    let frames = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frames += 1;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Track Alt/Option modifier key for distance measurement overlay
  useEffect(() => {
    const { setModifierHeld, clearLines } = useMeasureStore.getState();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") setModifierHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        setModifierHeld(false);
        clearLines();
      }
    };
    const handleBlur = () => {
      setModifierHeld(false);
      clearLines();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

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
      {/* Zoom indicator */}
      <div
        onClick={() => fitToContent(nodes, dimensions.width, dimensions.height)}
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          background: "rgba(255, 255, 255, 0.9)",
          padding: "4px 8px",
          borderRadius: 4,
          fontSize: 12,
          fontFamily: "system-ui, sans-serif",
          color: "#666",
          zIndex: 10,
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          userSelect: "none",
        }}
        title="Click to fit all (Cmd/Ctrl+0)"
      >
        {Math.round(scale * 100)}%
      </div>
      {import.meta.env.DEV && fps !== null && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "rgba(0, 0, 0, 0.65)",
            padding: "4px 6px",
            borderRadius: 4,
            fontSize: 11,
            fontFamily: "system-ui, sans-serif",
            color: "#fff",
            zIndex: 10,
            userSelect: "none",
          }}
          title="FPS (dev only)"
        >
          {fps} fps
        </div>
      )}
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
