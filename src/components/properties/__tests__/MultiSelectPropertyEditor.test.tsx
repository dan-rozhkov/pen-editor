import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MultiSelectPropertyEditor } from "../MultiSelectPropertyEditor";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { SceneNode, FlatSceneNode } from "@/types/scene";
import { resetStores, seedScene } from "@/test/fixtures";

/**
 * MultiSelectPropertyEditor edits a homogeneous-ish selection through a single
 * set of section editors and writes via sceneStore.updateMultipleNodes, so a
 * change made once must land on EVERY selected node. We render the real section
 * components and assert the store reflects the change on each node.
 *
 * CustomColorPicker (used by Fill/Stroke ColorInput rows) opens a body portal /
 * runs debounced effects -> stub it to avoid act() noise; the section logic we
 * care about is unaffected.
 */
vi.mock("@/components/ui/ColorPicker", () => ({
  CustomColorPicker: () => null,
}));

// Fill/Effect detail editors now live in a base-ui popover (portaled, mounted
// only when open). Render trigger + content inline so the solid color row's hex
// input is in the DOM without driving the popover open in happy-dom.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function selectedNodes(ids: string[]): SceneNode[] {
  const byId = useSceneStore.getState().nodesById;
  return ids.map((id) => byId[id]) as unknown as SceneNode[];
}

function nodeById(id: string) {
  return useSceneStore.getState().nodesById[id] as unknown as Record<string, unknown>;
}

function renderEditor(ids: string[]) {
  useSelectionStore.setState({ selectedIds: ids });
  return render(
    <MultiSelectPropertyEditor
      selectedNodes={selectedNodes(ids)}
      variables={[]}
      activeTheme="light"
    />,
  );
}

describe("<MultiSelectPropertyEditor />", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  afterEach(() => cleanup());

  it("renders the sections shared by two rects (position/size/appearance/fill/stroke)", () => {
    renderEditor(["rect1", "rect2"]);

    // "Position" now appears both as the section header and as an embedded
    // alignment-control label, so match all occurrences.
    expect(screen.getAllByText("Position").length).toBeGreaterThan(0);
    expect(screen.getByText("Size")).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Fill")).toBeTruthy();
    expect(screen.getByText("Stroke")).toBeTruthy();
    expect(screen.getByText("Effects")).toBeTruthy();
  });

  it("applies an X-position change to every selected node", () => {
    renderEditor(["rect1", "rect2"]);

    // Position renders first: spinbuttons are X, Y, rotation.
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.focus(inputs[0]);
    fireEvent.change(inputs[0], { target: { value: "250" } });
    fireEvent.blur(inputs[0]);

    expect(nodeById("rect1").x).toBe(250);
    expect(nodeById("rect2").x).toBe(250);
    // Untouched nodes outside the selection are unaffected.
    expect(nodeById("text1").x).toBe(10);
  });

  it("applies an opacity change to every selected node", () => {
    renderEditor(["rect1", "rect2"]);

    // Spinbutton order: Position(X,Y,rotation)=3, Size(W,H)=2, then Appearance
    // "Opacity %" at index 5.
    const opacity = screen.getAllByRole("spinbutton")[5] as HTMLInputElement;
    expect(opacity.value).toBe("100");
    fireEvent.focus(opacity);
    fireEvent.change(opacity, { target: { value: "40" } });
    fireEvent.blur(opacity);

    expect(nodeById("rect1").opacity).toBe(0.4);
    expect(nodeById("rect2").opacity).toBe(0.4);
  });

  it("shows a Mixed marker for properties that differ across the selection", () => {
    // rect1.x = 10, rect2.x = 600 -> x is mixed; rect1/rect2 share width? No:
    // rect1 width 100, rect2 width 200 -> width also mixed. The X input renders
    // blank with a "Mixed" placeholder.
    renderEditor(["rect1", "rect2"]);

    const xInput = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
    expect(xInput.value).toBe("");
    expect(xInput.placeholder).toBe("Mixed");
  });

  it("intersects sections across mixed node types (rect + text shares core sections)", () => {
    // rect + text both support position/size/appearance/fill/stroke/effects.
    renderEditor(["rect1", "text1"]);

    expect(screen.getAllByText("Position").length).toBeGreaterThan(0);
    expect(screen.getByText("Fill")).toBeTruthy();
    expect(screen.getByText("Stroke")).toBeTruthy();
  });

  it("propagates a fill color edit to all selected nodes", () => {
    // seedScene gives rect1/rect2 DIFFERENT fills, so the fill would render as
    // "Mixed" with no editable rows. Give them an identical fill stack first so
    // the real FillSection renders a single editable solid row.
    const sharedFill = [{ id: "p1", type: "solid", color: "#ff0000" }];
    useSceneStore.getState().updateMultipleNodes(["rect1", "rect2"], {
      fills: sharedFill,
      fill: undefined,
    } as unknown as Partial<SceneNode>);

    renderEditor(["rect1", "rect2"]);

    // Solid fill rows render a hex text input (placeholder "#000000").
    const colorInputs = screen.getAllByPlaceholderText("#000000");
    fireEvent.change(colorInputs[0], { target: { value: "#123456" } });

    // FillSection writes a `fills` array; both nodes get the same value.
    const r1Fills = nodeById("rect1").fills as Array<{ color: string }> | undefined;
    const r2Fills = nodeById("rect2").fills as Array<{ color: string }> | undefined;
    expect(r1Fills?.[0].color).toBe("#123456");
    expect(r2Fills?.[0].color).toBe("#123456");
  });

  // Regression: the sizing deep-merge used to bypass sceneStore entirely via a
  // hand-rolled setState, silently dropping syncTextDimensions. A sizing-mode
  // click on a text node emits `sizing` AND `textWidthMode` together (see
  // SizeSection), so this is the exact trigger that used to leave stale
  // measured dimensions on multi-selected text nodes.
  it("re-measures text dimensions when a multi-select sizing-mode click carries both sizing and textWidthMode", () => {
    // Put text1 + a second text node inside an auto-layout frame so the W/H
    // sizing-mode buttons render (showSizingModes requires isInsideAutoLayout
    // or a frame/ref node).
    useSceneStore.setState((s) => {
      const frame1 = s.nodesById.frame1 as unknown as { layout: Record<string, unknown> };
      const text2 = {
        id: "text2",
        type: "text",
        name: "Subtitle",
        x: 10,
        y: 130,
        width: 60,
        height: 20,
        text: "World, a longer line of text",
        fontSize: 16,
        fontFamily: "Arial",
        fill: "#000000",
        textWidthMode: "fixed",
      } as unknown as FlatSceneNode;
      return {
        nodesById: {
          ...s.nodesById,
          frame1: { ...s.nodesById.frame1, layout: { ...frame1.layout, autoLayout: true } },
          text1: { ...s.nodesById.text1, textWidthMode: "fixed" } as FlatSceneNode,
          text2,
        },
        childrenById: { ...s.childrenById, frame1: [...s.childrenById.frame1, "text2"] },
        parentById: { ...s.parentById, text2: "frame1" },
      };
    });

    renderEditor(["text1", "text2"]);

    // W-row renders before H-row; both use the same "Fixed/Fill/Fit" labels,
    // so the first "Fit" button in DOM order is the W (widthMode) control.
    const fitButtons = screen.getAllByRole("button", { name: "Fit" });
    fireEvent.click(fitButtons[0]);

    // Reference: what a single-node updateNode with the same textWidthMode
    // update produces for an identically-configured node (sizing never
    // affects measurement, only textWidthMode does).
    const referenceBefore = { ...nodeById("text1") };
    useSceneStore.getState().updateNode(
      "text1",
      { textWidthMode: "auto" } as unknown as Partial<SceneNode>,
    );
    const referenceAfter = nodeById("text1");
    // Restore text1 to its pre-reference-mutation state so this probe doesn't
    // leak into later assertions.
    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, text1: referenceBefore as unknown as FlatSceneNode },
    }));

    expect(nodeById("text1").width).toBe(referenceAfter.width);
    expect(nodeById("text1").height).toBe(referenceAfter.height);
    expect(nodeById("text2").textWidthMode).toBe("auto");
  });

  // Regression: the auto-layout diff-merge used to bypass sceneStore's
  // markComponentArtifactsStaleFromNative, leaving a reusable component's HTML
  // export artifact marked in_sync after a native edit via multi-select.
  it("marks a reusable auto-layout frame's component artifact stale on a multi-select gap change, without disturbing other frames' flexDirection", () => {
    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        frame1: {
          ...s.nodesById.frame1,
          reusable: true,
          layout: {
            ...(s.nodesById.frame1 as unknown as { layout: Record<string, unknown> }).layout,
            autoLayout: true,
            flexDirection: "column",
            gap: 8,
          },
        } as unknown as FlatSceneNode,
        rect2: {
          ...s.nodesById.rect2,
          type: "frame",
          layout: { autoLayout: true, flexDirection: "row", gap: 8 },
        } as unknown as FlatSceneNode,
      },
    }));

    renderEditor(["frame1", "rect2"]);

    const gapLabel = screen.getByText("Gap");
    const gapInput = gapLabel.parentElement?.querySelector("input") as HTMLInputElement;
    fireEvent.focus(gapInput);
    fireEvent.change(gapInput, { target: { value: "24" } });
    fireEvent.blur(gapInput);

    const artifact = useSceneStore.getState().componentArtifactsById.frame1;
    expect(artifact).toBeDefined();
    expect(artifact?.syncState).not.toBe("in_sync");

    const frame1Layout = (nodeById("frame1") as unknown as { layout: Record<string, unknown> }).layout;
    const rect2Layout = (nodeById("rect2") as unknown as { layout: Record<string, unknown> }).layout;
    expect(frame1Layout.gap).toBe(24);
    expect(rect2Layout.gap).toBe(24);
    // Only gap changed — each frame's own flexDirection survived the merge.
    expect(frame1Layout.flexDirection).toBe("column");
    expect(rect2Layout.flexDirection).toBe("row");
  });
});
