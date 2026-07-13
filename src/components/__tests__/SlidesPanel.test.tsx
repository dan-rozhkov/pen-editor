import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { SlidesPanel } from "../SlidesPanel";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

const extractBase64 = vi.fn(async (_container: unknown) => "thumbnail");

vi.mock("@/utils/pixiUtils", () => ({
  findPixiChild: vi.fn((_root: unknown, id: string) => ({ id })),
}));

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
    vi.useRealTimers();
    extractBase64.mockClear();
    resetStores();
    useCanvasRefStore.setState({ pixiRefs: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useCanvasRefStore.setState({ pixiRefs: null });
  });

  it("shows the empty state when there are no top-level frames", () => {
    render(<SlidesPanel />);
    expect(screen.getByText("No slides yet")).toBeTruthy();
  });

  it("adds and selects a new 16:9 slide", () => {
    render(<SlidesPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Add slide" }));

    const { nodesById, rootIds } = useSceneStore.getState();
    const slide = nodesById[rootIds[0]];
    expect(slide).toBeDefined();
    expect(slide).toMatchObject({
      type: "frame",
      name: "Slide 1",
      width: 960,
      height: 540,
    });
    expect(useSelectionStore.getState().selectedIds).toEqual([slide?.id]);
  });

  it("lists each top-level frame by name, in rootIds order", () => {
    seedNodes([frameNode("f1", "Intro"), frameNode("f2", "Outro")]);
    render(<SlidesPanel />);

    expect(screen.queryByText("No slides yet")).toBeNull();
    const names = screen.getAllByTestId("slide-name").map((el) => el.textContent);
    expect(names).toEqual(["Intro", "Outro"]);
  });

  it("places the slide number inside the preview above the title", () => {
    seedNodes([frameNode("f1", "Intro")]);
    render(<SlidesPanel />);

    const card = screen.getByTestId("slide-card-f1");
    const number = screen.getByTestId("slide-number-f1");
    const title = screen.getByTestId("slide-name");
    const preview = number.parentElement;

    expect(number.textContent).toBe("1");
    expect(number.className).toContain("text-sm");
    expect(preview).toBe(card.querySelector("div"));
    expect((preview as HTMLElement).style.aspectRatio).toBe("16 / 9");
    expect(title.parentElement).toBe(card);
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

  it("does not regenerate thumbnails after its own state update", async () => {
    vi.useFakeTimers();
    seedNodes([frameNode("f1", "Intro"), frameNode("f2", "Outro")]);
    useCanvasRefStore.setState({
      pixiRefs: {
        app: { renderer: { extract: { base64: extractBase64 } } },
        sceneRoot: {},
      } as unknown as NonNullable<
        ReturnType<typeof useCanvasRefStore.getState>["pixiRefs"]
      >,
    });

    render(<SlidesPanel />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(extractBase64).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(extractBase64).toHaveBeenCalledTimes(2);
  });

  it("regenerates only the slide whose descendant changed", async () => {
    vi.useFakeTimers();
    seedNodes([frameNode("f1", "Intro"), frameNode("f2", "Outro")]);
    const child = {
      id: "child-1",
      type: "rectangle",
      name: "Card",
      x: 10,
      y: 10,
      width: 100,
      height: 80,
      fill: "#111111",
    } as unknown as FlatSceneNode;
    useSceneStore.setState((state) => ({
      nodesById: { ...state.nodesById, [child.id]: child },
      parentById: { ...state.parentById, [child.id]: "f1" },
      childrenById: { ...state.childrenById, f1: [child.id], [child.id]: [] },
      _cachedTree: null,
    }));
    useCanvasRefStore.setState({
      pixiRefs: {
        app: { renderer: { extract: { base64: extractBase64 } } },
        sceneRoot: {},
      } as unknown as NonNullable<
        ReturnType<typeof useCanvasRefStore.getState>["pixiRefs"]
      >,
    });

    render(<SlidesPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(extractBase64).toHaveBeenCalledTimes(2);

    act(() => {
      useSceneStore.setState((state) => ({
        nodesById: {
          ...state.nodesById,
          [child.id]: { ...state.nodesById[child.id], fill: "#ff0000" },
        },
        _cachedTree: null,
      }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const refreshedIds = extractBase64.mock.calls
      .slice(2)
      .map(([container]) => (container as { id: string }).id);
    expect(refreshedIds).toEqual(["f1"]);
  });
});
