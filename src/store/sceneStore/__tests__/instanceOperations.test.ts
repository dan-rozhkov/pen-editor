import { describe, it, expect, beforeEach } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { resetStores, seedScene } from "@/test/fixtures";

/**
 * Structure:
 *   comp (reusable frame) ── label (text child)
 *   inst (ref -> comp)
 * Plus the standard seedScene() tree (frame1/rect1/text1/rect2) so
 * detachInstance has another node to anchor a measurement to.
 */
function seedComponentAndInstance(): void {
  const comp = {
    id: "comp",
    type: "frame",
    name: "Comp",
    reusable: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  } as unknown as FlatSceneNode;

  const label = {
    id: "label",
    type: "text",
    text: "Click me",
    x: 0,
    y: 0,
    width: 80,
    height: 20,
  } as unknown as FlatSceneNode;

  const inst = {
    id: "inst",
    type: "ref",
    name: "Instance",
    x: 200,
    y: 0,
    width: 100,
    height: 100,
    componentId: "comp",
  } as unknown as FlatSceneNode;

  const state = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...state.nodesById, comp, label, inst },
    parentById: { ...state.parentById, comp: null, label: "comp", inst: null },
    childrenById: { ...state.childrenById, comp: ["label"] },
    rootIds: [...state.rootIds, "comp", "inst"],
    _cachedTree: null,
  });
}

function scene() {
  return useSceneStore.getState();
}

describe("detachInstance", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    seedComponentAndInstance();
  });

  it("replaces the ref instance with its resolved (detached) tree", () => {
    const resolvedId = scene().detachInstance("inst");
    expect(resolvedId).toBeTruthy();
    const s = scene();
    expect(s.nodesById["inst"]).toBeUndefined();
    expect(s.nodesById[resolvedId!]).toBeDefined();
    expect(s.rootIds).toContain(resolvedId);
    expect(s.rootIds).not.toContain("inst");
  });

  it("drops a pinned measurement anchored to the detached instance", () => {
    useMeasurementsStore.getState().addMeasurement("inst", "rect1");
    expect(useMeasurementsStore.getState().measurements).toHaveLength(1);

    const resolvedId = scene().detachInstance("inst");
    expect(resolvedId).toBeTruthy();
    expect(useMeasurementsStore.getState().measurements).toHaveLength(0);
  });

  it("returns null for a non-ref node without touching measurements", () => {
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");
    expect(scene().detachInstance("rect1")).toBeNull();
    expect(useMeasurementsStore.getState().measurements).toHaveLength(1);
  });
});
