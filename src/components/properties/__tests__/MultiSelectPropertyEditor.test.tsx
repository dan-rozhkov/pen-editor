import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MultiSelectPropertyEditor } from "../MultiSelectPropertyEditor";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { SceneNode } from "@/types/scene";
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
});
