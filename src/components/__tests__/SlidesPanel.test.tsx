import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SlidesPanel } from "../SlidesPanel";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

/**
 * SlidesPanel lists top-level frames (rootIds order) as one-per-row preview
 * cards. Like ComponentsPanel, `useNodeThumbnails` returns an empty Map with
 * no Pixi refs in the unit env, so every slide renders the placeholder icon —
 * no WebGL/Pixi is initialised here.
 */

function frameNode(
  id: string,
  name: string,
  overrides: Partial<Record<string, unknown>> = {},
): FlatSceneNode {
  return {
    id,
    type: "frame",
    name,
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    ...overrides,
  } as unknown as FlatSceneNode;
}

/** Seed the flat scene store directly with the given root nodes. */
function seedNodes(nodes: FlatSceneNode[]): void {
  const nodesById: Record<string, FlatSceneNode> = {};
  const parentById: Record<string, string | null> = {};
  const childrenById: Record<string, string[]> = {};
  const rootIds: string[] = [];
  for (const n of nodes) {
    nodesById[n.id] = n;
    parentById[n.id] = null;
    childrenById[n.id] = [];
    rootIds.push(n.id);
  }
  useSceneStore.setState({
    nodesById,
    parentById,
    childrenById,
    rootIds,
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("<SlidesPanel />", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => cleanup());

  it("shows the empty state when there are no top-level frames", () => {
    render(<SlidesPanel />);
    expect(screen.getByText("No slides yet")).toBeTruthy();
  });

  it("lists each top-level frame by name, in rootIds order", () => {
    seedNodes([frameNode("f1", "Intro"), frameNode("f2", "Outro")]);
    render(<SlidesPanel />);

    expect(screen.queryByText("No slides yet")).toBeNull();
    const names = screen.getAllByTestId("slide-name").map((el) => el.textContent);
    expect(names).toEqual(["Intro", "Outro"]);
  });

  it("excludes non-frame root nodes", () => {
    seedNodes([
      frameNode("f1", "Intro"),
      { id: "r1", type: "rectangle", name: "Floating", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
    ]);
    useSceneStore.setState((s) => ({
      rootIds: [...s.rootIds, "r1"],
      parentById: { ...s.parentById, r1: null },
      nodesById: {
        ...s.nodesById,
        r1: { id: "r1", type: "rectangle", name: "Floating", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
      },
    }));
    render(<SlidesPanel />);

    expect(screen.getByText("Intro")).toBeTruthy();
    expect(screen.queryByText("Floating")).toBeNull();
  });

  it("excludes nested frames", () => {
    const nested = frameNode("nested", "Nested");
    seedNodes([frameNode("f1", "Intro")]);
    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, nested },
      parentById: { ...s.parentById, nested: "f1" },
      childrenById: { ...s.childrenById, f1: ["nested"] },
    }));
    render(<SlidesPanel />);

    expect(screen.getByText("Intro")).toBeTruthy();
    expect(screen.queryByText("Nested")).toBeNull();
  });

  it("selects the frame when a slide is clicked", () => {
    seedNodes([frameNode("f1", "Intro"), frameNode("f2", "Outro")]);
    render(<SlidesPanel />);

    fireEvent.click(screen.getByText("Outro"));

    expect(useSelectionStore.getState().selectedIds).toEqual(["f2"]);
  });

  it("highlights the currently selected slide", () => {
    seedNodes([frameNode("f1", "Intro"), frameNode("f2", "Outro")]);
    useSelectionStore.getState().select("f2");
    render(<SlidesPanel />);

    const outroCard = screen.getByTestId("slide-card-f2");
    const introCard = screen.getByTestId("slide-card-f1");
    expect(outroCard.className).toContain("ring");
    expect(introCard.className).not.toContain("ring");
  });
});
