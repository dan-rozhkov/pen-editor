import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Application, Container } from "pixi.js";
import { InlineNameEditor} from "@/components/InlineNameEditor";
import { InlineTextEditor } from "@/components/InlineTextEditor";
import { InlineEmbedEditor } from "@/components/InlineEmbedEditor";
import { EmbedActionBar } from "@/components/canvas/EmbedActionBar";
import type { EmbedNode, RefNode, TextNode } from "@/types/scene";
import { useCanvasKeyboardShortcuts } from "@/components/canvas/useCanvasKeyboardShortcuts";
import { useCanvasFileDrop } from "@/components/canvas/useCanvasFileDrop";
import {
  useFpsCounter,
  useCanvasResize,
  useAltKeyMeasurement,
} from "@/hooks/useCanvasEffects";
import { ZoomIndicator, FpsDisplay } from "@/components/canvas/CanvasOverlays";
import { useClipboardStore } from "@/store/clipboardStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useHistoryStore } from "@/store/historyStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useThemeStore } from "@/store/themeStore";
import { useViewportStore } from "@/store/viewportStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import {
  findEffectiveThemeInTree,
  findParentFrame,
  findNodeById,
  getNodeAbsolutePositionWithLayout,
  getThemeFromAncestorFrames,
} from "@/utils/nodeUtils";
import { findDescendantLocalPosition, prepareInstanceNode } from "@/utils/instanceUtils";
import { findDescendantByPath, findDescendantPositionByPath } from "@/utils/instancePathUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { createPixiSync } from "./pixiSync";
import { setupPixiViewport } from "./pixiViewport";
import { setupPixiInteraction } from "./interaction";
import { createSelectionOverlay } from "./SelectionOverlay";
import { createOverlayRenderer } from "./OverlayRenderer";

function isDescendantInsideAutoLayout(
  children: import("@/types/scene").SceneNode[],
  descendantId: string,
  descendantPath?: string,
): boolean {
  if (descendantPath) {
    const segments = descendantPath.split("/").filter((s) => s.length > 0);
    let currentChildren = children;
    let parent: import("@/types/scene").SceneNode | null = null;
    for (const segment of segments) {
      const found = currentChildren.find((child) => child.id === segment);
      if (!found) return false;
      if (found.id === descendantId) {
        return !!(parent?.type === "frame" && parent.layout?.autoLayout);
      }
      parent = found;
      if (found.type === "frame" || found.type === "group") {
        currentChildren = found.children;
      } else {
        currentChildren = [];
      }
    }
    return false;
  }

  const walk = (
    nodes: import("@/types/scene").SceneNode[],
    parent: import("@/types/scene").SceneNode | null,
  ): boolean => {
    for (const node of nodes) {
      if (node.id === descendantId) {
        return !!(parent?.type === "frame" && parent.layout?.autoLayout);
      }
      if (node.type === "frame" || node.type === "group") {
        if (walk(node.children, node)) return true;
      }
    }
    return false;
  };

  return walk(children, null);
}

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
  const nodesById = useSceneStore((state) => state.nodesById);
  const parentById = useSceneStore((state) => state.parentById);
  const pageBackground = useSceneStore((state) => state.pageBackground);
  const activeTheme = useThemeStore((state) => state.activeTheme);
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
  const { clearSelection, editingNodeId, editingMode, instanceContext, clearInstanceContext } =
    useSelectionStore();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const { undo, redo, saveHistory, startBatch, endBatch } = useHistoryStore();
  const { activeTool, cancelDrawing, toggleTool } = useDrawModeStore();
  const setPixiRefs = useCanvasRefStore((s) => s.setPixiRefs);

  // Selection data for inline editors
  const editingNode = editingNodeId
    ? useSceneStore.getState().nodesById[editingNodeId]
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
    ? getEditingPosition(editingNodeId)
    : null;
  const editingTextTheme = useMemo(() => {
    if (!editingNodeId || editingMode !== "text") return null;
    return getThemeFromAncestorFrames(
      parentById,
      nodesById,
      editingNodeId,
      activeTheme,
    );
  }, [editingNodeId, editingMode, parentById, nodesById, activeTheme]);
  const editingTextIsInsideAutoLayout = useMemo(() => {
    if (editingMode !== "text" || !editingNodeId) return false;
    return findParentFrame(nodes, editingNodeId).isInsideAutoLayout;
  }, [editingMode, editingNodeId, nodes]);

  // Descendant text editing support
  const editingDescendantTextNode = useMemo(() => {
    if (editingMode !== "text" || !instanceContext) return null;
    const allNodes = useSceneStore.getState().getNodes();
    const instance = findNodeById(allNodes, instanceContext.instanceId);
    if (!instance || instance.type !== "ref") return null;
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const prepared = prepareInstanceNode(instance as RefNode, allNodes, calculateLayoutForFrame);
    if (!prepared) return null;
    const descendant = instanceContext.descendantPath
      ? findDescendantByPath(prepared.layoutChildren, instanceContext.descendantPath)
      : findNodeById(prepared.layoutChildren, instanceContext.descendantId);
    if (!descendant || descendant.type !== "text") return null;
    return descendant as TextNode;
  }, [editingMode, instanceContext, nodes]);

  const editingDescendantTextPosition = useMemo(() => {
    if (!editingDescendantTextNode || !instanceContext) return null;
    const allNodes = useSceneStore.getState().getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const instanceAbsPos = getNodeAbsolutePositionWithLayout(allNodes, instanceContext.instanceId, calculateLayoutForFrame);
    if (!instanceAbsPos) return null;
    const instance = findNodeById(allNodes, instanceContext.instanceId);
    if (!instance || instance.type !== "ref") return null;
    const prepared = prepareInstanceNode(instance as RefNode, allNodes, calculateLayoutForFrame);
    if (!prepared) return null;
    const localPos = instanceContext.descendantPath
      ? findDescendantPositionByPath(
          prepared.layoutChildren,
          instanceContext.descendantPath,
        )
      : findDescendantLocalPosition(
          prepared.layoutChildren,
          instanceContext.descendantId,
        );
    if (!localPos) return null;
    return { x: instanceAbsPos.x + localPos.x, y: instanceAbsPos.y + localPos.y };
  }, [editingDescendantTextNode, instanceContext, nodes]);

  const editingDescendantTextTheme = useMemo(() => {
    if (!editingDescendantTextNode || !instanceContext) return null;
    const instanceTheme = getThemeFromAncestorFrames(
      parentById,
      nodesById,
      instanceContext.instanceId,
      activeTheme,
    );
    const allNodes = useSceneStore.getState().getNodes();
    const instance = findNodeById(allNodes, instanceContext.instanceId);
    if (!instance || instance.type !== "ref") return instanceTheme;
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const prepared = prepareInstanceNode(instance as RefNode, allNodes, calculateLayoutForFrame);
    if (!prepared) return instanceTheme;
    const baseTheme = prepared.component.themeOverride ?? instanceTheme;
    return (
      findEffectiveThemeInTree(
        prepared.layoutChildren,
        instanceContext.descendantId,
        baseTheme,
      ) ?? baseTheme
    );
  }, [
    editingDescendantTextNode,
    instanceContext,
    parentById,
    nodesById,
    activeTheme,
    nodes,
  ]);
  const editingDescendantIsInsideAutoLayout = useMemo(() => {
    if (editingMode !== "text" || !instanceContext) return false;
    const allNodes = useSceneStore.getState().getNodes();
    const instance = findNodeById(allNodes, instanceContext.instanceId);
    if (!instance || instance.type !== "ref") return false;
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const prepared = prepareInstanceNode(
      instance as RefNode,
      allNodes,
      calculateLayoutForFrame,
    );
    if (!prepared) return false;
    return isDescendantInsideAutoLayout(
      prepared.layoutChildren,
      instanceContext.descendantId,
      instanceContext.descendantPath,
    );
  }, [editingMode, instanceContext, nodes]);

  const handleDescendantTextUpdate = useMemo(() => {
    if (!instanceContext) return undefined;
    const { instanceId, descendantId, descendantPath } = instanceContext;
    return (text: string) => {
      useSceneStore.getState().updateDescendantTextWithoutHistory(
        instanceId,
        descendantId,
        text,
        descendantPath,
      );
    };
  }, [instanceContext]);

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
    clearInstanceContext,
    copyNodes,
  });

  // File drop
  useCanvasFileDrop({
    containerRef,
    addNode,
    onDocumentDrop: handleDocumentDrop,
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
      <ZoomIndicator
        scale={scale}
        onFitToContent={() =>
          fitToContent(nodes, dimensions.width, dimensions.height)
        }
      />
      <FpsDisplay fps={fps} />
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
        />
      )}
      {/* Inline text editor for instance descendant text */}
      {editingDescendantTextNode && editingDescendantTextPosition && editingMode === "text" && (
        <InlineTextEditor
          node={editingDescendantTextNode}
          absoluteX={editingDescendantTextPosition.x}
          absoluteY={editingDescendantTextPosition.y}
          effectiveTheme={editingDescendantTextTheme ?? undefined}
          onUpdateText={handleDescendantTextUpdate}
          isInsideAutoLayoutParent={editingDescendantIsInsideAutoLayout}
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
    </div>
  );
}
