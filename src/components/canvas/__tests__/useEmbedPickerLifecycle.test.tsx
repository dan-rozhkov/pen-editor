import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useEmbedPickerLifecycle } from "../useEmbedPickerLifecycle";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import type { EmbedNode, FlatSceneNode } from "@/types/scene";

function Harness() {
  useEmbedPickerLifecycle();
  return null;
}

function seedEmbed(id: string, htmlContent = "<div>hi</div>"): void {
  useSceneStore.setState({
    nodesById: {
      ...useSceneStore.getState().nodesById,
      [id]: {
        id,
        type: "embed",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        htmlContent,
      } as unknown as FlatSceneNode,
    },
    parentById: { ...useSceneStore.getState().parentById, [id]: null },
    rootIds: [...useSceneStore.getState().rootIds, id],
  } as never);
}

function selectionFor(embedId: string) {
  return {
    embedId,
    path: "div:nth-of-type(1)",
    tagName: "div",
    classes: [],
    textPreview: "hi",
    outerHtml: "<div>hi</div>",
  };
}

describe("useEmbedPickerLifecycle", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => cleanup());

  it("clears the selection once its embed is no longer the sole selected node", () => {
    seedEmbed("e1");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    render(<Harness />);
    expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");

    act(() => useSelectionStore.setState({ selectedIds: [] }));
    expect(useEmbedPickerStore.getState().selection).toBeNull();
  });

  it("clears the selection when selecting a different node", () => {
    seedEmbed("e1");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    render(<Harness />);

    act(() => useSelectionStore.setState({ selectedIds: ["other"] }));
    expect(useEmbedPickerStore.getState().selection).toBeNull();
  });

  it("clears the selection when the embed gains company in a multi-select", () => {
    seedEmbed("e1");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    render(<Harness />);

    act(() => useSelectionStore.setState({ selectedIds: ["e1", "other"] }));
    expect(useEmbedPickerStore.getState().selection).toBeNull();
  });

  it("keeps the selection when picking mode is exited but the embed stays selected", () => {
    seedEmbed("e1");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    render(<Harness />);

    // Toolbar toggle / Escape exits picking mode but leaves the embed selected.
    act(() => useEmbedPickerStore.getState().stopPicking());
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
    expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");
  });

  it("clears the selection when the owning embed's htmlContent changes after the pick", () => {
    seedEmbed("e1", "<div>before</div>");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"), "<div>before</div>");
    render(<Harness />);
    expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");

    act(() => {
      const node = useSceneStore.getState().nodesById.e1 as EmbedNode;
      useSceneStore.setState({
        nodesById: {
          ...useSceneStore.getState().nodesById,
          e1: { ...node, htmlContent: "<div>after edit_embed_html</div>" },
        },
      } as never);
    });

    expect(useEmbedPickerStore.getState().selection).toBeNull();
  });

  it("does not clear the selection on unrelated scene mutations when no html snapshot was captured", () => {
    seedEmbed("e1", "<div>before</div>");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    // No htmlAtPick passed — back-compat path some callers still use.
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    render(<Harness />);

    act(() => {
      const node = useSceneStore.getState().nodesById.e1 as EmbedNode;
      useSceneStore.setState({
        nodesById: {
          ...useSceneStore.getState().nodesById,
          e1: { ...node, htmlContent: "<div>after</div>" },
        },
      } as never);
    });

    expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");
  });

  it("clears the selection when the embed node is deleted", () => {
    seedEmbed("e1");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    render(<Harness />);

    act(() => {
      useSceneStore.setState({ nodesById: {}, parentById: {}, childrenById: {}, rootIds: [] });
    });

    expect(useEmbedPickerStore.getState().selection).toBeNull();
  });
});
