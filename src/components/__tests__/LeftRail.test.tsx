import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LeftRail } from "@/components/LeftRail";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import { useSharedViewStore } from "@/store/sharedViewStore";

afterEach(() => {
  cleanup();
  useSharedViewStore.setState({ isSharedView: false });
});

describe("<LeftRail />", () => {
  beforeEach(() => {
    useLeftSidebarStore.setState({ activeSection: "pages" });
  });

  it("renders the rail items", () => {
    render(<LeftRail />);
    expect(screen.getByTestId("rail-pages")).toBeTruthy();
    expect(screen.getByTestId("rail-slides")).toBeTruthy();
    expect(screen.getByTestId("rail-agents")).toBeTruthy();
    expect(screen.getByTestId("rail-components")).toBeTruthy();
    expect(screen.getByTestId("rail-variables")).toBeTruthy();
    expect(screen.getByTestId("rail-text-styles")).toBeTruthy();
    expect(screen.getByTestId("rail-styles")).toBeTruthy();
  });

  it("uses the shared selection background for the active item", () => {
    render(<LeftRail />);
    const activeIcon = screen.getByTestId("rail-pages").querySelector("span");
    expect(activeIcon?.className).toContain("bg-accent-selection");
  });

  it("switches to the slides section when its rail icon is clicked", () => {
    render(<LeftRail />);
    fireEvent.click(screen.getByTestId("rail-slides"));
    expect(useLeftSidebarStore.getState().activeSection).toBe("slides");
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

describe("<LeftRail /> in a shared (/c/:shareId) view", () => {
  beforeEach(() => {
    useLeftSidebarStore.setState({ activeSection: "pages" });
  });

  it("hides the agents section when isSharedView is true", () => {
    useSharedViewStore.setState({ isSharedView: true });
    render(<LeftRail />);
    expect(screen.queryByTestId("rail-agents")).toBeNull();
    expect(screen.queryByTestId("rail-toolbox")).toBeNull();
    expect(screen.queryByTestId("rail-comments")).toBeNull();
    expect(screen.getByTestId("rail-pages")).toBeTruthy();
  });

  it("shows the agents section when isSharedView is false", () => {
    useSharedViewStore.setState({ isSharedView: false });
    render(<LeftRail />);
    expect(screen.getByTestId("rail-agents")).toBeTruthy();
  });

  it("renders pages as active, WITHOUT persisting the fallback, when the active section becomes hidden", () => {
    localStorage.removeItem("left-sidebar-section");
    useLeftSidebarStore.setState({ activeSection: "agents" });
    useSharedViewStore.setState({ isSharedView: true });
    render(<LeftRail />);

    // Pages renders as the active rail icon (the visible fallback)...
    const pagesIcon = screen.getByTestId("rail-pages").querySelector("span");
    expect(pagesIcon?.className).toContain("bg-accent-selection");

    // ...but the underlying preference must be untouched: this is a pure
    // render-time derivation (resolveVisibleLeftSection), not a
    // setActiveSection() call. The old implementation called
    // setActiveSection("pages") here, which persisted to localStorage and
    // permanently changed which section the visitor's OWN editor opened to
    // afterwards, just from having viewed one shared link.
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(localStorage.getItem("left-sidebar-section")).toBeNull();
  });
});
