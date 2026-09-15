import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useEmbedPickerLifecycle } from "../useEmbedPickerLifecycle";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useRenderModeStore } from "@/store/renderModeStore";
import { useEditorModeStore } from "@/store/editorModeStore";
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
    useRenderModeStore.setState({ renderMode: "normal" });
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    // resetStores() (src/test/fixtures.ts) does not clear activeEmbedId —
    // several tests below set it directly rather than through an action
    // that clears it as a side effect, so it would otherwise leak into
    // whichever test runs next.
    useSelectionStore.setState({ activeEmbedId: null });
  });

  afterEach(() => cleanup());

  describe("auto-start", () => {
    it("starts picking as soon as an embed becomes the sole selection", () => {
      seedEmbed("e1");
      render(<Harness />);
      expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();

      act(() => useSelectionStore.setState({ selectedIds: ["e1"] }));

      expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    });

    it("does not start when the embed is one of several selected nodes", () => {
      seedEmbed("e1");
      render(<Harness />);

      act(() => useSelectionStore.setState({ selectedIds: ["e1", "other"] }));

      expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
    });

    it("does not start while the inline HTML editor is already open on the embed", () => {
      seedEmbed("e1");
      render(<Harness />);

      act(() =>
        useSelectionStore.setState({
          selectedIds: ["e1"],
          editingNodeId: "e1",
          editingMode: "embed",
        }),
      );

      expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
    });

    it("does not start while the embed is the active (interactive) one", () => {
      seedEmbed("e1");
      render(<Harness />);

      act(() => useSelectionStore.setState({ selectedIds: ["e1"], activeEmbedId: "e1" }));

      expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
    });

    it("does not start outside an editable canvas mode", () => {
      seedEmbed("e1");
      useEditorModeStore.setState({ mode: "view" });
      render(<Harness />);

      act(() => useSelectionStore.setState({ selectedIds: ["e1"] }));

      expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
    });

    it("starts picking on an already-selected embed when the mode changes from view back to edit", () => {
      // Regression for exitToEdit(): unlike enterView/enterPresent (which
      // clear the selection as a side effect and so happen to re-fire
      // check() via selectionStore), exitToEdit() only flips editorModeStore
      // — an already-selected embed must still pick up picking once
      // canEditScene(mode) becomes true again, without any selection change.
      seedEmbed("e1");
      useEditorModeStore.setState({ mode: "view" });
      useSelectionStore.setState({ selectedIds: ["e1"] });
      render(<Harness />);
      expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();

      act(() => useEditorModeStore.getState().exitToEdit());

      expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    });

    it("never starts picking for a non-embed node", () => {
      useSceneStore.setState({
        nodesById: { r1: { id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode },
        parentById: { r1: null },
        rootIds: ["r1"],
      } as never);
      render(<Harness />);

      act(() => useSelectionStore.setState({ selectedIds: ["r1"] }));

      expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
    });

    it("does not re-invoke startPicking on every check() once already picking (no runaway loop)", () => {
      seedEmbed("e1");
      const calls: string[] = [];
      const originalStartPicking = useEmbedPickerStore.getState().startPicking;
      useEmbedPickerStore.setState({
        startPicking: (id: string) => {
          calls.push(id);
          originalStartPicking(id);
        },
      });

      render(<Harness />);
      act(() => useSelectionStore.setState({ selectedIds: ["e1"] }));
      expect(calls).toEqual(["e1"]);

      // An unrelated scene mutation re-runs check() while "e1" is still the
      // sole selection and still picking — must take the "already picking"
      // branch, not call startPicking again.
      act(() => {
        useSceneStore.setState({
          nodesById: { ...useSceneStore.getState().nodesById },
          _cachedTree: null,
        } as never);
      });
      expect(calls).toEqual(["e1"]);

      // Restore — this store is a module-level singleton shared with every
      // other test in the file.
      useEmbedPickerStore.setState({ startPicking: originalStartPicking });
    });
  });

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

  it("keeps the selection when picking mode is exited (inline edit opens) but the embed stays selected", () => {
    seedEmbed("e1");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    render(<Harness />);

    // Opening the inline HTML editor is the real-world way picking mode
    // turns off today (no more manual toggle) while the embed stays
    // selected — the picked element's context must survive it, so the agent
    // can still act on it.
    act(() => useSelectionStore.getState().startEditing("e1", "embed"));
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

  it("keeps the selection across a properties-panel edit noted via noteSelectionEdit, but still clears it on a foreign html change", () => {
    seedEmbed("e1", "<div>before</div>");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"), "<div>before</div>");
    render(<Harness />);

    const htmlB = "<div>edited from panel</div>";
    act(() => {
      useEmbedPickerStore.getState().noteSelectionEdit(htmlB);
      const node = useSceneStore.getState().nodesById.e1 as EmbedNode;
      useSceneStore.setState({
        nodesById: {
          ...useSceneStore.getState().nodesById,
          e1: { ...node, htmlContent: htmlB },
        },
      } as never);
    });
    expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");

    act(() => {
      const node = useSceneStore.getState().nodesById.e1 as EmbedNode;
      useSceneStore.setState({
        nodesById: {
          ...useSceneStore.getState().nodesById,
          e1: { ...node, htmlContent: "<div>edited by agent</div>" },
        },
      } as never);
    });
    expect(useEmbedPickerStore.getState().selection).toBeNull();
  });

  it("stops picking when the inline HTML editor opens on the picking embed", () => {
    seedEmbed("e1");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().startPicking("e1");
    render(<Harness />);
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");

    // The "Edit inline" button in the properties panel's EmbedContentSection
    // calls this — it sets editingMode/editingNodeId, not activeEmbedId.
    act(() => useSelectionStore.getState().startEditing("e1", "embed"));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
  });

  it("stops picking when activeEmbedId is set on the picking embed", () => {
    seedEmbed("e1");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().startPicking("e1");
    render(<Harness />);
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");

    // No UI affordance calls setActiveEmbed today, but the lifecycle check
    // still honors it if one is added back.
    act(() => useSelectionStore.getState().setActiveEmbed("e1"));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
  });

  // EmbedLayer mounts no DOM host in outline mode or for a hidden embed, and
  // the picker is defined entirely against that host's shadow DOM. A pick
  // retained without one is invisible but still described to the agent — and
  // PixiCanvas suppresses the embed-level agent button on the assumption that
  // an element-scoped one is being drawn instead, which it can't be.
  it("stops picking and clears the selection in outline render mode", () => {
    seedEmbed("e1");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    render(<Harness />);
    expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");

    act(() => useRenderModeStore.setState({ renderMode: "outline" }));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
    expect(useEmbedPickerStore.getState().selection).toBeNull();
  });

  it("stops picking and clears the selection when the embed is hidden", () => {
    seedEmbed("e1");
    useSelectionStore.setState({ selectedIds: ["e1"] });
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    render(<Harness />);

    act(() => {
      useSceneStore.setState({
        nodesById: {
          ...useSceneStore.getState().nodesById,
          e1: {
            ...(useSceneStore.getState().nodesById.e1 as EmbedNode),
            visible: false,
          } as unknown as FlatSceneNode,
        },
      } as never);
    });

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
    expect(useEmbedPickerStore.getState().selection).toBeNull();
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
