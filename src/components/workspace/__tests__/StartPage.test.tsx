import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canvasList: vi.fn(),
  canvasRemove: vi.fn(),
  listDocs: vi.fn(),
  deleteDoc: vi.fn(),
  listWorkflows: vi.fn(),
  deleteWorkflow: vi.fn(),
}));

vi.mock("@/lib/canvases/webCanvasStore", () => ({
  webCanvasStore: { list: mocks.canvasList, remove: mocks.canvasRemove },
  subscribeWebCanvases: () => () => {},
}));
vi.mock("@/lib/docs/docStore", () => ({
  listDocs: mocks.listDocs,
  deleteDoc: mocks.deleteDoc,
  subscribeDocs: () => () => {},
}));
vi.mock("@/lib/workflows/workflowStore", () => ({
  listWorkflows: mocks.listWorkflows,
  deleteWorkflow: mocks.deleteWorkflow,
  subscribeWorkflows: () => () => {},
}));

import { StartPage } from "../StartPage";

const NOW = Date.now();

beforeEach(() => {
  mocks.canvasList.mockResolvedValue({ canvases: [{ id: "cv_1", title: "Landing", updatedAt: NOW - 3 * 3600_000, rev: 1 }] });
  mocks.canvasRemove.mockResolvedValue({ ok: true });
  mocks.listDocs.mockReturnValue([{ id: "d1", title: "Brief", updatedAt: NOW - 60_000 * 5 }]);
  mocks.listWorkflows.mockReturnValue([{ id: "w1", title: "", updatedAt: NOW - 86_400_000 * 40, stepCount: 2 }]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const props = { onNew: vi.fn(), onOpen: vi.fn(), onBeforeDelete: vi.fn() };
  render(<StartPage {...props} />);
  return props;
}

describe("StartPage", () => {
  it("shows the headline, the hint and no Browser card", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Where shall we start?");
    expect(screen.getByText("Canvas, document and workflow tabs open here.")).toBeTruthy();
    expect(screen.queryByText(/Browser/)).toBeNull();
  });

  it("calls onNew from each card", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "New canvas tab" }));
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.click(screen.getByRole("button", { name: "New workflow" }));
    expect(p.onNew.mock.calls.map((c) => c[0])).toEqual(["canvas", "doc", "workflow"]);
  });

  it("merges the three stores, newest first, with an Untitled fallback", async () => {
    setup();
    const list = await screen.findByRole("list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Brief"),
      expect.stringContaining("Landing"),
      expect.stringContaining("Untitled"),
    ]);
    expect(rows[0].textContent).toContain("5 min ago");
  });

  it("opens an item on click", async () => {
    const p = setup();
    fireEvent.click(await screen.findByRole("button", { name: /^Landing/ }));
    expect(p.onOpen).toHaveBeenCalledWith({ kind: "canvas", id: "cv_1", title: "Landing", updatedAt: NOW - 3 * 3600_000 });
  });

  it("hides Recent when every store is empty", async () => {
    mocks.canvasList.mockResolvedValue({ canvases: [] });
    mocks.listDocs.mockReturnValue([]);
    mocks.listWorkflows.mockReturnValue([]);
    setup();
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: "Recent" })).toBeNull();
  });

  it("keeps the other stores when one fails", async () => {
    mocks.canvasList.mockResolvedValue({ error: "boom" });
    mocks.listDocs.mockImplementation(() => {
      throw new Error("broken");
    });
    setup();
    expect(await screen.findByRole("button", { name: /^Untitled/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Landing/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Brief/ })).toBeNull();
  });

  it("searches by title and clears the empty state", async () => {
    setup();
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "land" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "zzz" } });
    expect(screen.getByText("No matching files")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("clears the query when the search toggle closes the search", async () => {
    setup();
    await screen.findByRole("list");
    const toggle = screen.getByRole("button", { name: "Search" });
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "land" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(toggle);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(toggle);
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("");
  });

  it("filters by kind through the filter menu", async () => {
    setup();
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Canvas" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /^Landing/ })).toBeNull();
  });

  it("confirms, closes the tab first, then removes from the store", async () => {
    const order: string[] = [];
    const props = {
      onNew: vi.fn(),
      onOpen: vi.fn(),
      onBeforeDelete: vi.fn(() => order.push("close")),
    };
    mocks.canvasRemove.mockImplementation(async () => {
      order.push("remove");
      return { ok: true };
    });
    render(<StartPage {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Landing" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.canvasRemove).toHaveBeenCalledWith("cv_1"));
    expect(order).toEqual(["close", "remove"]);
  });
});
