import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent, act } from "@testing-library/react";
import { LayersPanel } from "../LayersPanel";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { sourcePathToShadowPath } from "@/lib/embedLayerTree";
import { resetStores, seedScene } from "@/test/fixtures";
import { ReadOnlyContext } from "@/hooks/useReadOnly";
import type { FlatSceneNode } from "@/types/scene";

function seedEmbedScene(htmlContent: string, embedId = "embed1"): void {
  useSceneStore.setState({
    nodesById: {
      ...useSceneStore.getState().nodesById,
      [embedId]: {
        id: embedId,
        type: "embed",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        htmlContent,
      } as unknown as FlatSceneNode,
    },
    parentById: { ...useSceneStore.getState().parentById, [embedId]: null },
    childrenById: useSceneStore.getState().childrenById,
    rootIds: [...useSceneStore.getState().rootIds, embedId],
  });
}

function embedHtml(embedId = "embed1"): string {
  return (useSceneStore.getState().nodesById[embedId] as unknown as { htmlContent: string }).htmlContent;
}

/** A fake `DataTransfer` sufficient for the drag handlers under test — they
 * only assign `effectAllowed` and call `setData`. */
function makeDataTransfer() {
  return { effectAllowed: "", setData: vi.fn() } as unknown as DataTransfer;
}

function mockRowRect(row: HTMLElement, height = 28): void {
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: height,
    left: 0,
    right: 100,
    width: 100,
    height,
    x: 0,
    y: 0,
    toJSON() {},
  } as DOMRect);
}

/** `fireEvent.dragOver(el, { clientY })` doesn't actually set `clientY` on
 * the resulting event under happy-dom's `DragEvent` — building a plain
 * `MouseEvent` (with `dataTransfer` attached manually) and dispatching it
 * through `fireEvent` does, since React's synthetic event only reads
 * `.clientY`/`.dataTransfer` off whatever native event it wraps, not the
 * class it was constructed as. */
function dragOverAt(el: HTMLElement, dataTransfer: DataTransfer, clientY: number): void {
  const event = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  fireEvent(el, event);
}

describe("<LayersPanel />", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows an empty state when there are no layers", () => {
    render(<LayersPanel />);
    expect(screen.getByText("No layers yet")).toBeTruthy();
  });

  it("renders a row for each top-level layer from the scene store", () => {
    seedScene();
    render(<LayersPanel />);

    // frame1 "Screen" and rect2 "Floating" are the top-level nodes; frame1 is
    // collapsed by default so its children are not rendered.
    expect(screen.getByText("Screen")).toBeTruthy();
    expect(screen.getByText("Floating")).toBeTruthy();
    expect(screen.queryByText("Box")).toBeNull(); // child of collapsed frame1
    expect(screen.queryByText("No layers yet")).toBeNull();
  });

  it("renders nested children once their parent frame is expanded", () => {
    seedScene();
    useSceneStore.getState().setFrameExpanded("frame1", true);
    render(<LayersPanel />);

    expect(screen.getByText("Screen")).toBeTruthy();
    expect(screen.getByText("Box")).toBeTruthy(); // rect1
    expect(screen.getByText("Title")).toBeTruthy(); // text1
  });

  describe("embed elements", () => {
    afterEach(() => {
      cleanup();
    });

    it("renders no element rows for a collapsed embed, but still offers a chevron to expand it", () => {
      seedEmbedScene("<button>Buy</button>");
      render(<LayersPanel />);
      expect(screen.queryByText("Buy")).toBeNull();
      expect(screen.queryByLabelText("Expand layer")).toBeTruthy();
    });

    it("renders an expanded embed's element rows in document order", () => {
      seedEmbedScene("<button>First</button><button>Second</button>");
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      const firstRow = screen.getByText("First").closest("[data-layer-key]");
      const secondRow = screen.getByText("Second").closest("[data-layer-key]");
      expect(firstRow).toBeTruthy();
      expect(secondRow).toBeTruthy();
      // compareDocumentPosition: FOLLOWING means firstRow comes before
      // secondRow in the DOM — i.e. document order, not reversed like
      // native z-stack children.
      expect(
        firstRow!.compareDocumentPosition(secondRow!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("renders no element rows and no chevron for empty/malformed html", () => {
      seedEmbedScene("");
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);
      expect(screen.queryByLabelText("Expand layer")).toBeNull();
    });

    it("dims a hidden element's label", () => {
      seedEmbedScene('<button style="display:none">Buy</button>');
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);
      const label = screen.getByText("Buy");
      expect(label.className).toContain("opacity-50");
    });

    it("clicking an embed-element row selects the embed and stores a picker selection with the right shadowPath", () => {
      const html = "<button>Buy</button>";
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      fireEvent.click(screen.getByText("Buy"));

      expect(useSelectionStore.getState().selectedIds).toEqual(["embed1"]);
      const selection = useEmbedPickerStore.getState().selection;
      expect(selection?.embedId).toBe("embed1");
      expect(selection?.tagName).toBe("button");
      expect(selection?.path).toBe(sourcePathToShadowPath("button:nth-of-type(1)", html));
    });

    it("hovering an embed-element row sets hoveredEmbedId/hoveredPath", () => {
      const html = "<button>Buy</button>";
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      fireEvent.mouseEnter(screen.getByText("Buy"));
      expect(useEmbedPickerStore.getState().hoveredEmbedId).toBe("embed1");
      expect(useEmbedPickerStore.getState().hoveredPath).toBe(
        sourcePathToShadowPath("button:nth-of-type(1)", html),
      );

      fireEvent.mouseLeave(screen.getByText("Buy"));
      expect(useEmbedPickerStore.getState().hoveredEmbedId).toBeNull();
      expect(useEmbedPickerStore.getState().hoveredPath).toBeNull();
    });

    it("auto-expands the embed and marks the picked row selected on a canvas-originated pick", async () => {
      const html = '<div class="card"><button>Buy</button></div>';
      seedEmbedScene(html);
      useSelectionStore.setState({ selectedIds: ["embed1"] });
      const scrollIntoViewSpy = vi
        .spyOn(HTMLElement.prototype, "scrollIntoView")
        .mockImplementation(() => {});

      render(<LayersPanel />);
      // Nothing expanded yet — the row doesn't exist.
      expect(screen.queryByText("Buy")).toBeNull();

      // Simulate a canvas pick: embedPickerStore.selection changes WITHOUT
      // selectionFromLayersRef being set (that flag is only set by
      // LayerItem's own click handler).
      await act(async () => {
        useEmbedPickerStore.getState().selectElement(
          {
            embedId: "embed1",
            path: sourcePathToShadowPath("div:nth-of-type(1) > button:nth-of-type(1)", html),
            tagName: "button",
            classes: [],
            textPreview: "Buy",
            outerHtml: "<button>Buy</button>",
          },
          html,
        );
        // The scroll-into-view happens inside a requestAnimationFrame
        // callback after the expand/re-render commits — give it a tick.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });

      const buyRow = screen.getByText("Buy").closest("[data-layer-key]") as HTMLElement;
      expect(buyRow).toBeTruthy();
      expect(buyRow.className).toContain("bg-accent-selection");
      expect(scrollIntoViewSpy).toHaveBeenCalled();

      scrollIntoViewSpy.mockRestore();
    });
  });

  describe("embed-element rename/visibility/drag (Part 2)", () => {
    afterEach(() => cleanup());

    it("double-clicking a label renames the element via data-layer-name", () => {
      const html = "<button>Buy</button>";
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      fireEvent.doubleClick(screen.getByText("Buy"));
      const input = screen.getByDisplayValue("Buy") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "CTA" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(embedHtml()).toContain('data-layer-name="CTA"');
      expect(screen.getByText("CTA")).toBeTruthy();
    });

    it("submitting an empty name clears data-layer-name, falling back to the derived name", () => {
      const html = '<button data-layer-name="Old">Buy</button>';
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      fireEvent.doubleClick(screen.getByText("Old"));
      const input = screen.getByDisplayValue("Old") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(embedHtml()).not.toContain("data-layer-name");
      expect(screen.getByText("Buy")).toBeTruthy();
    });

    it("Escape cancels a rename without writing anything", () => {
      const html = "<button>Buy</button>";
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      fireEvent.doubleClick(screen.getByText("Buy"));
      const input = screen.getByDisplayValue("Buy") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "CTA" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(embedHtml()).toBe(html);
      expect(screen.getByText("Buy")).toBeTruthy();
    });

    it("the eye button hides and shows an element, round-tripping the html", () => {
      const html = "<button>Buy</button>";
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      const row = screen.getByText("Buy").closest("[data-layer-key]") as HTMLElement;
      const eyeButton = within(row).getByRole("button");

      fireEvent.click(eyeButton);
      expect(embedHtml()).toContain("display: none");
      expect(screen.getByText("Buy").className).toContain("opacity-50");

      fireEvent.click(within(row).getByRole("button"));
      expect(embedHtml()).toBe(html);
    });

    it("reorders 'before'/'after' within one embed via drag-and-drop", () => {
      const html = '<p id="a">A</p><p id="b">B</p>';
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      const rowA = screen.getByText("A").closest("[data-layer-key]") as HTMLElement;
      const rowB = screen.getByText("B").closest("[data-layer-key]") as HTMLElement;
      mockRowRect(rowA);

      const dataTransfer = makeDataTransfer();
      fireEvent.dragStart(rowB, { dataTransfer });
      // clientY near the top of rowA's (mocked) box -> "before".
      dragOverAt(rowA, dataTransfer, 2);
      fireEvent.drop(rowA, { dataTransfer });

      const newHtml = embedHtml();
      expect(newHtml.indexOf('id="b"')).toBeLessThan(newHtml.indexOf('id="a"'));
    });

    it("reorders 'inside' a container via drag-and-drop", () => {
      const html = '<p id="a">A</p><div id="target"></div>';
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      const rowA = screen.getByText("A").closest("[data-layer-key]") as HTMLElement;
      // The empty target div has no text/label to query by — its row is the
      // second (and only other) embed-element row under embed1.
      const targetRow = document.querySelectorAll('[data-layer-key^="embed:embed1:"]')[1] as HTMLElement;
      mockRowRect(targetRow);

      const dataTransfer = makeDataTransfer();
      fireEvent.dragStart(rowA, { dataTransfer });
      // clientY in the middle band (25%-75% of a 28px row) -> "inside".
      dragOverAt(targetRow, dataTransfer, 14);
      fireEvent.drop(targetRow, { dataTransfer });

      expect(embedHtml()).toMatch(/<div id="target"><p id="a">A<\/p><\/div>/);
    });

    it("refuses a cross-embed drag — dragging over a different embed's row changes nothing", () => {
      seedEmbedScene("<p id='a'>A</p>", "embed1");
      seedEmbedScene("<p id='c'>C</p>", "embed2");
      useSceneStore.getState().setFrameExpanded("embed1", true);
      useSceneStore.getState().setFrameExpanded("embed2", true);
      render(<LayersPanel />);

      const rowA = screen.getByText("A").closest("[data-layer-key]") as HTMLElement;
      const rowC = screen.getByText("C").closest("[data-layer-key]") as HTMLElement;
      mockRowRect(rowC);

      const html1Before = embedHtml("embed1");
      const html2Before = embedHtml("embed2");

      const dataTransfer = makeDataTransfer();
      fireEvent.dragStart(rowA, { dataTransfer });
      dragOverAt(rowC, dataTransfer, 14);
      fireEvent.drop(rowC, { dataTransfer });

      expect(embedHtml("embed1")).toBe(html1Before);
      expect(embedHtml("embed2")).toBe(html2Before);
    });

    it("refuses an embed-element <-> native drag in either direction", () => {
      seedScene(); // adds native roots frame1/rect2
      seedEmbedScene("<p id='a'>A</p>");
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      const rowA = screen.getByText("A").closest("[data-layer-key]") as HTMLElement;
      const nativeRow = screen.getByText("Floating").closest("[data-layer-key]") as HTMLElement;
      mockRowRect(nativeRow);
      mockRowRect(rowA);

      const htmlBefore = embedHtml();
      const dataTransfer = makeDataTransfer();

      // embed element dragged onto a native row
      fireEvent.dragStart(rowA, { dataTransfer });
      dragOverAt(nativeRow, dataTransfer, 14);
      fireEvent.drop(nativeRow, { dataTransfer });
      expect(embedHtml()).toBe(htmlBefore);
      expect(useSceneStore.getState().parentById.rect2 ?? null).toBeNull();

      // native row dragged onto an embed element row
      fireEvent.dragStart(nativeRow, { dataTransfer });
      dragOverAt(rowA, dataTransfer, 14);
      fireEvent.drop(rowA, { dataTransfer });
      expect(embedHtml()).toBe(htmlBefore);
    });

    it("is a no-op everywhere in read-only mode", () => {
      const html = "<button>Buy</button>";
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(
        <ReadOnlyContext.Provider value={true}>
          <LayersPanel />
        </ReadOnlyContext.Provider>,
      );

      // Rename: double-click must not open the inline editor.
      fireEvent.doubleClick(screen.getByText("Buy"));
      expect(screen.queryByDisplayValue("Buy")).toBeNull();

      // Visibility: clicking the eye button must not touch the html.
      const row = screen.getByText("Buy").closest("[data-layer-key]") as HTMLElement;
      fireEvent.click(within(row).getByRole("button"));
      expect(embedHtml()).toBe(html);

      // Drag: the row isn't draggable, so no handler is attached at all.
      const dataTransfer = makeDataTransfer();
      fireEvent.dragStart(row, { dataTransfer });
      mockRowRect(row);
      dragOverAt(row, dataTransfer, 14);
      fireEvent.drop(row, { dataTransfer });
      expect(embedHtml()).toBe(html);
    });
  });

  describe("code review regressions (findings #3, #4b, #6, #8)", () => {
    afterEach(() => cleanup());

    // Finding #3: `selectableFlatIds` fed a shift-range-select must contain
    // only native scene-node ids. An embed-element row's key
    // (`embed:<embedId>:<sourcePath>`) names no scene node — if it leaks
    // into `selectedIds`, `deleteNode`/`groupNodes`/alignment silently
    // no-op on it and `buildCanvasContext` sends the agent a `{ id }` stub.
    it("range-selecting across an expanded embed only selects native rows", () => {
      // `seedEmbedScene` appends its embed to the CURRENT `rootIds` — build
      // up nodeA, then the embed, then nodeB in that order so the panel's
      // (reversed) row order comes out nodeB, embed1, "Buy", nodeA.
      useSceneStore.setState({
        nodesById: {
          nodeA: { id: "nodeA", type: "rect", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
        },
        parentById: { nodeA: null },
        childrenById: {},
        rootIds: ["nodeA"],
      });
      seedEmbedScene("<button>Buy</button>");
      useSceneStore.setState({
        nodesById: {
          ...useSceneStore.getState().nodesById,
          nodeB: { id: "nodeB", type: "rect", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
        },
        parentById: { ...useSceneStore.getState().parentById, nodeB: null },
        rootIds: [...useSceneStore.getState().rootIds, "nodeB"],
      });
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      // Panel order (top -> bottom) is rootIds reversed: nodeB, embed1,
      // "Buy" (embed1's expanded element row), nodeA. Set up the range
      // start from nodeB directly, matching how a real range-select begins
      // from an already-selected native row.
      act(() => {
        useSelectionStore.setState({ selectedIds: ["nodeB"], lastSelectedId: "nodeB" });
      });

      const nodeARow = document.querySelector('[data-node-id="nodeA"]') as HTMLElement;
      fireEvent.click(nodeARow, { shiftKey: true });

      const { selectedIds } = useSelectionStore.getState();
      expect(selectedIds).toEqual(["nodeB", "embed1", "nodeA"]);
      expect(selectedIds.some((id) => id.startsWith("embed:"))).toBe(false);
    });

    // Finding #4b: clicking an embed's OWN row doesn't change which native
    // node is selected (the embed already was, and stays, the sole
    // selection) — `useEmbedPickerLifecycle` only clears a picker selection
    // when the embed stops being the sole selection, so without an
    // explicit clear here the element selection survives and a subsequent
    // Delete removes the DOM element instead of the embed, with no cue why.
    it("clicking an embed's own row clears any element selection picked inside it", () => {
      const html = "<button>Buy</button>";
      seedEmbedScene(html);
      useSelectionStore.setState({ selectedIds: ["embed1"] });
      useEmbedPickerStore.getState().selectElement(
        {
          embedId: "embed1",
          path: sourcePathToShadowPath("button:nth-of-type(1)", html),
          tagName: "button",
          classes: [],
          textPreview: "Buy",
          outerHtml: "<button>Buy</button>",
        },
        html,
      );
      render(<LayersPanel />);

      const embedRow = document.querySelector('[data-node-id="embed1"]') as HTMLElement;
      fireEvent.click(embedRow);

      expect(useEmbedPickerStore.getState().selection).toBeNull();
    });

    // Finding #6: `onMouseLeave` never fires for a row that disappears out
    // from under the pointer instead of being moved away from. Without a
    // cleanup-on-unmount, `hoveredEmbedId`/`hoveredPath` keeps naming the
    // deleted element's path, and `EmbedElementHighlight` keeps painting a
    // hover outline on whatever now resolves to it.
    it("clears the hover state when its row disappears without a mouseleave", () => {
      const html = "<p>A</p><p>B</p>";
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      // Hover B (`p:nth-of-type(2)`), not A: removing A instead would leave
      // B sliding into A's OLD key (`p:nth-of-type(1)`) — same row identity,
      // same React element, no real unmount, so it wouldn't exercise this
      // fix. Removing B itself makes `p:nth-of-type(2)` stop existing
      // entirely, so its row genuinely unmounts.
      fireEvent.mouseEnter(screen.getByText("B"));
      expect(useEmbedPickerStore.getState().hoveredEmbedId).toBe("embed1");
      expect(useEmbedPickerStore.getState().hoveredPath).toBe(
        sourcePathToShadowPath("p:nth-of-type(2)", html),
      );

      // Row B disappears without ever firing mouseleave — the same way
      // Delete removes it.
      act(() => {
        useSceneStore.getState().updateNode("embed1", { htmlContent: "<p>A</p>" });
      });

      expect(useEmbedPickerStore.getState().hoveredEmbedId).toBeNull();
      expect(useEmbedPickerStore.getState().hoveredPath).toBeNull();
    });

    // Regression for finding #4: `flattenLayers` builds a brand-new
    // `{ embedId, element }` wrapper object for every row on every call —
    // including a call triggered by a scene change that has nothing to do
    // with this embed at all (any `nodesById` change reruns it, since that's
    // one of `flatLayers`'s `useMemo` deps). `LayerItem`'s hover-cleanup
    // effect used to depend on that OBJECT, so it re-ran (and cleared the
    // canvas hover highlight) on every such unrelated change, even though
    // the pointer never left row A.
    it("keeps the hover highlight across an UNRELATED scene change", () => {
      const html = "<p>A</p><p>B</p>";
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      fireEvent.mouseEnter(screen.getByText("A"));
      expect(useEmbedPickerStore.getState().hoveredEmbedId).toBe("embed1");
      const hoveredPath = useEmbedPickerStore.getState().hoveredPath;
      expect(hoveredPath).toBe(sourcePathToShadowPath("p:nth-of-type(1)", html));

      act(() => {
        useSceneStore.setState({
          nodesById: {
            ...useSceneStore.getState().nodesById,
            rect1: { id: "rect1", type: "rect", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
          },
          parentById: { ...useSceneStore.getState().parentById, rect1: null },
          rootIds: [...useSceneStore.getState().rootIds, "rect1"],
        });
      });

      expect(useEmbedPickerStore.getState().hoveredEmbedId).toBe("embed1");
      expect(useEmbedPickerStore.getState().hoveredPath).toBe(hoveredPath);
    });

    // Finding #8 (first round): `resolveName` truncates a long derived text
    // label to 28 chars + "…" for DISPLAY only. Seeding the rename input
    // with that truncated label means a double-click followed by a blur
    // with no actual edit submits the ellipsis as a permanent
    // `data-layer-name`.
    it("blurring a long text row's rename input without editing does not write the truncated label", () => {
      const longText = "A".repeat(40);
      const html = `<p>${longText}</p>`;
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      const truncated = `${longText.slice(0, 28)}…`;
      fireEvent.doubleClick(screen.getByText(truncated));
      // Fails before the fix: the input is seeded with `truncated`, not the
      // full text, so no element has this display value.
      const input = screen.getByDisplayValue(longText) as HTMLInputElement;
      fireEvent.blur(input);

      // Finding #8 (second round) supersedes what this test asserted here:
      // blurring with no actual edit must not write ANY `data-layer-name`
      // at all, truncated or not — see LayerItem.tsx's `handleNameSubmit`.
      expect(embedHtml()).toBe(html);
      expect(embedHtml()).not.toContain("…");
      expect(embedHtml()).not.toContain("data-layer-name");
    });

    // Regression for finding #8 (second round): a double-click followed by
    // a blur with NO edit at all (the common accidental case, not just the
    // truncated-label one above) must not stamp a `data-layer-name`
    // override — `setEmbedElementName` only compares against the EXISTING
    // attribute, which is absent here, so without the fix in
    // `handleNameSubmit` it would write the current derived text as a
    // permanent override, freezing the label so future text edits stop
    // updating it.
    it("blurring a short text row's rename input without editing writes nothing", () => {
      const html = "<p>Hello</p>";
      seedEmbedScene(html);
      useSceneStore.getState().setFrameExpanded("embed1", true);
      render(<LayersPanel />);

      fireEvent.doubleClick(screen.getByText("Hello"));
      const input = screen.getByDisplayValue("Hello") as HTMLInputElement;
      fireEvent.blur(input);

      expect(embedHtml()).toBe(html);
    });
  });
});
