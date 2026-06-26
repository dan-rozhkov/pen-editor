import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LeftRail } from "@/components/LeftRail";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import { useVariablesDialogStore } from "@/store/variablesDialogStore";

afterEach(() => cleanup());

describe("<LeftRail />", () => {
  beforeEach(() => {
    useLeftSidebarStore.setState({ activeSection: "pages" });
    useVariablesDialogStore.setState({ open: false });
  });

  it("renders the four rail items", () => {
    render(<LeftRail />);
    expect(screen.getByTestId("rail-pages")).toBeTruthy();
    expect(screen.getByTestId("rail-agents")).toBeTruthy();
    expect(screen.getByTestId("rail-components")).toBeTruthy();
    expect(screen.getByTestId("rail-variables")).toBeTruthy();
  });

  it("switches the active section when a section icon is clicked", () => {
    render(<LeftRail />);
    fireEvent.click(screen.getByTestId("rail-agents"));
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
  });

  it("opens the variables dialog without changing the section", () => {
    render(<LeftRail />);
    fireEvent.click(screen.getByTestId("rail-variables"));
    expect(useVariablesDialogStore.getState().open).toBe(true);
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
  });
});
