import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";
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
vi.mock("../SlidesPanel", () => ({
  SlidesPanel: () => <div data-testid="slides-shim" />,
}));
vi.mock("../PagesPanel", () => ({
  PagesPanel: () => <div data-testid="pages-shim" />,
}));
vi.mock("../chat/ChatPanel", () => ({
  ChatPanelContent: () => <div data-testid="chat-shim" />,
}));
vi.mock("../VariablesPanel", () => ({
  VariablesPanelContent: () => <div data-testid="variables-shim" />,
}));
vi.mock("../TextStylesPanel", () => ({
  TextStylesPanelContent: () => <div data-testid="text-styles-shim" />,
}));
vi.mock("../StylesPanel", () => ({
  StylesPanelContent: () => <div data-testid="styles-shim" />,
}));

import { LeftSidebar } from "../LeftSidebar";
import { OFFLINE_DOCUMENT_TITLE } from "@/lib/apiBase";

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

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
    guides: [],
    slideOrder: [],
    measurements: [],
    comments: [],
  }));
  usePageStore.setState({ pages, activePageId: pages[0]?.id ?? "" });
}

describe("<LeftSidebar />", () => {
  const baselinePages = usePageStore.getState();

  beforeEach(() => {
    resetStores();
    useDocumentStore.setState({ fileName: null });
    useLeftSidebarStore.setState({ activeSection: "pages" });
    setPages(1);
    setOnline(true);
  });

  afterEach(() => {
    cleanup();
    useLeftSidebarStore.setState({ activeSection: "pages", isExpanded: false });
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

  it("renders the Slides section when it is active", () => {
    useLeftSidebarStore.setState({ activeSection: "slides" });
    render(<LeftSidebar />);
    expect(screen.getByTestId("toolbar-shim")).toBeTruthy();
    expect(screen.getByText("Untitled")).toBeTruthy();
    expect(screen.getByTestId("slides-shim")).toBeTruthy();
    // Pages/layers content is not mounted while slides is active.
    expect(screen.queryByTestId("layers-shim")).toBeNull();
    expect(screen.queryByTestId("pages-shim")).toBeNull();
  });

  it("renders the Components section when it is active", () => {
    useLeftSidebarStore.setState({ activeSection: "components" });
    render(<LeftSidebar />);
    expect(screen.getByTestId("components-shim")).toBeTruthy();
    expect(screen.getByText("Components").parentElement?.className).toContain("h-[49px]");
    // Pages section content is not mounted while components is active.
    expect(screen.queryByTestId("layers-shim")).toBeNull();
  });

  it("renders the Variables section when it is active", () => {
    useLeftSidebarStore.setState({ activeSection: "variables" });
    render(<LeftSidebar />);
    expect(screen.getByTestId("variables-shim")).toBeTruthy();
    expect(screen.queryByTestId("layers-shim")).toBeNull();
  });

  it("renders the Text styles section when it is active", () => {
    useLeftSidebarStore.setState({ activeSection: "textStyles" });
    render(<LeftSidebar />);
    expect(screen.getByTestId("text-styles-shim")).toBeTruthy();
  });

  it("renders the Styles section when it is active", () => {
    useLeftSidebarStore.setState({ activeSection: "styles" });
    render(<LeftSidebar />);
    expect(screen.getByTestId("styles-shim")).toBeTruthy();
  });

  it("renders the Styles section full-screen when the panel is expanded", () => {
    useLeftSidebarStore.setState({ activeSection: "styles", isExpanded: true });
    const { container } = render(<LeftSidebar />);
    const wrapper = screen.getByTestId("styles-shim").parentElement;
    expect(wrapper?.className).toContain("fixed");
    expect(wrapper?.className).toContain("z-[60]");
    expect(container).toBeTruthy();
  });

  it("shows the offline document indicator beside the file name when offline", () => {
    setOnline(false);
    useDocumentStore.setState({ fileName: "design.pen" });
    render(<LeftSidebar />);
    expect(screen.getByLabelText(OFFLINE_DOCUMENT_TITLE)).toBeTruthy();
  });

  it("hides the offline document indicator while online", () => {
    setOnline(true);
    useDocumentStore.setState({ fileName: "design.pen" });
    render(<LeftSidebar />);
    expect(screen.queryByLabelText(OFFLINE_DOCUMENT_TITLE)).toBeNull();
  });

  it("shows the offline indicator in the Slides section too", () => {
    setOnline(false);
    useLeftSidebarStore.setState({ activeSection: "slides" });
    render(<LeftSidebar />);
    expect(screen.getByLabelText(OFFLINE_DOCUMENT_TITLE)).toBeTruthy();
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
