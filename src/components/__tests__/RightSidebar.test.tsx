import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";

/**
 * RightSidebar is a thin layout container that always composes PageControls on
 * top of the PropertiesPanel. We mock both children to shims and assert
 * composition.
 */

vi.mock("../PageControls", () => ({
  PageControls: () => <div data-testid="page-controls-shim" />,
}));
vi.mock("../PropertiesPanel", () => ({
  PropertiesPanel: () => <div data-testid="properties-shim" />,
}));

import { RightSidebar } from "../RightSidebar";

describe("<RightSidebar />", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders both PageControls and PropertiesPanel", () => {
    render(<RightSidebar />);
    expect(screen.getByTestId("page-controls-shim")).toBeTruthy();
    expect(screen.getByTestId("properties-shim")).toBeTruthy();
  });

  it("uses the docked (border) wrapper styling", () => {
    const { container } = render(<RightSidebar />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("border-l");
    expect(root.className).not.toContain("rounded-2xl");
  });
});
