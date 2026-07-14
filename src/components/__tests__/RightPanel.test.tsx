import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { useDevModeStore } from "@/store/devModeStore";

// RightSidebar/InspectPanel pull in heavy panel trees (properties, box model,
// etc.) that aren't relevant to this swap logic — stub them so this test
// stays focused on "which panel renders for which dev-mode state" rather
// than re-testing their internals.
vi.mock("../RightSidebar", () => ({
  RightSidebar: () => <div data-testid="right-sidebar" />,
}));
vi.mock("../inspect/InspectPanel", () => ({
  InspectPanel: () => <div data-testid="inspect-panel" />,
}));

import { RightPanel } from "../RightPanel";

describe("<RightPanel />", () => {
  afterEach(() => {
    cleanup();
    useDevModeStore.setState({ active: false });
  });

  it("renders RightSidebar when dev mode is inactive", () => {
    useDevModeStore.setState({ active: false });
    render(<RightPanel />);
    expect(screen.getByTestId("right-sidebar")).toBeTruthy();
    expect(screen.queryByTestId("inspect-panel")).toBeNull();
  });

  it("renders InspectPanel when dev mode is active", () => {
    useDevModeStore.setState({ active: true });
    render(<RightPanel />);
    expect(screen.getByTestId("inspect-panel")).toBeTruthy();
    expect(screen.queryByTestId("right-sidebar")).toBeNull();
  });

  it("swaps panels when dev mode toggles", () => {
    useDevModeStore.setState({ active: false });
    render(<RightPanel />);
    expect(screen.getByTestId("right-sidebar")).toBeTruthy();

    act(() => {
      useDevModeStore.setState({ active: true });
    });
    expect(screen.getByTestId("inspect-panel")).toBeTruthy();
    expect(screen.queryByTestId("right-sidebar")).toBeNull();
  });
});
