import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";
import { useFloatingPanelsStore } from "@/store/floatingPanelsStore";
import { useDocumentStore } from "@/store/documentStore";
import { usePageStore } from "@/store/pageStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

/**
 * LeftSidebar is a layout container composing the Toolbar, an editable file
 * name, and a body whose content is driven by the active rail section
 * (pages | agents | components). We mock the heavy child panels to identifiable
 * shims so these tests assert *composition* (which regions render for a given
 * state), not the children's own behaviour.
 */

vi.mock("../Toolbar", () => ({
  Toolbar: () => <div data-testid="toolbar-shim" />,
}));
vi.mock("../layers", () => ({
  LayersPanel: () => <div data-testid="layers-shim" />,
}));
vi.mock("../ComponentsPanel", () => ({
  ComponentsPanel: () => <div data-testid="components-shim" />,
}));
vi.mock("../PagesPanel", () => ({
  PagesPanel: () => <div data-testid="pages-shim" />,
}));
vi.mock("../chat/ChatPanel", () => ({
  ChatPanelContent: () => <div data-testid="chat-shim" />,
}));

import { LeftSidebar } from "../LeftSidebar";

function setPages(count: number) {
  const pages = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Page ${i + 1}`,
    nodesById: {},
    parentById: {},
    childrenById: {},
    rootIds: [],
    pageBackground: "#f5f5f5",
    expandedFrameIds: new Set<string>(),
    viewport: { scale: 1, x: 0, y: 0 },
    history: { past: [], future: [] },
  }));
  usePageStore.setState({ pages, activePageId: pages[0]?.id ?? "" });
}

describe("<LeftSidebar />", () => {
  const baselinePages = usePageStore.getState();
  const baselineFloating = useFloatingPanelsStore.getState().isFloating;

  beforeEach(() => {
    resetStores();
    useFloatingPanelsStore.setState({ isFloating: false });
    useDocumentStore.setState({ fileName: null });
    useLeftSidebarStore.setState({ activeSection: "pages" });
    setPages(1);
  });

  afterEach(() => {
    cleanup();
    useFloatingPanelsStore.setState({ isFloating: baselineFloating });
    useLeftSidebarStore.setState({ activeSection: "pages" });
    usePageStore.setState({
      pages: baselinePages.pages,
      activePageId: baselinePages.activePageId,
    });
  });

  it("renders the Toolbar and the Pages section (pages + layers) by default", () => {
    render(<LeftSidebar />);
    expect(screen.getByTestId("toolbar-shim")).toBeTruthy();
    // Pages section shows the pages list and the layer tree together.
    expect(screen.getByTestId("pages-shim")).toBeTruthy();
    expect(screen.getByTestId("layers-shim")).toBeTruthy();
    // Components content is not mounted in the pages section.
    expect(screen.queryByTestId("components-shim")).toBeNull();
  });

  it("renders the PagesPanel section when there are pages", () => {
    setPages(2);
    render(<LeftSidebar />);
    expect(screen.getByTestId("pages-shim")).toBeTruthy();
  });

  it("hides the PagesPanel section when there are no pages", () => {
    usePageStore.setState({ pages: [], activePageId: "" });
    render(<LeftSidebar />);
    expect(screen.queryByTestId("pages-shim")).toBeNull();
    // Layers still renders within the pages section.
    expect(screen.getByTestId("layers-shim")).toBeTruthy();
  });

  it("shows 'Untitled' for the file name when none is set", () => {
    render(<LeftSidebar />);
    expect(screen.getByText("Untitled")).toBeTruthy();
  });

  it("strips the extension from the displayed file name", () => {
    useDocumentStore.setState({ fileName: "design.pen" });
    render(<LeftSidebar />);
    expect(screen.getByText("design")).toBeTruthy();
  });

  it("collapses the floating layout to hide the body, file name and pages", () => {
    useFloatingPanelsStore.setState({ isFloating: true });
    setPages(2);
    render(<LeftSidebar />);

    // Floating mode keeps only the toolbar row; the docked-only regions go away.
    expect(screen.getByTestId("toolbar-shim")).toBeTruthy();
    expect(screen.queryByTestId("layers-shim")).toBeNull();
    expect(screen.queryByTestId("pages-shim")).toBeNull();
    expect(screen.queryByText("Untitled")).toBeNull();
  });

  it("toggles the floating panels store via the dock/float button", () => {
    render(<LeftSidebar />);
    expect(useFloatingPanelsStore.getState().isFloating).toBe(false);

    fireEvent.click(screen.getByTestId("sidebar-toggle"));

    expect(useFloatingPanelsStore.getState().isFloating).toBe(true);
  });

  it("renders the Components section when it is active", () => {
    useLeftSidebarStore.setState({ activeSection: "components" });
    render(<LeftSidebar />);
    expect(screen.getByTestId("components-shim")).toBeTruthy();
    // Pages section content is not mounted while components is active.
    expect(screen.queryByTestId("layers-shim")).toBeNull();
  });

  it("renames the document via the editable file name field", () => {
    useDocumentStore.setState({ fileName: "design.pen" });
    render(<LeftSidebar />);

    fireEvent.click(screen.getByText("design"));
    const input = screen.getByDisplayValue("design") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Extension is preserved.
    expect(useDocumentStore.getState().fileName).toBe("renamed.pen");
  });
});
