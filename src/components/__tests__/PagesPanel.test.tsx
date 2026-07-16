import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PagesPanel } from "../PagesPanel";
import { usePageStore, type PageData } from "@/store/pageStore";
import { resetStores } from "@/test/fixtures";

/**
 * PagesPanel lists the document's pages, highlights the active one, and wires
 * add/select/rename/duplicate/delete actions to the page store.
 *
 * pageStore is NOT touched by resetStores(), so we snapshot its baseline once
 * and restore it in afterEach to avoid leaking page state to other suites.
 * Pages are seeded empty (no nodes) so switchToPage's font-loading / loading
 * overlay machinery stays a no-op and never initialises PixiJS.
 */

function emptyPage(id: string, name: string): PageData {
  return {
    id,
    name,
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
  };
}

function ps() {
  return usePageStore.getState();
}

describe("<PagesPanel />", () => {
  // Snapshot the real initial page-store state to restore later.
  const baseline = usePageStore.getState();

  beforeEach(() => {
    resetStores();
    usePageStore.setState({
      pages: [emptyPage("p1", "Page 1"), emptyPage("p2", "Page 2")],
      activePageId: "p1",
      componentArtifactsById: {},
      _injectedComponentIds: new Set<string>(),
    });
  });

  afterEach(() => {
    cleanup();
    usePageStore.setState({
      pages: baseline.pages,
      activePageId: baseline.activePageId,
      componentArtifactsById: baseline.componentArtifactsById,
      _injectedComponentIds: baseline._injectedComponentIds,
    });
  });

  it("renders a row for each page", () => {
    render(<PagesPanel />);
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(screen.getByText("Page 2")).toBeTruthy();
  });

  it("marks the active page with the active styling", () => {
    render(<PagesPanel />);
    const active = screen.getByText("Page 1").closest("div")!;
    const inactive = screen.getByText("Page 2").closest("div")!;
    expect(active.className).toContain("bg-secondary");
    expect(active.className).toContain("font-medium");
    // Inactive row does not get the active font weight.
    expect(inactive.className).not.toContain("font-medium");
  });

  it("adds a new page via the Add page button", () => {
    render(<PagesPanel />);
    expect(ps().pages.length).toBe(2);

    fireEvent.click(screen.getByLabelText("Add page"));

    const pages = ps().pages;
    expect(pages.length).toBe(3);
    expect(pages[2].name).toBe("Page 3");
    // Newly added page becomes active.
    expect(ps().activePageId).toBe(pages[2].id);
  });

  it("switches the active page when a different page row is clicked", () => {
    render(<PagesPanel />);
    expect(ps().activePageId).toBe("p1");

    fireEvent.click(screen.getByText("Page 2"));

    expect(ps().activePageId).toBe("p2");
  });

  it("renames a page on double-click + Enter", () => {
    render(<PagesPanel />);
    fireEvent.doubleClick(screen.getByText("Page 1"));

    const input = screen.getByDisplayValue("Page 1") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(ps().pages.find((p) => p.id === "p1")!.name).toBe("Renamed");
  });

  it("does not rename when the rename is cancelled with Escape", () => {
    render(<PagesPanel />);
    fireEvent.doubleClick(screen.getByText("Page 1"));

    const input = screen.getByDisplayValue("Page 1") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Throwaway" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(ps().pages.find((p) => p.id === "p1")!.name).toBe("Page 1");
    // Editing input is gone after Escape.
    expect(screen.queryByDisplayValue("Throwaway")).toBeNull();
  });

  it("duplicates a page from the row menu", () => {
    render(<PagesPanel />);

    // Open the per-row dropdown (icon-only trigger). The menu portals to body.
    const triggers = screen.getAllByRole("button");
    // First button is "Add page"; the row menu triggers follow.
    fireEvent.click(triggers[1]);
    fireEvent.click(screen.getByText("Duplicate"));

    const pages = ps().pages;
    expect(pages.length).toBe(3);
    expect(pages.some((p) => p.name === "Page 1 copy")).toBe(true);
  });

  it("deletes a page from the row menu when more than one page exists", () => {
    render(<PagesPanel />);

    const triggers = screen.getAllByRole("button");
    fireEvent.click(triggers[1]); // open menu for the first row (Page 1)
    fireEvent.click(screen.getByText("Delete"));

    const pages = ps().pages;
    expect(pages.length).toBe(1);
    expect(pages.some((p) => p.id === "p1")).toBe(false);
  });

  it("hides the Delete action when only one page remains", () => {
    usePageStore.setState({
      pages: [emptyPage("only", "Solo")],
      activePageId: "only",
    });
    render(<PagesPanel />);

    // triggers[0] is "Add page"; triggers[1] is the single row's menu trigger.
    fireEvent.click(screen.getAllByRole("button")[1]);

    // Menu shows Duplicate but not Delete with a single page.
    expect(screen.getByText("Duplicate")).toBeTruthy();
    expect(screen.queryByText("Delete")).toBeNull();
  });
});
