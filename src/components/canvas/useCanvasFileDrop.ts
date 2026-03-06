import { useEffect, useCallback } from "react";
import type { RefObject } from "react";
import type { HistorySnapshot, SceneNode } from "@/types/scene";
import { deserializeDocument, type DocumentData } from "@/utils/fileUtils";
import { parseSvgToNodes } from "@/utils/svgUtils";
import { useViewportStore } from "@/store/viewportStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import {
  applyImageImportPlans,
  createImageImportPlan,
  type ImageImportPlan,
} from "./imageImport";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;
const SVG_EXTENSION = /\.svg$/i;
const JSON_EXTENSION = /\.json$/i;

interface UseCanvasFileDropOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  addNode: (node: SceneNode) => void;
  addChildToFrame: (frameId: string, child: SceneNode) => void;
  onDocumentDrop: (
    document: DocumentData,
    viewport: { width: number; height: number },
  ) => void;
  saveHistory: (snapshot: HistorySnapshot) => void;
  startBatch: () => void;
  endBatch: () => void;
}

function clientToCanvas(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
): { canvasX: number; canvasY: number } {
  const { x, y, scale } = useViewportStore.getState();
  const canvasX = (clientX - containerRect.left - x) / scale;
  const canvasY = (clientY - containerRect.top - y) / scale;
  return { canvasX, canvasY };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || SVG_EXTENSION.test(file.name);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name);
}

function isJsonFile(file: File): boolean {
  return (
    file.type === "application/json" ||
    file.type === "text/json" ||
    JSON_EXTENSION.test(file.name)
  );
}

export function useCanvasFileDrop({
  containerRef,
  addNode,
  addChildToFrame,
  onDocumentDrop,
  saveHistory,
  startBatch,
  endBatch,
}: UseCanvasFileDropOptions) {
  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const { canvasX, canvasY } = clientToCanvas(e.clientX, e.clientY, rect);

      const droppedFiles = Array.from(files);
      const jsonFile = droppedFiles.find(isJsonFile);
      if (jsonFile) {
        try {
          const jsonText = await readFileAsText(jsonFile);
          const documentData = deserializeDocument(jsonText);
          if (!Array.isArray(documentData.nodes)) return;

          onDocumentDrop(documentData, {
            width: container.clientWidth,
            height: container.clientHeight,
          });
        } catch {
          // skip failed file
        }
        return;
      }

      let offset = 0;
      const imagePlans: ImageImportPlan[] = [];
      const selectionState = useSelectionStore.getState();
      const currentNodes = useSceneStore.getState().getNodes();

      for (const file of droppedFiles) {
        const dropX = canvasX + offset;
        const dropY = canvasY + offset;

        if (isSvgFile(file)) {
          try {
            const svgText = await readFileAsText(file);
            const result = parseSvgToNodes(svgText);
            if (result) {
              result.node.x = dropX;
              result.node.y = dropY;
              addNode(result.node);
              useSelectionStore.getState().select(result.node.id);
            }
          } catch {
            // skip failed file
          }
        } else if (isImageFile(file)) {
          try {
            const plan = await createImageImportPlan({
              blob: file,
              name: file.name,
              anchorWorld: { x: dropX, y: dropY },
              canvasSize: {
                width: container.clientWidth,
                height: container.clientHeight,
              },
              nodes: currentNodes,
              selectedIds: selectionState.selectedIds,
              enteredContainerId: selectionState.enteredContainerId,
              fallbackName: "Image",
            });
            imagePlans.push(plan);
          } catch {
            // skip failed file
          }
        }

        offset += 20;
      }

      applyImageImportPlans({
        plans: imagePlans,
        addNode,
        addChildToFrame,
        saveHistory,
        startBatch,
        endBatch,
      });
    },
    [
      containerRef,
      addChildToFrame,
      addNode,
      endBatch,
      onDocumentDrop,
      saveHistory,
      startBatch,
    ],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);

    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
    };
  }, [containerRef, handleDrop]);
}
