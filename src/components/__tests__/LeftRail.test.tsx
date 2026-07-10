import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LeftRail } from "@/components/LeftRail";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

afterEach(() => cleanup());

describe("<LeftRail />", () => {
  beforeEach(() => {
    useLeftSidebarStore.setState({ activeSection: "pages" });
  });

  it("renders the rail items", () => {
    render(<LeftRail />);
    expect(screen.getByTestId("rail-pages")).toBeTruthy();
    expect(screen.getByTestId("rail-agents")).toBeTruthy();
    expect(screen.getByTestId("rail-components")).toBeTruthy();
    expect(screen.getByTestId("rail-variables")).toBeTruthy();
    expect(screen.getByTestId("rail-text-styles")).toBeTruthy();
    expect(screen.getByTestId("rail-styles")).toBeTruthy();
  });

  it("switches the active section when a section icon is clicked", () => {
    render(<LeftRail />);
    fireEvent.click(screen.getByTestId("rail-agents"));
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
  });

  it("switches to the styles section when its rail icon is clicked", () => {
    render(<LeftRail />);
    fireEvent.click(screen.getByTestId("rail-styles"));
    expect(useLeftSidebarStore.getState().activeSection).toBe("styles");
  });

  it("switches to the variables section when its rail icon is clicked", () => {
    render(<LeftRail />);
    fireEvent.click(screen.getByTestId("rail-variables"));
    expect(useLeftSidebarStore.getState().activeSection).toBe("variables");
  });

  it("switches to the text styles section when its rail icon is clicked", () => {
    render(<LeftRail />);
    fireEvent.click(screen.getByTestId("rail-text-styles"));
    expect(useLeftSidebarStore.getState().activeSection).toBe("textStyles");
  });
});
