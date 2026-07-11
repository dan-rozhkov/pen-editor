import { useSceneStore } from "@/store/sceneStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeContainer } from "@/pixi/pixiSync";
import { getChildrenHost } from "@/pixi/syncHelpers";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import type { Container } from "pixi.js";

export interface Plane {
  nodeId: string;
  depthIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  imageUrl: string;
  cornerRadius: number;
}

export const MAX_PLANES = 300;

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

  for (let index = 0; index < ids.length; index++) {
    if (planes.length >= MAX_PLANES) {
      dropped = ids.length - index;
      break;
    }
    const id = ids[index];
    const node = nodesById[id];
    if (!node) continue;
    if ((node.width ?? 0) <= 0 || (node.height ?? 0) <= 0) continue;
    if (node.visible === false) continue;

    const container = getNodeContainer(id) as Container | null;
    if (!container) continue;

    // Frame/group containers nest their subtree inside a children-host
    // sub-container. Hide it while extracting so a parent plane bakes ONLY its
    // own visual content — otherwise every descendant is captured twice (once
    // inside the parent, once as its own plane). Nodes without a host (rects,
    // text, …) are unaffected. Restored in `finally`, even on extraction error.
    const childrenHost = getChildrenHost(container);
    const prevHostVisible = childrenHost ? childrenHost.visible : undefined;
    if (childrenHost) childrenHost.visible = false;

    let canvas;
    try {
      canvas = pixiRefs.app.renderer.extract.canvas(container) as unknown as {
        width: number;
        height: number;
        toBlob: (cb: (b: Blob | null) => void) => void;
      };
    } catch {
      continue; // extraction failed for this node — skip it, keep going
    } finally {
      if (childrenHost && prevHostVisible !== undefined) {
        childrenHost.visible = prevHostVisible;
      }
    }
    // A content-less container (frame/group with no own fill/stroke) extracts
    // as a 1×1 canvas once its children-host is hidden. Stretched to the node's
    // width/height it renders as a blurry nothing — skip it, and don't let it
    // consume a depthIndex or MAX_PLANES slot. Descendants are captured
    // independently and unaffected.
    if (canvas.width <= 1 && canvas.height <= 1) continue;

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
