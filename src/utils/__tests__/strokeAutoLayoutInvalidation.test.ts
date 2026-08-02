import { describe, it, expect, beforeEach } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { resetStores } from "@/test/fixtures";

/**
 * Pin: mutating stroke GEOMETRY through the real store path (`updateNode`)
 * re-runs auto layout on the next `getNodes()` + `calculateLayoutForFrame`
 * read — no special wiring exists for stroke fields specifically.
 *
 * This exercises the real path end-to-end (fresh tree node each read), which
 * is what actually matters for the app: every call site re-derives the frame
 * from `getNodes()` before laying out, so it always sees a fresh object.
 *
 * It does NOT isolate `layoutStore`'s WeakMap identity-guard
 * (`nodesById !== layoutCacheNodesById`) as a unit: reusing the SAME stale
 * frame reference across a mutation doesn't observe the guard either way,
 * because `materializeLayoutRefs`/`getNodeChildren` read children off the
 * frame object's own (already-materialized) `.children` array when present,
 * not fresh off `nodesById` — so a stale frame's recompute-on-miss produces
 * the same output as a stale cache hit would have. Verified empirically:
 * mutating a fill_container sibling's stroke and re-calling
 * `calculateLayoutForFrame` with the ORIGINAL frame reference leaves the
 * other child's computed width unchanged (150), while re-deriving the frame
 * via a fresh `getNodes()` call after the same mutation picks it up (140).
 * If the guard is ever deleted, this file would not catch it; a unit test
 * against the guard would need a scenario where `materializeLayoutRefs`
 * reads live `nodesById` off a stale frame object (e.g. a `ref` node,
 * resolved via `resolveRefToTree(node, nodesById, ...)` on every call).
 */

function seedRow(): void {
  const row = {
    id: "row",
    type: "frame",
    name: "Row",
    x: 0,
    y: 0,
    width: 300,
    height: 100,
    layout: { autoLayout: true, flexDirection: "row", gap: 0 },
    sizing: { widthMode: "fixed", heightMode: "fixed" },
  } as unknown as FlatSceneNode;
  const child = {
    id: "a",
    type: "rect",
    x: 0,
    y: 0,
    width: 50,
    height: 40,
    sizing: { widthMode: "fixed", heightMode: "fixed" },
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { row, a: child },
    parentById: { row: null, a: "row" },
    childrenById: { row: ["a"] },
    rootIds: ["row"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

function childX(): number {
  const scene = useSceneStore.getState();
  const tree = scene.getNodes();
  const frame = tree.find((n) => n.id === "row");
  if (!frame || frame.type !== "frame") throw new Error("row frame missing");
  const laidOut = useLayoutStore
    .getState()
    .calculateLayoutForFrame(frame);
  const a = laidOut.find((n) => n.id === "a");
  if (!a) throw new Error("child missing from layout");
  return a.x;
}

describe("stroke mutation invalidates auto layout", () => {
  beforeEach(() => {
    resetStores();
    seedRow();
  });

  it("adding an inside stroke to the frame moves children on the next layout read", () => {
    expect(childX()).toBe(0);

    useSceneStore.getState().updateNode("row", {
      stroke: "#000",
      strokeWidth: 10,
      strokeAlign: "inside",
    });

    expect(childX()).toBe(10);
  });

  it("changing strokeAlign back to center restores the original layout", () => {
    useSceneStore.getState().updateNode("row", {
      stroke: "#000",
      strokeWidth: 10,
      strokeAlign: "inside",
    });
    expect(childX()).toBe(10);

    useSceneStore.getState().updateNode("row", { strokeAlign: "center" });
    expect(childX()).toBe(0);
  });
});
