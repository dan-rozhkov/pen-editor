import {
  buildTree,
  type SceneNode,
  type HistorySnapshot,
  type FrameNode,
  type FlatFrameNode,
  type RefNode,
} from "@/types/scene";
import { useClipboardStore } from "@/store/clipboardStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { cloneNodeWithNewId, deepCloneNode } from "@/utils/cloneNode";
import { createRefFromComponent } from "@/utils/componentUtils";
import { findNodeByPath } from "@/utils/instanceRuntime";
import { parseSvgToNodes } from "@/utils/svgUtils";
import { convertFigmaClipboardHtml, isFigmaClipboardHtml } from "@/lib/figmaPaste";
import { applyFigmaPasteNodes } from "./figmaPasteImport";
import {
  applyImageImportPlans,
  createImageImportPlan,
  readBlobAsDataURL,
  type ImageImportPlan,
  setImportedSelection,
} from "./imageImport";
import { toast } from "sonner";
import {
  INTERNAL_CLIPBOARD_PRIORITY_MS,
  getViewportCenter,
  isTypingTarget,
  resolveNodesToCopy,
  resolvePasteTargetContainerId,
} from "./keyboardShortcutUtils";

/**
 * Dependencies the clipboard actions need from the host hook. These mirror the
 * store-mutating callbacks supplied to {@link useCanvasKeyboardShortcuts}.
 */
export interface ClipboardActionDeps {
  dimensions: { width: number; height: number };
  addNode: (node: SceneNode) => void;
  addChildToFrame: (frameId: string, child: SceneNode) => void;
  deleteNode: (id: string) => void;
  saveHistory: (snapshot: HistorySnapshot) => void;
  startBatch: () => void;
  endBatch: () => void;
  clearSelection: () => void;
  copyNodes: (nodes: SceneNode[]) => void;
}

/**
 * Clipboard command handlers (copy / cut / paste) used by the canvas keyboard
 * shortcuts hook. Returned as plain functions closed over the supplied deps —
 * no React hooks are used here.
 */
export function createClipboardActions(deps: ClipboardActionDeps) {
  const {
    dimensions,
    addNode,
    addChildToFrame,
    deleteNode,
    saveHistory,
    startBatch,
    endBatch,
    clearSelection,
    copyNodes,
  } = deps;

  const pasteInternalNodes = (sourceNodes: SceneNode[]): void => {
    const selectionState = useSelectionStore.getState();

    // Paste into slot inside instance
    if (selectionState.instanceContext) {
      const { instanceId, descendantPath } = selectionState.instanceContext;
      const state = useSceneStore.getState();
      const instance = state.nodesById[instanceId] as RefNode | undefined;
      if (instance?.type === "ref") {
        // Use fresh state to build component tree (avoids stale closure)
        const compNode = state.nodesById[instance.componentId];
        if (compNode?.type === "frame" && (compNode as FlatFrameNode).reusable) {
          const componentTree = buildTree([instance.componentId], state.nodesById, state.childrenById)[0] as FrameNode;

          // Walk up the descendant path to find the nearest slot ancestor
          // (handles selecting both the slot itself and children inside a slot)
          const segments = descendantPath.split("/");
          let slotPath: string | null = null;
          let slotFrame: FrameNode | null = null;
          for (let i = segments.length; i >= 1; i--) {
            const candidatePath = segments.slice(0, i).join("/");
            const candidateNode = findNodeByPath(componentTree.children, candidatePath);
            if (candidateNode?.type === "frame" && (candidateNode as FrameNode).isSlot) {
              slotPath = candidatePath;
              slotFrame = candidateNode as FrameNode;
              break;
            }
          }

          if (slotPath && slotFrame) {
            const clonedNodes = sourceNodes.map((srcNode) => {
              // Reusable components → create a ref, don't flatten
              if (srcNode.type === "frame" && (srcNode as FrameNode).reusable) {
                return createRefFromComponent(srcNode.id, srcNode.width, srcNode.height) as SceneNode;
              }
              const cloned = deepCloneNode(srcNode);
              cloned.x = 0;
              cloned.y = 0;
              return cloned;
            });
            const currentOverride = instance.overrides?.[slotPath];
            const baseFrame = currentOverride?.kind === "replace"
              ? currentOverride.node as FrameNode
              : slotFrame;
            const replacement: FrameNode = {
              ...baseFrame,
              children: [...baseFrame.children, ...clonedNodes],
            };
            state.replaceInstanceNode(instanceId, slotPath, replacement);
            return;
          }
        }
      }
    }

    const clonedNodes = sourceNodes.map((node) => cloneNodeWithNewId(node));
    const nodes = useSceneStore.getState().getNodes();
    const targetContainerId = resolvePasteTargetContainerId(nodes, selectionState);

    saveHistory(createSnapshot(useSceneStore.getState()));
    startBatch();
    for (const clonedNode of clonedNodes) {
      if (targetContainerId) {
        clonedNode.x = 20;
        clonedNode.y = 20;
        addChildToFrame(targetContainerId, clonedNode);
      } else {
        addNode(clonedNode);
      }
    }
    endBatch();

    setImportedSelection(clonedNodes.map((node) => node.id));
  };

  const copySelection = (): void => {
    const nodes = useSceneStore.getState().getNodes();
    const selState = useSelectionStore.getState();
    const nodesToCopy = resolveNodesToCopy(selState, nodes);
    if (nodesToCopy.length > 0) {
      copyNodes(nodesToCopy);
    }
  };

  const pasteFromInternalClipboard = (): void => {
    const { copiedNodes: sourceNodes } = useClipboardStore.getState();
    if (sourceNodes.length > 0) {
      pasteInternalNodes(sourceNodes);
    }
  };

  const cutSelection = (): void => {
    const nodes = useSceneStore.getState().getNodes();
    const selState = useSelectionStore.getState();
    const nodesToCut = resolveNodesToCopy(selState, nodes);
    if (nodesToCut.length > 0) {
      copyNodes(nodesToCut);
      // Only delete for non-instance-descendant selections
      // (descendants inside instances are virtual and can't be deleted directly)
      if (!selState.instanceContext) {
        saveHistory(createSnapshot(useSceneStore.getState()));
        for (const id of selState.selectedIds) {
          deleteNode(id);
        }
        clearSelection();
      }
    }
  };

  const handlePaste = async (e: ClipboardEvent) => {
    const isTyping = isTypingTarget(e);
    if (isTyping) return;

    const clipboardState = useClipboardStore.getState();
    const syncText = e.clipboardData?.getData("text/plain")?.trim() ?? "";
    const htmlText = e.clipboardData?.getData("text/html") ?? "";
    const imageItems =
      e.clipboardData?.items == null
        ? []
        : Array.from(e.clipboardData.items).filter((item) =>
            item.type.startsWith("image/"),
          );
    const shouldPreferInternalClipboard =
      clipboardState.copiedNodes.length > 0 &&
      Date.now() - clipboardState.lastCopiedAt <= INTERNAL_CLIPBOARD_PRIORITY_MS;

    if (shouldPreferInternalClipboard) {
      e.preventDefault();
      pasteInternalNodes(clipboardState.copiedNodes);
      return;
    }

    // Figma clipboard (Ctrl+C in Figma) — decode to native nodes, 1:1
    if (isFigmaClipboardHtml(htmlText)) {
      e.preventDefault();
      try {
        const result = await convertFigmaClipboardHtml(htmlText);
        if (result && result.nodes.length > 0) {
          // Figma's cross-document clipboard references image fills by hash only —
          // the pixels are NOT in the buffer, so those fills come back as a gray
          // placeholder. When the clipboard ALSO carries a flattened `image/png`
          // raster (desktop Figma, "Copy as PNG") and the paste is a single node,
          // use that raster as the fill instead of the placeholder.
          let recoveredImage = false;
          if (
            result.unresolvedImageCount > 0 &&
            imageItems.length > 0 &&
            result.nodes.length === 1 &&
            result.nodes[0].fill === "#cccccc"
          ) {
            const file = imageItems[0]?.getAsFile();
            if (file) {
              try {
                const url = await readBlobAsDataURL(file);
                const node = result.nodes[0];
                node.imageFill = { url, mode: "fill" };
                delete node.fill;
                recoveredImage = true;
              } catch {
                // keep the gray placeholder if the raster can't be read
              }
            }
          }
          applyFigmaPasteNodes({
            nodes: result.nodes,
            viewportCenter: getViewportCenter(dimensions),
            addNode,
            saveHistory,
            startBatch,
            endBatch,
          });
          // No raster to recover from — tell the user why image fills are missing
          // instead of leaving a silent gray box.
          if (result.unresolvedImageCount > 0 && !recoveredImage) {
            toast(
              "Some image fills couldn't be transferred — Figma doesn't put image pixels in the clipboard on a normal copy. Use “Copy as PNG” in Figma, or paste the image directly.",
            );
          }
          if (result.warnings.length > 0) {
            console.warn("[figma-paste] imported with warnings:", result.warnings);
          }
        }
      } catch (error) {
        console.warn("[figma-paste] failed to decode Figma clipboard data:", error);
      }
      return;
    }

    if (imageItems.length > 0) {
      e.preventDefault();
      const viewportCenter = getViewportCenter(dimensions);
      const selectionState = useSelectionStore.getState();
      const currentNodes = useSceneStore.getState().getNodes();
      const imagePlans: ImageImportPlan[] = [];

      for (let i = 0; i < imageItems.length; i++) {
        const file = imageItems[i]?.getAsFile();
        if (!file) continue;
        try {
          const plan = await createImageImportPlan({
            blob: file,
            name: file.name,
            anchorWorld: {
              x: viewportCenter.x + i * 20,
              y: viewportCenter.y + i * 20,
            },
            canvasSize: {
              width: dimensions.width,
              height: dimensions.height,
            },
            nodes: currentNodes,
            selectedIds: selectionState.selectedIds,
            enteredContainerId: selectionState.enteredContainerId,
            fallbackName: imageItems.length > 1 ? `Pasted Image ${i + 1}` : "Pasted Image",
          });
          imagePlans.push(plan);
        } catch {
          // skip failed clipboard image
        }
      }

      applyImageImportPlans({
        plans: imagePlans,
        addNode,
        addChildToFrame,
        saveHistory,
        startBatch,
        endBatch,
      });
      return;
    }

    // 1. Try SVG from text/plain
    if (syncText && syncText.includes("<svg") && syncText.includes("</svg>")) {
      e.preventDefault();
      const result = parseSvgToNodes(syncText);
      if (result) {
        const viewportCenter = getViewportCenter(dimensions);
        result.node.x = viewportCenter.x - result.node.width / 2;
        result.node.y = viewportCenter.y - result.node.height / 2;

        addNode(result.node);
        useSelectionStore.getState().select(result.node.id);
        return;
      }
    }

    // 2. Internal clipboard (copiedNodes) — fallback when no external data matched
    if (clipboardState.copiedNodes.length > 0) {
      e.preventDefault();
      pasteInternalNodes(clipboardState.copiedNodes);
    }
  };

  return {
    pasteInternalNodes,
    copySelection,
    pasteFromInternalClipboard,
    cutSelection,
    handlePaste,
  };
}
