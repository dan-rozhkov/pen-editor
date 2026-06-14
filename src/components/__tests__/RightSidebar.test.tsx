import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";
import { useFloatingPanelsStore } from "@/store/floatingPanelsStore";

/**
 * RightSidebar is a thin layout container that always composes PageControls on
 * top of the PropertiesPanel, switching its wrapper styling between docked and
 * floating modes. We mock both children to shims and assert composition.
 */

vi.mock("../PageControls", () => ({
  PageControls: () => <div data-testid="page-controls-shim" />,
}));
vi.mock("../PropertiesPanel", () => ({
  PropertiesPanel: () => <div data-testid="properties-shim" />,
}));

import { RightSidebar } from "../RightSidebar";

describe("<RightSidebar />", () => {
  const baselineFloating = useFloatingPanelsStore.getState().isFloating;

  beforeEach(() => {
    resetStores();
    useFloatingPanelsStore.setState({ isFloating: false });
  });

  afterEach(() => {
    cleanup();
    useFloatingPanelsStore.setState({ isFloating: baselineFloating });
  });

  it("renders both PageControls and PropertiesPanel", () => {
    render(<RightSidebar />);
    expect(screen.getByTestId("page-controls-shim")).toBeTruthy();
    expect(screen.getByTestId("properties-shim")).toBeTruthy();
  });

  it("uses the docked (border) wrapper styling by default", () => {
    const { container } = render(<RightSidebar />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("border-l");
    expect(root.className).not.toContain("rounded-2xl");
  });

  it("uses the floating (rounded/shadow) wrapper styling when floating", () => {
    useFloatingPanelsStore.setState({ isFloating: true });
    const { container } = render(<RightSidebar />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("rounded-2xl");
    expect(root.className).not.toContain("border-l");
    // Children still render in floating mode.
    expect(screen.getByTestId("page-controls-shim")).toBeTruthy();
    expect(screen.getByTestId("properties-shim")).toBeTruthy();
  });
});
