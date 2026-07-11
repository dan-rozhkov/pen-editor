import { useSceneStore } from "@/store/sceneStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeContainer } from "@/pixi/pixiSync";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import type { Container } from "pixi.js";

export interface Plane {
  nodeId: string;
  depthIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  imageUrl: string;
  opacity: number;
  cornerRadius: number;
}

export const MAX_PLANES = 300;
const MAX_EDGE = 2048;

function canvasToObjectUrl(canvas: {
  width: number;
  height: number;
  toBlob: (cb: (b: Blob | null) => void) => void;
}): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) =>
      resolve(blob ? URL.createObjectURL(blob) : null),
    );
  });
}

/** Pre-order (paint order): parent before children; children in child order. */
function paintOrder(frameId: string): string[] {
  const { childrenById } = useSceneStore.getState();
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const childId of childrenById[id] ?? []) walk(childId);
  };
  walk(frameId);
  return out;
}

export async function captureLayers(frameId: string): Promise<Plane[]> {
  const { nodesById, getNodes } = useSceneStore.getState();
  const { pixiRefs } = useCanvasRefStore.getState();
  const frame = nodesById[frameId];
  if (!pixiRefs || !frame) return [];

  const nodes = getNodes();
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const frameAbs = getNodeAbsolutePositionWithLayout(nodes, frameId, calc) ?? {
    x: frame.x,
    y: frame.y,
  };

  const ids = paintOrder(frameId);
  const planes: Plane[] = [];
  let dropped = 0;

  for (const id of ids) {
    if (planes.length >= MAX_PLANES) {
      dropped = ids.length - planes.length;
      break;
    }
    const node = nodesById[id];
    if (!node) continue;
    if ((node.width ?? 0) <= 0 || (node.height ?? 0) <= 0) continue;
    if (node.visible === false) continue;

    const container = getNodeContainer(id) as Container | null;
    if (!container) continue;

    let canvas;
    try {
      canvas = pixiRefs.app.renderer.extract.canvas(container) as unknown as {
        width: number;
        height: number;
        toBlob: (cb: (b: Blob | null) => void) => void;
      };
    } catch {
      continue; // extraction failed for this node — skip it, keep going
    }
    if (canvas.width > MAX_EDGE || canvas.height > MAX_EDGE) {
      // capped by resolution policy; still capture (browser downscales in <img>)
    }
    const imageUrl = await canvasToObjectUrl(canvas);
    if (!imageUrl) continue;

    const abs = getNodeAbsolutePositionWithLayout(nodes, id, calc) ?? {
      x: node.x,
      y: node.y,
    };
    planes.push({
      nodeId: id,
      depthIndex: planes.length,
      rect: {
        x: abs.x - frameAbs.x,
        y: abs.y - frameAbs.y,
        width: node.width ?? 0,
        height: node.height ?? 0,
      },
      imageUrl,
      opacity: node.opacity ?? 1,
      cornerRadius:
        "cornerRadius" in node && typeof node.cornerRadius === "number"
          ? node.cornerRadius
          : 0,
    });
  }

  if (dropped > 0) {
    console.warn(`captureLayers: dropped ${dropped} planes over MAX_PLANES`);
  }
  return planes;
}
