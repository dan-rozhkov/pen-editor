import type { FlatSceneNode } from "@/types/scene";

const FRAME_W = 1440;
const FRAME_H = 900;
const GRID_GAP = 200;
const COLS = 8;

/** Deterministic large synthetic document for perf work. Dev/test only. */
export function generatePerfScene(frameCount: number, childrenPerFrame: number): {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
} {
  const nodesById: Record<string, FlatSceneNode> = {};
  const parentById: Record<string, string | null> = {};
  const childrenById: Record<string, string[]> = {};
  const rootIds: string[] = [];

  for (let f = 0; f < frameCount; f++) {
    const frameId = `perf-frame-${f}`;
    rootIds.push(frameId);
    parentById[frameId] = null;
    const childIds: string[] = [];
    for (let c = 0; c < childrenPerFrame; c++) {
      const id = `perf-${f}-${c}`;
      const x = 24 + (c % 12) * 116;
      const y = 24 + Math.floor(c / 12) * 72;
      const kind = c % 4;
      const base = { id, x, y, width: 100, height: 56 };
      nodesById[id] =
        kind === 0
          ? ({ ...base, type: "rect", name: `Rect ${c}`, fill: "#d0d7ff", cornerRadius: 8 } as FlatSceneNode)
          : kind === 1
            ? ({ ...base, type: "ellipse", name: `Ellipse ${c}`, fill: "#ffd7d0" } as FlatSceneNode)
            : kind === 2
              ? ({ ...base, type: "text", name: `Text ${c}`, text: `Item ${f}-${c}`, fontSize: 14, fill: "#222222" } as FlatSceneNode)
              : ({ ...base, type: "rect", name: `Stroke ${c}`, fill: "#ffffff", stroke: "#334455", strokeWidth: 1 } as FlatSceneNode);
      parentById[id] = frameId;
      childrenById[id] = [];
      childIds.push(id);
    }
    nodesById[frameId] = {
      id: frameId,
      type: "frame",
      name: `Perf frame ${f}`,
      x: (f % COLS) * (FRAME_W + GRID_GAP),
      y: Math.floor(f / COLS) * (FRAME_H + GRID_GAP),
      width: FRAME_W,
      height: FRAME_H,
      fill: "#ffffff",
    } as FlatSceneNode;
    childrenById[frameId] = childIds;
  }
  return { nodesById, parentById, childrenById, rootIds };
}
