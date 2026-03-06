import type { HistorySnapshot, RectNode, SceneNode } from "@/types/scene";
import { generateId, isContainerNode } from "@/types/scene";
import { useLayoutStore } from "@/store/layoutStore";
import { createSnapshot, useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import {
  findNodeById,
  getNodeAbsolutePositionWithLayout,
  getNodeEffectiveSize,
} from "@/utils/nodeUtils";

const ROOT_VIEWPORT_BUDGET_RATIO = 0.9;
const CONTAINER_MARGIN = 32;

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface ImageImportParams {
  blob: Blob;
  name?: string;
  anchorWorld: Point;
  canvasSize: Size;
  nodes: SceneNode[];
  selectedIds: string[];
  enteredContainerId: string | null;
  fallbackName: string;
}

export interface ImageImportPlan {
  parentId: string | null;
  node: RectNode;
}

interface ApplyImageImportPlansParams {
  plans: ImageImportPlan[];
  addNode: (node: SceneNode) => void;
  addChildToFrame: (frameId: string, child: SceneNode) => void;
  saveHistory: (snapshot: HistorySnapshot) => void;
  startBatch: () => void;
  endBatch: () => void;
}

function readBlobAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function loadImageSize(url: string): Promise<Size> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

function clampSizeToBudget(size: Size, budget: Size): Size {
  const ratio = Math.min(1, budget.width / size.width, budget.height / size.height);
  return {
    width: Math.max(1, Math.round(size.width * ratio)),
    height: Math.max(1, Math.round(size.height * ratio)),
  };
}

function getViewportBudget(canvasSize: Size): Size {
  const { scale } = useViewportStore.getState();
  return {
    width: Math.max(1, (canvasSize.width / scale) * ROOT_VIEWPORT_BUDGET_RATIO),
    height: Math.max(1, (canvasSize.height / scale) * ROOT_VIEWPORT_BUDGET_RATIO),
  };
}

function resolveTargetContainer(
  nodes: SceneNode[],
  selectedIds: string[],
  enteredContainerId: string | null,
): string | null {
  if (enteredContainerId) {
    const enteredNode = findNodeById(nodes, enteredContainerId);
    if (enteredNode && isContainerNode(enteredNode)) {
      return enteredNode.id;
    }
  }

  if (selectedIds.length === 1) {
    const selectedNode = findNodeById(nodes, selectedIds[0]);
    if (selectedNode && isContainerNode(selectedNode)) {
      return selectedNode.id;
    }
  }

  return null;
}

function resolvePlacement(
  nodes: SceneNode[],
  selectedIds: string[],
  enteredContainerId: string | null,
  anchorWorld: Point,
  canvasSize: Size,
): { parentId: string | null; center: Point; budget: Size } {
  const viewportBudget = getViewportBudget(canvasSize);
  const parentId = resolveTargetContainer(nodes, selectedIds, enteredContainerId);

  if (!parentId) {
    return {
      parentId: null,
      center: anchorWorld,
      budget: viewportBudget,
    };
  }

  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const absolutePosition = getNodeAbsolutePositionWithLayout(
    nodes,
    parentId,
    calculateLayoutForFrame,
  );
  const effectiveSize = getNodeEffectiveSize(nodes, parentId, calculateLayoutForFrame);

  if (!absolutePosition || !effectiveSize) {
    return {
      parentId: null,
      center: anchorWorld,
      budget: viewportBudget,
    };
  }

  return {
    parentId,
    center: {
      x: anchorWorld.x - absolutePosition.x,
      y: anchorWorld.y - absolutePosition.y,
    },
    budget: {
      width: Math.min(
        viewportBudget.width,
        Math.max(1, effectiveSize.width - CONTAINER_MARGIN),
      ),
      height: Math.min(
        viewportBudget.height,
        Math.max(1, effectiveSize.height - CONTAINER_MARGIN),
      ),
    },
  };
}

function getImportName(name: string | undefined, fallbackName: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return fallbackName;
  return trimmed.replace(/\.[^.]+$/, "") || fallbackName;
}

function getLastNodeId(nodeIds: string[]): string | null {
  if (nodeIds.length === 0) return null;
  return nodeIds[nodeIds.length - 1];
}

export async function createImageImportPlan({
  blob,
  name,
  anchorWorld,
  canvasSize,
  nodes,
  selectedIds,
  enteredContainerId,
  fallbackName,
}: ImageImportParams): Promise<ImageImportPlan> {
  const dataUrl = await readBlobAsDataURL(blob);
  const naturalSize = await loadImageSize(dataUrl);
  const placement = resolvePlacement(
    nodes,
    selectedIds,
    enteredContainerId,
    anchorWorld,
    canvasSize,
  );
  const scaledSize = clampSizeToBudget(naturalSize, placement.budget);

  return {
    parentId: placement.parentId,
    node: {
      id: generateId(),
      type: "rect",
      name: getImportName(name, fallbackName),
      x: Math.round(placement.center.x - scaledSize.width / 2),
      y: Math.round(placement.center.y - scaledSize.height / 2),
      width: scaledSize.width,
      height: scaledSize.height,
      fill: "#ffffff",
      cornerRadius: 0,
      imageFill: { url: dataUrl, mode: "fill" },
    },
  };
}

export function setImportedSelection(nodeIds: string[]): void {
  useSelectionStore.setState({
    selectedIds: nodeIds,
    editingNodeId: null,
    editingMode: null,
    instanceContext: null,
    selectedDescendantIds: [],
    lastSelectedId: getLastNodeId(nodeIds),
  });
}

export function applyImageImportPlans({
  plans,
  addNode,
  addChildToFrame,
  saveHistory,
  startBatch,
  endBatch,
}: ApplyImageImportPlansParams): void {
  if (plans.length === 0) return;

  saveHistory(createSnapshot(useSceneStore.getState()));
  startBatch();
  try {
    for (const { parentId, node } of plans) {
      if (parentId) {
        addChildToFrame(parentId, node);
      } else {
        addNode(node);
      }
    }
  } finally {
    endBatch();
  }

  setImportedSelection(plans.map(({ node }) => node.id));
}
