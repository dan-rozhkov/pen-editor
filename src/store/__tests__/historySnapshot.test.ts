import { describe, expect, it } from "vitest";
import { buildHistorySnapshot } from "../historySnapshot";
import type { FlatSceneNode } from "@/types/scene";

const node = { id: "n1", type: "rect", name: "R", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode;

const scene = {
  nodesById: { n1: node },
  parentById: { n1: null },
  childrenById: { n1: [] as string[] },
  rootIds: ["n1"],
};

const selection = {
  selectedIds: ["n1"],
  enteredContainerId: null,
  lastSelectedId: "n1",
};

describe("buildHistorySnapshot", () => {
  it("shallow-clones every collection (mutating the snapshot never mutates inputs)", () => {
    const snap = buildHistorySnapshot(scene, [], selection, []);
    expect(snap.nodesById).not.toBe(scene.nodesById);
    expect(snap.parentById).not.toBe(scene.parentById);
    expect(snap.childrenById).not.toBe(scene.childrenById);
    expect(snap.rootIds).not.toBe(scene.rootIds);
    expect(snap.selection.selectedIds).not.toBe(selection.selectedIds);
    expect(snap.nodesById).toEqual(scene.nodesById);
    expect(snap.selection).toEqual(selection);
  });

  it("always carries componentArtifactsById (empty object when absent)", () => {
    expect(buildHistorySnapshot(scene, [], selection, []).componentArtifactsById).toEqual({});
    const withArtifacts = buildHistorySnapshot(
      { ...scene, componentArtifactsById: { c1: { componentId: "c1" } as never } },
      [],
      selection,
      [],
    );
    expect(withArtifacts.componentArtifactsById).toEqual({ c1: { componentId: "c1" } });
  });

  it("clones the variables array", () => {
    const variables = [{ id: "v1" }] as never[];
    const snap = buildHistorySnapshot(scene, variables, selection, []);
    expect(snap.variables).not.toBe(variables);
    expect(snap.variables).toEqual(variables);
  });

  it("clones the guides array", () => {
    const guides = [{ id: "g1", orientation: "vertical" as const, position: 42 }];
    const snap = buildHistorySnapshot(scene, [], selection, guides);
    expect(snap.guides).not.toBe(guides);
    expect(snap.guides).toEqual(guides);
  });
});
