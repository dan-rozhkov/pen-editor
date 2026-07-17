import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Application, Container } from "pixi.js";
import { InlineNameEditor} from "@/components/InlineNameEditor";
import { InlineTextEditor } from "@/components/InlineTextEditor";
import { InlineEmbedEditor } from "@/components/InlineEmbedEditor";
import { EmbedActionBar } from "@/components/canvas/EmbedActionBar";
import { EmbedAgentButton } from "@/components/canvas/EmbedAgentButton";
import { EmbedSelectionFrame } from "@/components/canvas/EmbedSelectionFrame";
import { EmbedLayer } from "@/components/canvas/EmbedLayer";
import { CommentLayer } from "@/components/comments/CommentLayer";
import { FrameAgentButton } from "@/components/canvas/FrameAgentButton";
import { Layers3DOverlay } from "@/components/canvas/Layers3DOverlay";
import { useLayers3DStore } from "@/store/layers3dStore";
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
import type { EditingMode, InstanceContext } from "@/store/selectionStore";
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
import { perfStats } from "./perfStats";

/**
 * Node-scoped derived state for selection/editing overlays.
 *
 * Extracted from `PixiCanvas` so each piece of derived state can subscribe
 * to `sceneStore` narrowly — keyed on the specific node id(s) it needs —
 * instead of the component subscribing to the entire `nodesById`/`parentById`
 * maps (which would re-render on every scene mutation, including every drag
 * frame).
 *
 * Exported (alongside the `PixiCanvas` component) only so its test can
 * exercise it via `renderHook` instead of mounting the full component, which
 * would require a real WebGL context.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePixiCanvasState({
  editingNodeId,
  editingMode,
  instanceContext,
  selectedIds,
}: {
  editingNodeId: string | null;
  editingMode: EditingMode;
  instanceContext: InstanceContext | null;
  selectedIds: string[];
}) {
  // Resolve instance descendant if editing within a component instance.
  // Reads the store imperatively (getState()) — recomputes only when
  // editingNodeId/instanceContext change, not on unrelated mutations.
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

  // Node-scoped: identity changes only when THIS node changes.
  const editingNodeFromStore = useSceneStore((s) =>
    editingNodeId ? (s.nodesById[editingNodeId] ?? null) : null,
  );
  const editingNode = editingNodeId
    ? (resolvedDescendant?.node ?? editingNodeFromStore)
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

  // Reactive to the ancestor chain: while editing a node inside an
  // auto-layout frame, a sibling resize can reflow the edited node to a new
  // absolute position WITHOUT touching the edited node's own record (its
  // x/y are computed by Yoga, not stored). A non-reactive read here would
  // leave the inline editor overlay pinned at a stale position once the
  // component stops re-rendering on every unrelated mutation. Select x and
  // y as two primitive selectors (not one object-returning selector) so
  // zustand's default Object.is equality still bails out per-axis without
  // needing useShallow.
  const editingX = useSceneStore((s) => {
    if (!editingNodeId) return null;
    if (resolvedDescendant) return resolvedDescendant.absX;
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    return (
      getNodeAbsolutePositionWithLayout(s.getNodes(), editingNodeId, calculateLayoutForFrame)
        ?.x ?? null
    );
  });
  const editingY = useSceneStore((s) => {
    if (!editingNodeId) return null;
    if (resolvedDescendant) return resolvedDescendant.absY;
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    return (
      getNodeAbsolutePositionWithLayout(s.getNodes(), editingNodeId, calculateLayoutForFrame)
        ?.y ?? null
    );
  });

  const editingPosition =
    editingNodeId && editingX != null && editingY != null
      ? { x: editingX, y: editingY }
      : null;

  // Theme lookup returns a primitive ('light' | 'dark'), so subscribing with
  // a selector that reads the ancestor chain is safe without useShallow —
  // zustand's default equality check (Object.is) bails out unless the
  // resolved theme itself actually changes.
  const editingTextTheme = useSceneStore((s) => {
    if (!editingNodeId || editingMode !== "text") return null;
    const themeNodeId = resolvedDescendant
      ? instanceContext!.instanceId
      : editingNodeId;
    return getThemeFromAncestorFrames(s.parentById, s.nodesById, themeNodeId, 'light');
  });

  // Already imperative (getState()) — recomputes only on
  // editingMode/editingNodeId/resolvedDescendant changes, not on unrelated
  // scene mutations.
  const editingTextIsInsideAutoLayout = useMemo(() => {
    if (editingMode !== "text" || !editingNodeId) return false;
    if (resolvedDescendant) return false;
    const nodes = useSceneStore.getState().getNodes();
    return findParentFrame(nodes, editingNodeId).isInsideAutoLayout;
  }, [editingMode, editingNodeId, resolvedDescendant]);

  // Node-scoped: a single subscription serves both the embed and frame
  // derivations below — its identity changes only when the selected node
  // itself changes, not on unrelated mutations.
  const singleSelectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const singleSelectedNode = useSceneStore((s) =>
    singleSelectedId ? (s.nodesById[singleSelectedId] ?? null) : null,
  );

  const selectedEmbedNode =
    singleSelectedNode?.type === "embed" ? (singleSelectedNode as EmbedNode) : null;

  const selectedEmbedPosition = useMemo(() => {
    if (!selectedEmbedNode) return null;
    return getEditingPosition(selectedEmbedNode.id);
  }, [selectedEmbedNode, getEditingPosition]);

  const selectedFrameNode =
    singleSelectedNode?.type === "frame" || singleSelectedNode?.type === "ref"
      ? (singleSelectedNode as FrameNode | RefNode)
      : null;

  const selectedFramePosition = useMemo(() => {
    if (!selectedFrameNode) return null;
    return getEditingPosition(selectedFrameNode.id);
  }, [selectedFrameNode, getEditingPosition]);

  return {
    resolvedDescendant,
    editingNode,
    editingPosition,
    editingTextTheme,
    editingTextIsInsideAutoLayout,
    selectedEmbedNode,
    selectedEmbedPosition,
    selectedFrameNode,
    selectedFramePosition,
  };
}

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
  const is3DActive = useLayers3DStore((s) => s.active);
  const exit3D = useLayers3DStore((s) => s.exit);

  // Selection data for inline editors
  const instanceContext = useSelectionStore((s) => s.instanceContext);

  const {
    editingNode,
    editingPosition,
    editingTextTheme,
    editingTextIsInsideAutoLayout,
    selectedEmbedNode,
    selectedEmbedPosition,
    selectedFrameNode,
    selectedFramePosition,
  } = usePixiCanvasState({ editingNodeId, editingMode, instanceContext, selectedIds });

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
          sceneRoot,
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

        if (import.meta.env.DEV) {
          (window as unknown as { __perfStats: typeof perfStats }).__perfStats = perfStats;
        }

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

  // Esc exits the 3D layer view. Only active while the 3D overlay is
  // showing, so it never interferes with the normal canvas Esc behavior
  // (useCanvasKeyboardShortcuts does not itself handle Escape).
  useEffect(() => {
    if (!is3DActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit3D();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [is3DActive, exit3D]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
    {/* Pixi host (containerRef) + its DOM overlays are hidden via
        `visibility` (not unmounted) while the 3D layer view is active, so
        the Pixi Application, WebGL context and scene graph stay alive
        underneath and can be restored instantly on exit. */}
    <div
      ref={containerRef}
      data-canvas
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        cursor: isPanning ? "grab" : activeTool ? "crosshair" : "default",
        // Play/Present is always dark regardless of the editor's light/dark
        // theme — a plain CSS swap (not a sceneStore.pageBackground mutation)
        // so scene data stays untouched; the transition avoids a flash on
        // entering/exiting Play.
        background:
          editorMode === "present" ? "var(--color-present-background)" : pageBackground,
        transition: "background 250ms ease",
        position: "relative",
        visibility: is3DActive ? "hidden" : "visible",
      }}
    >
      {/* Code layers rendered as live DOM above the Pixi canvas */}
      <EmbedLayer />
      {/* Canvas comment pins + threads (cmt-01), above embeds (z-10) and the
          embed selection frame (z-11) at z-12. */}
      <CommentLayer />
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
      {/* Canvas loading overlay — opaque to hide content until rendered.
          Unreachable in present mode today (isCanvasLoading only spans
          initial load, before Play can be entered), but mirrors the same
          present-mode background swap as the canvas host above (line ~377)
          for defense-in-depth. */}
      {isCanvasLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{
            background:
              editorMode === "present" ? "var(--color-present-background)" : pageBackground,
          }}
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
    {/* The 3D overlay sits above the (possibly hidden) Pixi canvas. Its
        toggle lives at the end of the drawing toolbar. */}
    <Layers3DOverlay />
    </div>
  );
}
