import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ComponentsPanel } from "../ComponentsPanel";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

/**
 * ComponentsPanel lists reusable components and inserts an instance (RefNode)
 * into the scene when one is clicked.
 *
 * NOTE on the architecture: although the high-level docs describe components as
 * `embed` nodes with `isComponent:true`, the panel's actual data source is
 * `getAllComponentsFlat`, which selects scene nodes of `type === "frame"` with
 * `reusable === true`. The code is the source of truth, so we seed reusable
 * frames here.
 *
 * `useComponentThumbnails` returns an empty Map when there are no Pixi refs
 * (none in the unit env), so each component renders the placeholder icon — no
 * WebGL/Pixi is initialised.
 */

/** A reusable component frame as stored flat in the scene. */
function componentFrame(
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
    width: 120,
    height: 80,
    reusable: true,
    ...overrides,
  } as unknown as FlatSceneNode;
}

/** Seed the flat scene store directly with the given root nodes. */
function seedNodes(nodes: FlatSceneNode[]): void {
  const nodesById: Record<string, FlatSceneNode> = {};
  const parentById: Record<string, string | null> = {};
  const rootIds: string[] = [];
  for (const n of nodes) {
    nodesById[n.id] = n;
    parentById[n.id] = null;
    rootIds.push(n.id);
  }
  useSceneStore.setState({
    nodesById,
    parentById,
    childrenById: {},
    rootIds,
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("<ComponentsPanel />", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => cleanup());

  it("shows the empty state when there are no components", () => {
    render(<ComponentsPanel />);
    expect(screen.getByText("No components yet")).toBeTruthy();
  });

  it("treats a plain (non-reusable) frame as not a component", () => {
    seedNodes([
      { id: "plain", type: "frame", name: "Plain", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
    ]);
    render(<ComponentsPanel />);
    expect(screen.getByText("No components yet")).toBeTruthy();
  });

  it("lists each reusable component by name", () => {
    seedNodes([
      componentFrame("c1", "Button"),
      componentFrame("c2", "Card"),
    ]);
    render(<ComponentsPanel />);

    expect(screen.queryByText("No components yet")).toBeNull();
    expect(screen.getByText("Button")).toBeTruthy();
    expect(screen.getByText("Card")).toBeTruthy();
    // One button per component.
    expect(screen.getAllByRole("button").length).toBe(2);
  });

  it("falls back to 'Component' for an unnamed component", () => {
    seedNodes([componentFrame("c1", "")]);
    render(<ComponentsPanel />);
    expect(screen.getByText("Component")).toBeTruthy();
  });

  it("inserts an instance as a root ref node and selects it when no frame is selected", () => {
    seedNodes([componentFrame("c1", "Button", { width: 100, height: 40 })]);
    render(<ComponentsPanel />);

    fireEvent.click(screen.getByText("Button"));

    const state = useSceneStore.getState();
    const refs = Object.values(state.nodesById).filter((n) => n.type === "ref");
    expect(refs.length).toBe(1);

    const ref = refs[0] as unknown as { componentId: string; width: number; height: number; id: string };
    expect(ref.componentId).toBe("c1");
    expect(ref.width).toBe(100);
    expect(ref.height).toBe(40);

    // Inserted at root, not nested.
    expect(state.rootIds).toContain(ref.id);
    // And it becomes the current selection.
    expect(useSelectionStore.getState().selectedIds).toEqual([ref.id]);
  });

  it("inserts the instance as a child when a different frame is selected", () => {
    seedNodes([
      componentFrame("c1", "Button"),
      { id: "target", type: "frame", name: "Target", x: 0, y: 0, width: 300, height: 300 } as unknown as FlatSceneNode,
    ]);
    useSelectionStore.getState().select("target");

    render(<ComponentsPanel />);
    fireEvent.click(screen.getByText("Button"));

    const state = useSceneStore.getState();
    const refs = Object.values(state.nodesById).filter((n) => n.type === "ref");
    expect(refs.length).toBe(1);
    const refId = (refs[0] as unknown as { id: string }).id;

    // Child of the selected frame, with the child offset applied.
    expect(state.parentById[refId]).toBe("target");
    expect(state.childrenById["target"]).toContain(refId);
    const ref = state.nodesById[refId] as unknown as { x: number; y: number };
    expect(ref.x).toBe(10);
    expect(ref.y).toBe(10);
  });

  it("does not nest the instance inside the component frame itself when it is selected", () => {
    seedNodes([componentFrame("c1", "Button")]);
    useSelectionStore.getState().select("c1");

    render(<ComponentsPanel />);
    fireEvent.click(screen.getByText("Button"));

    const state = useSceneStore.getState();
    const refs = Object.values(state.nodesById).filter((n) => n.type === "ref");
    const refId = (refs[0] as unknown as { id: string }).id;
    // selectedFrame.id === component.id → falls through to addNode (root).
    expect(state.rootIds).toContain(refId);
    expect(state.parentById[refId]).toBeNull();
  });
});
