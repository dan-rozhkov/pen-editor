import { useEffect, useState, useCallback } from "react";
import type { RefObject } from "react";
import type { SceneNode, RectNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { parseSvgToNodes } from "@/utils/svgUtils";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;
const SVG_EXTENSION = /\.svg$/i;
const MAX_IMAGE_SIZE = 800;

interface UseCanvasFileDropOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  addNode: (node: SceneNode) => void;
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

function loadImageFromDataUrl(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function clampImageSize(w: number, h: number): { width: number; height: number } {
  if (w <= MAX_IMAGE_SIZE && h <= MAX_IMAGE_SIZE) return { width: w, height: h };
  const ratio = Math.min(MAX_IMAGE_SIZE / w, MAX_IMAGE_SIZE / h);
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

export function useCanvasFileDrop({ containerRef, addNode }: UseCanvasFileDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const { canvasX, canvasY } = clientToCanvas(e.clientX, e.clientY, rect);

      let offset = 0;

      for (const file of Array.from(files)) {
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
            const dataUrl = await readFileAsDataURL(file);
            const { width: natW, height: natH } = await loadImageFromDataUrl(dataUrl);
            const { width, height } = clampImageSize(natW, natH);

            const node: RectNode = {
              id: generateId(),
              type: "rect",
              name: file.name.replace(/\.[^.]+$/, ""),
              x: dropX,
              y: dropY,
              width,
              height,
              fill: "#ffffff",
              cornerRadius: 0,
              imageFill: { url: dataUrl, mode: "fill" },
            };
            addNode(node);
            useSelectionStore.getState().select(node.id);
          } catch {
            // skip failed file
          }
        }

        offset += 20;
      }
    },
    [containerRef, addNode],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dragEnterCount = 0;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragEnterCount++;
      setIsDragOver(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragEnterCount--;
      if (dragEnterCount <= 0) {
        dragEnterCount = 0;
        setIsDragOver(false);
      }
    };

    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("dragenter", handleDragEnter);
    container.addEventListener("dragleave", handleDragLeave);
    container.addEventListener("drop", handleDrop);

    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("dragenter", handleDragEnter);
      container.removeEventListener("dragleave", handleDragLeave);
      container.removeEventListener("drop", handleDrop);
    };
  }, [containerRef, handleDrop]);

  return { isDragOver };
}
