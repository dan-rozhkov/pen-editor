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
    // Width/height should be shown as formatted px values somewhere in the box model.
    expect(screen.getByText("100px")).toBeTruthy();
    expect(screen.getByText("50px")).toBeTruthy();
  });

  it("copies a row's value on click and toasts", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    const row = screen.getByText("Fill").closest('[data-testid="inspect-row"]');
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(writeTextToClipboard).toHaveBeenCalledWith("#ff0000");
    expect(toast).toHaveBeenCalledWith("Copied Fill");
  });

  it("toggles Code/List and shows a placeholder for Code", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByText("Code generation coming soon")).toBeTruthy();
  });

  it("defaults to List mode without the Code placeholder", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    expect(screen.queryByText("Code generation coming soon")).toBeNull();
  });

  it("switches units from px to rem and updates rows", () => {
    select(["rect1"]);
    render(<InspectPanel />);
    expect(screen.getByText("100px")).toBeTruthy();
    act(() => {
      useDevModeStore.getState().setUnits("rem");
    });
    expect(screen.getByText("6.25rem")).toBeTruthy();
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

  it("shows first node + selection count note for multi-select", () => {
    select(["rect1", "text1"]);
    render(<InspectPanel />);
    expect(screen.getByText("Box")).toBeTruthy();
    expect(screen.getByText("2 selected")).toBeTruthy();
  });
});
