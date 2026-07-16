import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSelectionStore } from "@/store/selectionStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useVariableStore } from "@/store/variableStore";
import { useSceneStore } from "@/store/sceneStore";
import { writeTextToClipboard } from "@/utils/clipboard";

vi.mock("@/utils/clipboard", () => ({
  writeTextToClipboard: vi.fn(async () => true),
}));

vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

import { toast } from "sonner";
import { InspectPanel } from "../InspectPanel";
import { BoxModelDiagram } from "../BoxModelDiagram";
import { useDevExportStore } from "@/store/devExportStore";
import { ReadOnlyProvider } from "@/components/ReadOnlyProvider";

function select(ids: string[]) {
  useSelectionStore.setState({ selectedIds: ids });
}

/**
 * See the identical helper/comment in DevExportSection.test.tsx: base-ui's
 * `SelectItem` only commits a plain click on an unhighlighted option for
 * touch pointers, so a hover (`mouseMove`) has to precede the click to make
 * it behave like a real mouse selection.
 */
function selectOption(name: string) {
  const option = screen.getByRole("option", { name });
  fireEvent.mouseMove(option);
  fireEvent.click(option);
}

describe("<InspectPanel />", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    useDevModeStore.setState({ active: true, units: "px", remBase: 16 });
    vi.mocked(writeTextToClipboard).mockClear();
    vi.mocked(toast).mockClear();
  });

  afterEach(() => cleanup());

  it("shows the empty state when nothing is selected", () => {
    select([]);
    render(<InspectPanel />);
    expect(screen.getByText("Select a layer to inspect")).toBeTruthy();
  });

  it("renders name and W/H rows for a selected node", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    expect(screen.getByText("Box")).toBeTruthy();
    expect(screen.getByText("100 × 50")).toBeTruthy();
  });

  it("places the box model in the Layer properties accordion", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    const layerProperties = screen.getByRole("button", { name: "Layer properties" });
    expect(screen.getByLabelText("Box model")).toBeTruthy();
    fireEvent.click(layerProperties);
    expect(screen.queryByLabelText("Box model")).toBeNull();
  });

  it("copies a row's value on click and toasts", async () => {
    select(["rect1"]);
    render(<InspectPanel />);
    const row = screen.getByText("Fill").closest('[data-testid="inspect-row"]');
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(writeTextToClipboard).toHaveBeenCalledWith("#ff0000");
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Copied Fill"));
  });

  it("toggles Code/List and shows the CSS code section for Code", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByText("CSS")).toBeTruthy();
    expect(screen.getByTestId("code-block").className).toContain("bg-surface-base");
    expect(screen.getByTestId("code-block").className).not.toContain("border");
    expect(screen.getByRole("button", { name: "Copy code" }).className).toContain("bg-surface-panel");
    expect(screen.getByLabelText("Line numbers").children.length).toBeGreaterThan(0);
  });

  it("uses the properties-style toggle group for React code output", () => {
    select(["rect1"]);
    useDevModeStore.getState().setCodegenFormat("react");
    render(<InspectPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByRole("button", { name: "Inline" }).className).toContain("bg-surface-panel");
    expect(screen.getByRole("button", { name: "Tailwind" }).className).toContain("bg-secondary");
  });

  it("defaults to List mode without the Code section", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    expect(screen.queryByText("CSS")).toBeNull();
  });

  it("switches units from px to rem and updates rows", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    expect(screen.getByText("100 × 50")).toBeTruthy();
    act(() => {
      useDevModeStore.getState().setUnits("rem");
    });
    expect(screen.getByText("6.25 × 3.125")).toBeTruthy();
  });

  it("shows unitless values in the box model diagram", () => {
    render(
      <BoxModelDiagram
        box={{
          width: 240,
          height: 338,
          borderTop: 1,
          borderRight: 1,
          borderBottom: 1,
          borderLeft: 1,
          paddingTop: 10,
          paddingRight: 10,
          paddingBottom: 10,
          paddingLeft: 10,
        }}
        units="px"
        remBase={16}
      />,
    );
    const boxModel = screen.getByLabelText("Box model");
    expect(within(boxModel).getAllByText("1")).toHaveLength(4);
    expect(within(boxModel).getAllByText("10")).toHaveLength(4);
    expect(within(boxModel).queryByText("1px")).toBeNull();
    expect(within(boxModel).queryByText("10px")).toBeNull();
  });

  it("shows the per-corner radius values in the box model diagram", () => {
    render(
      <BoxModelDiagram
        box={{
          width: 238,
          height: 157,
          borderTop: 1,
          borderRight: 1,
          borderBottom: 1,
          borderLeft: 1,
          paddingTop: 4,
          paddingRight: 4,
          paddingBottom: 4,
          paddingLeft: 4,
          cornerRadius: { topLeft: 16, topRight: 8, bottomRight: 12, bottomLeft: 4 },
        }}
        units="px"
        remBase={16}
      />,
    );
    const boxModel = screen.getByLabelText("Box model");
    expect(within(boxModel).getByText("16")).toBeTruthy();
    expect(within(boxModel).getByText("8")).toBeTruthy();
    expect(within(boxModel).getByText("12")).toBeTruthy();
    expect(within(boxModel).getAllByText("4").length).toBeGreaterThanOrEqual(4);
    expect(within(boxModel).getByText("Border").getAttribute("style")).toContain("left: 48px");
  });

  it("expands a token row on click, showing light/dark values", () => {
    useVariableStore.setState({
      variables: [
        {
          id: "v1",
          name: "Brand/Red",
          type: "color",
          value: "#ff0000",
          themeValues: { light: "#ff0000", dark: "#aa0000" },
        } as never,
      ],
    });
    useSceneStore.setState((state) => ({
      nodesById: {
        ...state.nodesById,
        rect1: {
          ...state.nodesById.rect1,
          fillBinding: { variableId: "v1" },
        } as never,
      },
    }));
    select(["rect1"]);
    render(<InspectPanel />);
    const tokenRow = screen.getByText("Brand/Red").closest('[data-testid="inspect-row"]');
    expect(tokenRow).toBeTruthy();
    fireEvent.click(tokenRow!);
    expect(screen.getByText("#aa0000")).toBeTruthy();
  });

  it("renders componentId and propertyValues for a ref node", () => {
    useSceneStore.setState((state) => ({
      nodesById: {
        ...state.nodesById,
        ref1: {
          id: "ref1",
          type: "ref",
          name: "Button Instance",
          x: 0,
          y: 0,
          width: 40,
          height: 20,
          componentId: "frame1",
          propertyValues: { size: "large", disabled: true },
        } as never,
      },
      rootIds: [...state.rootIds, "ref1"],
    }));
    select(["ref1"]);
    render(<InspectPanel />);
    expect(screen.getByText("frame1")).toBeTruthy();
    expect(screen.getByText("size")).toBeTruthy();
    expect(screen.getByText("large")).toBeTruthy();
    expect(screen.getByText("disabled")).toBeTruthy();
    expect(screen.getByText("true")).toBeTruthy();
  });

  it("shows first node + selection count note for multi-select", () => {
    select(["rect1", "text1"]);
    render(<InspectPanel />);
    expect(screen.getByText("Box")).toBeTruthy();
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("hints that Tailwind/React code shows only the first of a multi-selection", () => {
    select(["rect1", "text1"]);
    render(<InspectPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    act(() => {
      useDevModeStore.getState().setCodegenFormat("tailwind");
    });
    expect(screen.getByText("Showing first of 2 selected layers.")).toBeTruthy();
  });

  it("does not show the multi-selection hint for CSS (which handles multi-select natively)", () => {
    useDevModeStore.getState().setCodegenFormat("css");
    select(["rect1", "text1"]);
    render(<InspectPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.queryByText(/Showing first of/)).toBeNull();
  });

  it("exits dev mode when the exit button is clicked", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    fireEvent.click(screen.getByTestId("inspect-exit-dev-mode"));
    expect(useDevModeStore.getState().active).toBe(false);
  });

  it("shows an Export section with a default PNG 1x row for a node with no exportSettings (dev-03)", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    expect(screen.getByTestId("export-settings-list").children).toHaveLength(1);
  });

  it("editing export settings in Dev Mode does not mutate the node in sceneStore (dev-03)", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    const before = JSON.stringify(useSceneStore.getState().nodesById);

    fireEvent.click(screen.getByLabelText("Add export setting"));

    expect(JSON.stringify(useSceneStore.getState().nodesById)).toBe(before);
    expect(useSceneStore.getState().nodesById.rect1.exportSettings).toBeUndefined();
  });

  it("hides the Export section entirely for a multi-selection, matching Design mode (finding 1)", () => {
    select(["rect1", "text1"]);
    render(<InspectPanel />);
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    expect(screen.queryByTestId("export-settings-list")).toBeNull();
  });

  // Ship-blocking bug: production wraps `<RightPanel />` (and thus
  // `InspectPanel`) in `<ReadOnlyProvider value={isView || isDev}>`
  // (App.tsx:139) — every other test in this file renders `InspectPanel`
  // bare, so `useReadOnly()` silently defaults to `false` and never exercises
  // the real Dev Mode condition. That blind spot is *why* the Export
  // section's format/scale selects (and the suffix/custom-scale fields) were
  // completely inert in the live app despite this file's existing coverage.
  it("(ship bug, reproduces the real production condition) the Export section's scale select is interactive under a real ReadOnlyProvider(true), and never touches the document", () => {
    select(["rect1"]);
    render(
      <ReadOnlyProvider value={true}>
        <InspectPanel />
      </ReadOnlyProvider>,
    );
    const before = JSON.stringify(useSceneStore.getState().nodesById);

    const list = screen.getByTestId("export-settings-list");
    const [, scaleCombobox] = within(list).getAllByRole("combobox");
    fireEvent.click(scaleCombobox);
    selectOption("2x");

    expect(useDevExportStore.getState().overrides.rect1?.[0]).toMatchObject({ scale: 2 });
    // Read-only for the *document* must be preserved: only the ephemeral
    // devExportStore is written, never sceneStore/the node's exportSettings.
    expect(JSON.stringify(useSceneStore.getState().nodesById)).toBe(before);
    expect(useSceneStore.getState().nodesById.rect1.exportSettings).toBeUndefined();
  });

  it("renders a single Export heading with the add-row action still reachable (finding 2)", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    // Only one "Export" heading should exist — the collapsible Section's own
    // title, not a second one nested inside ExportSettingsList's PropertySection.
    expect(screen.getAllByText("Export")).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("Add export setting"));
    expect(screen.getByTestId("export-settings-list").children).toHaveLength(2);
  });

  it("resolves a variable-bound fill to the dark value for a node under a dark themeOverride ancestor", () => {
    useVariableStore.setState({
      variables: [
        {
          id: "v1",
          name: "Brand/Red",
          type: "color",
          value: "#ff0000",
          themeValues: { light: "#ff0000", dark: "#aa0000" },
        } as never,
      ],
    });
    // rect1 is already a child of frame1 in the seeded scene (see fixtures.ts).
    // Uses the "$name" direct-reference fallback (no colorBinding) so the
    // resolved value renders directly as row text instead of behind an
    // expandable token — a colorBinding's token row shows the variable name,
    // not the resolved value, until expanded (see the token-row test above),
    // so it can't assert the theme resolution by itself.
    useSceneStore.setState((state) => ({
      nodesById: {
        ...state.nodesById,
        frame1: { ...state.nodesById.frame1, themeOverride: "dark" } as never,
        rect1: {
          ...state.nodesById.rect1,
          fill: "$Brand/Red",
        } as never,
      },
    }));
    select(["rect1"]);
    render(<InspectPanel />);
    expect(screen.getByText("#aa0000")).toBeTruthy();
  });
});
