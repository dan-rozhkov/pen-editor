import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
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

function select(ids: string[]) {
  useSelectionStore.setState({ selectedIds: ids });
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

  it("exits dev mode when the exit button is clicked", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    fireEvent.click(screen.getByTestId("inspect-exit-dev-mode"));
    expect(useDevModeStore.getState().active).toBe(false);
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
