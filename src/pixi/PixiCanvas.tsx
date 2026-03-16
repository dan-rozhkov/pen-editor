import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Application, Container } from "pixi.js";
import { InlineNameEditor} from "@/components/InlineNameEditor";
import { InlineTextEditor } from "@/components/InlineTextEditor";
import { InlineEmbedEditor } from "@/components/InlineEmbedEditor";
import { EmbedActionBar } from "@/components/canvas/EmbedActionBar";
import type { EmbedNode } from "@/types/scene";
import { useCanvasKeyboardShortcuts } from "@/components/canvas/useCanvasKeyboardShortcuts";
import { useCanvasFileDrop } from "@/components/canvas/useCanvasFileDrop";
import {
  useCanvasResize,
  useAltKeyMeasurement,
} from "@/hooks/useCanvasEffects";
import { CircleNotch } from "@phosphor-icons/react";
import { useClipboardStore } from "@/store/clipboardStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useHistoryStore } from "@/store/historyStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useLoadingStore } from "@/store/loadingStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import {
  findParentFrame,
  getNodeAbsolutePositionWithLayout,
  getThemeFromAncestorFrames,
} from "@/utils/nodeUtils";
import { findResolvedDescendantByPath } from "@/utils/instanceRuntime";
import type { RefNode } from "@/types/scene";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { createPixiSync } from "./pixiSync";
import { setupPixiViewport } from "./pixiViewport";
import { setupPixiInteraction } from "./interaction";
import { createSelectionOverlay } from "./selectionOverlay";
import { createOverlayRenderer } from "./OverlayRenderer";

export function PixiCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [, setIsSpacePressed] = useState(false);
  const [isMiddleMouseDown] = useState(false);

  // Store subscriptions for keyboard shortcuts and other React hooks
  const isPanning = useViewportStore((s) => s.isPanning);
  const setIsPanning = useViewportStore((s) => s.setIsPanning);
  const fitToContent = useViewportStore((s) => s.fitToContent);
  const nodes = useSceneStore((state) => state.getNodes());
  const nodesById = useSceneStore((state) => state.nodesById);
  const parentById = useSceneStore((state) => state.parentById);
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
  const { clearSelection, editingNodeId, editingMode } =
    useSelectionStore();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const { undo, redo, saveHistory, startBatch, endBatch } = useHistoryStore();
  const { activeTool, cancelDrawing, toggleTool } = useDrawModeStore();
  const isCanvasLoading = useLoadingStore((s) => s.isCanvasLoading);
  const setPixiRefs = useCanvasRefStore((s) => s.setPixiRefs);

  // Selection data for inline editors
  const instanceContext = useSelectionStore((s) => s.instanceContext);

  // Resolve instance descendant if editing within a component instance
  const resolvedDescendant = useMemo(() => {
    if (!editingNodeId || !instanceContext) return null;
    const state = useSceneStore.getState();
    const refNode = state.nodesById[instanceContext.instanceId];
    if (!refNode || refNode.type !== "ref") return null;
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    return findResolvedDescendantByPath(
      refNode as RefNode,
      instanceContext.descendantPath,
      state.nodesById,
      state.childrenById,
      state.parentById,
      calculateLayoutForFrame,
    );
  }, [editingNodeId, instanceContext]);

  const editingNode = editingNodeId
    ? (resolvedDescendant?.node ?? useSceneStore.getState().nodesById[editingNodeId])
    : null;

  // Calculate editing positions in world coordinates.
  // Inline editors apply viewport transform internally.
  const getEditingPosition = useCallback((nodeId: string) => {
    const nodesTree = useSceneStore.getState().getNodes();
    const calculateLayoutForFrame =
      useLayoutStore.getState().calculateLayoutForFrame;
    return getNodeAbsolutePositionWithLayout(
      nodesTree,
      nodeId,
      calculateLayoutForFrame,
    );
  }, []);

  const editingPosition = editingNodeId
    ? (resolvedDescendant
        ? { x: resolvedDescendant.absX, y: resolvedDescendant.absY }
        : getEditingPosition(editingNodeId))
    : null;
  const editingTextTheme = useMemo(() => {
    if (!editingNodeId || editingMode !== "text") return null;
    if (resolvedDescendant) {
      // For instance descendants, use the instance's ancestor theme
      return getThemeFromAncestorFrames(
        parentById,
        nodesById,
        instanceContext!.instanceId,
        'light',
      );
    }
    return getThemeFromAncestorFrames(
      parentById,
      nodesById,
      editingNodeId,
      'light',
    );
  }, [editingNodeId, editingMode, parentById, nodesById, resolvedDescendant, instanceContext]);
  const editingTextIsInsideAutoLayout = useMemo(() => {
    if (editingMode !== "text" || !editingNodeId) return false;
    if (resolvedDescendant) return false;
    return findParentFrame(nodes, editingNodeId).isInsideAutoLayout;
  }, [editingMode, editingNodeId, nodes, resolvedDescendant]);

  const handleDocumentDrop = useCallback(
    (
      documentData: import("@/utils/fileUtils").DocumentData,
      viewport: { width: number; height: number },
    ) => {
      applyOpenedDocument(documentData, {
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      });
    },
    [],
  );

  const selectedEmbedNode = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const selectedNode = nodesById[selectedIds[0]];
    return selectedNode?.type === "embed" ? (selectedNode as EmbedNode) : null;
  }, [selectedIds, nodesById]);

  const selectedEmbedPosition = useMemo(() => {
    if (!selectedEmbedNode) return null;
    return getEditingPosition(selectedEmbedNode.id);
  }, [selectedEmbedNode, getEditingPosition]);

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
    copyNodes,
  });

  // File drop
  useCanvasFileDrop({
    containerRef,
    addNode,
    addChildToFrame,
    onDocumentDrop: handleDocumentDrop,
    saveHistory,
    startBatch,
    endBatch,
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
        const overlayCleanup = createOverlayRenderer(
          overlayContainer,
          selectionContainer,
          () => ({
            width: app.screen.width,
            height: app.screen.height,
          }),
        );

        // Set up interaction handlers
        const interactionCleanup = setupPixiInteraction(
          app,
          viewport,
          sceneRoot,
        );

        setPixiRefs({
          app,
          viewport,
          sceneRoot,
          overlayContainer,
          selectionContainer,
        });

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
      setPixiRefs(null);
      const a = appRef.current;
      if (a) {
        (a as any)._pixiCleanup?.();
        a.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, [setPixiRefs]); // eslint-disable-line react-hooks/exhaustive-deps

  useCanvasResize(containerRef, setDimensions);
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
      {selectedEmbedNode && selectedEmbedPosition && editingMode !== "embed" && (
        <EmbedActionBar
          node={selectedEmbedNode}
          absoluteX={selectedEmbedPosition.x}
          absoluteY={selectedEmbedPosition.y}
        />
      )}
      {/* Inline text editor overlay */}
      {editingNode && editingPosition && editingMode === "text" && (
        <InlineTextEditor
          node={editingNode as any}
          absoluteX={editingPosition.x}
          absoluteY={editingPosition.y}
          effectiveTheme={editingTextTheme ?? undefined}
          isInsideAutoLayoutParent={editingTextIsInsideAutoLayout}
          onUpdateText={instanceContext ? (text) => {
            useSceneStore.getState().updateInstanceOverride(
              instanceContext.instanceId,
              instanceContext.descendantPath,
              { text } as any,
            );
          } : undefined}
        />
      )}
      {/* Inline embed editor overlay */}
      {editingNode && editingPosition && editingMode === "embed" && (
        <InlineEmbedEditor
          node={editingNode as EmbedNode}
          absoluteX={editingPosition.x}
          absoluteY={editingPosition.y}
        />
      )}
      {/* Inline name editor overlay */}
      {editingNode && editingPosition && editingMode === "name" && (
        <InlineNameEditor
          node={editingNode}
          absoluteX={editingPosition.x}
          absoluteY={editingPosition.y}
        />
      )}
      {/* Canvas loading overlay — opaque to hide content until rendered */}
      {isCanvasLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ background: pageBackground }}
        >
          <CircleNotch
            size={28}
            weight="thin"
            className="text-text-muted"
            style={{ animation: "spin 1s linear infinite" }}
          />
        </div>
      )}
    </div>
  );
}
