import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Application, Container } from "pixi.js";
import { InlineNameEditor} from "@/components/InlineNameEditor";
import { InlineTextEditor } from "@/components/InlineTextEditor";
import { InlineEmbedEditor } from "@/components/InlineEmbedEditor";
import { EmbedActionBar } from "@/components/canvas/EmbedActionBar";
import { EmbedAgentButton } from "@/components/canvas/EmbedAgentButton";
import { EmbedSelectionFrame } from "@/components/canvas/EmbedSelectionFrame";
import { EmbedLayer } from "@/components/canvas/EmbedLayer";
import { FrameAgentButton } from "@/components/canvas/FrameAgentButton";
import type { EmbedNode, FrameNode, TextNode, InstanceOverrideUpdateProps } from "@/types/scene";
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
import { useEditorModeStore, canEditScene } from "@/store/editorModeStore";
import {
  findParentFrame,
  getNodeAbsolutePositionWithLayout,
  getThemeFromAncestorFrames,
} from "@/utils/nodeUtils";
import { findResolvedDescendantByPath } from "@/utils/instanceRuntime";
import type { RefNode } from "@/types/scene";
import { findSlotContext } from "@/utils/componentUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { createPixiSync } from "./pixiSync";
import { setupPixiViewport } from "./pixiViewport";
import { setupPixiInteraction } from "./interaction";
import { createSelectionOverlay } from "./selectionOverlay";
import { createOverlayRenderer } from "./OverlayRenderer";
import { setupRenderScheduler } from "./renderScheduler";

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
  const booleanOperation = useSceneStore((state) => state.booleanOperation);
  const restoreSnapshot = useSceneStore((state) => state.restoreSnapshot);
  const { copiedNodes, copyNodes } = useClipboardStore();
  const { clearSelection, editingNodeId, editingMode } =
    useSelectionStore();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const { undo, redo, saveHistory, startBatch, endBatch } = useHistoryStore();
  const { activeTool, cancelDrawing, toggleTool } = useDrawModeStore();
  const isCanvasLoading = useLoadingStore((s) => s.isCanvasLoading);
  const setPixiRefs = useCanvasRefStore((s) => s.setPixiRefs);
  const editorMode = useEditorModeStore((s) => s.mode);

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
    const nodes = useSceneStore.getState().getNodes();
    return findParentFrame(nodes, editingNodeId).isInsideAutoLayout;
  }, [editingMode, editingNodeId, resolvedDescendant]);

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

  const selectedFrameNode = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const selectedNode = nodesById[selectedIds[0]];
    return selectedNode?.type === "frame" ? (selectedNode as FrameNode) : null;
  }, [selectedIds, nodesById]);

  const selectedFramePosition = useMemo(() => {
    if (!selectedFrameNode) return null;
    return getEditingPosition(selectedFrameNode.id);
  }, [selectedFrameNode, getEditingPosition]);

  // Keyboard shortcuts (reuse existing hook)
  useCanvasKeyboardShortcuts({
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
    booleanOperation,
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

        // Render on demand: detach Pixi's per-frame render and drive it from
        // store/overlay/font signals + a trailing window + a safety tick.
        const renderSchedulerCleanup = setupRenderScheduler(app);

        setPixiRefs({
          app,
          viewport,
          sceneRoot,
          overlayContainer,
          selectionContainer,
        });

        // Store cleanup functions
        (app as Application & { _pixiCleanup?: () => void })._pixiCleanup = () => {
          // Scheduler cleanup must run while the app/ticker still exist.
          renderSchedulerCleanup();
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
        (a as Application & { _pixiCleanup?: () => void })._pixiCleanup?.();
        a.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, [setPixiRefs]);

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
      {/* Code layers rendered as live DOM above the Pixi canvas */}
      <EmbedLayer />
      {/* Selection frame + resize handles mirrored as DOM above the embed
          layer — the Pixi overlay is hidden behind the embed's HTML content. */}
      {selectedEmbedNode && selectedEmbedPosition && editingMode !== "embed" && (
        <EmbedSelectionFrame
          node={selectedEmbedNode}
          absoluteX={selectedEmbedPosition.x}
          absoluteY={selectedEmbedPosition.y}
        />
      )}
      {selectedEmbedNode && selectedEmbedPosition && editingMode !== "embed" && (
        <EmbedActionBar
          node={selectedEmbedNode}
          absoluteX={selectedEmbedPosition.x}
          absoluteY={selectedEmbedPosition.y}
        />
      )}
      {/* On-canvas agent affordance for a selected embed */}
      {selectedEmbedNode &&
        selectedEmbedPosition &&
        editingMode !== "embed" &&
        canEditScene(editorMode) && (
          <EmbedAgentButton
            key={selectedEmbedNode.id}
            node={selectedEmbedNode}
            absoluteX={selectedEmbedPosition.x}
            absoluteY={selectedEmbedPosition.y}
          />
        )}
      {/* On-canvas agent affordance for a selected frame */}
      {selectedFrameNode &&
        selectedFramePosition &&
        !editingNodeId &&
        canEditScene(editorMode) && (
          <FrameAgentButton
            key={selectedFrameNode.id}
            node={selectedFrameNode}
            absoluteX={selectedFramePosition.x}
            absoluteY={selectedFramePosition.y}
          />
        )}
      {/* Inline text editor overlay */}
      {editingNode && editingPosition && editingMode === "text" && (
        <InlineTextEditor
          node={editingNode as TextNode}
          absoluteX={editingPosition.x}
          absoluteY={editingPosition.y}
          effectiveTheme={editingTextTheme ?? undefined}
          isInsideAutoLayoutParent={editingTextIsInsideAutoLayout}
          onUpdateText={instanceContext ? (text, paragraphs) => {
            const store = useSceneStore.getState();
            const inst = store.nodesById[instanceContext.instanceId] as RefNode | undefined;
            const sc = inst?.type === "ref" ? findSlotContext(instanceContext.descendantPath, inst.overrides) : null;
            const updates: Partial<TextNode> = paragraphs !== undefined ? { text, paragraphs } : { text };
            if (sc) {
              store.updateSlotChildWithoutHistory(instanceContext.instanceId, sc.slotPath, sc.relativePath, updates);
            } else {
              store.updateInstanceOverride(instanceContext.instanceId, instanceContext.descendantPath, updates satisfies Partial<TextNode> as InstanceOverrideUpdateProps);
            }
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
