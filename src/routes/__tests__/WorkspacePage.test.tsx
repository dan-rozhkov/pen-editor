import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return { ...actual, toast: Object.assign(vi.fn(), { error: vi.fn() }) };
});
vi.mock("@/lib/canvases/webCanvasStore", () => ({
  webCanvasStore: { list: vi.fn().mockResolvedValue({ canvases: [] }), remove: vi.fn() },
  subscribeWebCanvases: () => () => {},
}));
vi.mock("@/lib/docs/docStore", () => ({
  DEFAULT_DOC_TITLE: "Untitled",
  listDocs: () => [],
  deleteDoc: vi.fn(),
  createDoc: vi.fn(() => ({ id: "doc_new", title: "Untitled" })),
  subscribeDocs: () => () => {},
}));
vi.mock("@/lib/workflows/workflowStore", () => ({
  DEFAULT_WORKFLOW_TITLE: "Untitled workflow",
  listWorkflows: () => [],
  deleteWorkflow: vi.fn(),
  createWorkflow: vi.fn(() => ({ id: "wf_new", title: "Untitled workflow" })),
  newStepId: () => "s1",
  subscribeWorkflows: () => () => {},
}));

import { toast } from "sonner";
import { createDoc } from "@/lib/docs/docStore";
import WorkspacePage, { UNSAVED_CLOSE_MESSAGE } from "../WorkspacePage";
import { wire } from "@/lib/workspace/linkWire";
import { TABS_SESSION_KEY, TABS_STORAGE_KEY } from "@/lib/workspace/tabsModel";

type FakeWindow = { focus: () => void; postMessage: ReturnType<typeof vi.fn>; penCanvasFlush?: () => Promise<boolean | void>; location?: unknown };
const windows = new WeakMap<HTMLIFrameElement, FakeWindow>();
const flushes = new Map<string, () => Promise<boolean | void>>();
const locations = new Map<string, { pathname: string; search: string }>();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  flushes.clear();
  locations.clear();
  vi.mocked(toast.error).mockClear();
  // happy-dom would try to load the iframe URLs; hand out a fake window per frame instead.
  Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      // One stable window per frame: the shell identifies a sender by comparing `event.source` with it.
      let win = windows.get(this);
      if (!win) windows.set(this, (win = { focus: vi.fn(), postMessage: vi.fn() } as unknown as FakeWindow));
      win.penCanvasFlush = flushes.get(this.name);
      win.location = locations.get(this.name);
      return win as unknown as Window;
    },
  });
});

afterEach(() => {
  cleanup();
  delete (window as { penDesktop?: unknown }).penDesktop;
  vi.useRealTimers();
});

function seedTabs(activeTabId: string | null) {
  localStorage.setItem(
    TABS_STORAGE_KEY,
    JSON.stringify({
      tabs: [
        { id: "t1", kind: "canvas", itemId: "cv_1", title: "Landing" },
        { id: "t2", kind: "doc", itemId: "d1", title: "Brief" },
      ],
      activeTabId,
    }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/workspace"]}>
      <Routes>
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/app" element={<div>Editor route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Tab frames only: the agent panel frame is always there.
const frames = () => Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[name^=pen-tab-]"));
// The fake window of a frame (created on first access).
const winOf = (el: HTMLIFrameElement) => el.contentWindow as unknown as FakeWindow;
const panelFrame = () => document.querySelector<HTMLIFrameElement>("iframe[title='Sideform Agent']");

describe("WorkspacePage", () => {
  it("shows the start page with no tabs", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Where shall we start?" })).toBeTruthy();
    expect(frames()).toHaveLength(0);
    await act(async () => {});
  });

  it("after a reload mounts only the active tab's iframe", async () => {
    seedTabs("t2");
    renderPage();
    expect(frames()).toHaveLength(1);
    expect(frames()[0].name).toBe("pen-tab-t2");
    expect(frames()[0].getAttribute("src")).toBe("/doc?id=d1&chat=off");
    expect(frames()[0].title).toBe("Brief");
    await act(async () => {});
  });

  it("prefers this window's own state over the shared one, which only seeds a new window", async () => {
    seedTabs("t2");
    sessionStorage.setItem(
      TABS_SESSION_KEY,
      JSON.stringify({ tabs: [{ id: "w1", kind: "doc", itemId: "mine", title: "Mine" }], activeTabId: "w1" }),
    );
    renderPage();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Mine"]);
    // Another window's writes go to the shared key only; this window's state is not touched by them.
    expect(JSON.parse(sessionStorage.getItem(TABS_SESSION_KEY)!).tabs).toHaveLength(1);
    await act(async () => {});
  });

  it("seeds a new window from the shared state and keeps its own copy from then on", async () => {
    seedTabs("t2");
    renderPage();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(JSON.parse(sessionStorage.getItem(TABS_SESSION_KEY)!).tabs).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Close Landing" }));
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(TABS_SESSION_KEY)!).tabs).toHaveLength(1));
    // Another window overwrites the shared key: a reload of this window still shows its own tabs.
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ tabs: [], activeTabId: null }));
    cleanup();
    renderPage();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Brief"]);
    await act(async () => {});
  });

  it("keeps a hidden frame mounted with visibility, never display:none", async () => {
    seedTabs("t1");
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Brief" }));
    expect(frames()).toHaveLength(2);
    const [first, second] = frames();
    expect(first.style.visibility).toBe("hidden");
    expect(first.style.pointerEvents).toBe("none");
    expect(first.style.display).not.toBe("none");
    expect(second.style.visibility).toBe("visible");
    // Home hides every frame but keeps them mounted.
    fireEvent.click(screen.getByRole("button", { name: "Start page" }));
    expect(frames()).toHaveLength(2);
    expect(frames().every((f) => f.style.visibility === "hidden")).toBe(true);
    expect(screen.getByRole("heading", { name: "Where shall we start?" })).toBeTruthy();
    await act(async () => {});
  });

  it("flushes the canvas before closing, then activates the right neighbour", async () => {
    seedTabs("t1");
    const flush = vi.fn().mockResolvedValue(undefined);
    flushes.set("pen-tab-t1", flush);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Close Landing" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Landing" })).toBeNull());
    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: "Brief" }).getAttribute("aria-selected")).toBe("true");
    expect(JSON.parse(localStorage.getItem(TABS_STORAGE_KEY)!).activeTabId).toBe("t2");
  });

  it("keeps the tab and warns when the flush never settles within 10 s; a second failed close discards", async () => {
    seedTabs("t1");
    const flush = vi.fn(() => new Promise<void>(() => {}));
    flushes.set("pen-tab-t1", flush);
    renderPage();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Close Landing" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(toast.error).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(toast.error).toHaveBeenCalledWith(UNSAVED_CLOSE_MESSAGE);
    expect(screen.queryByRole("tab", { name: "Landing" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close Landing" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByRole("tab", { name: "Landing" })).toBeNull();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "a later successful flush closes it", second: undefined },
    { name: "a second failed flush discards it", second: false },
  ])("flushes on every close: a failed flush keeps the tab, then $name", async ({ second }) => {
    seedTabs("t1");
    const flush = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(second);
    flushes.set("pen-tab-t1", flush);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Close Landing" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNSAVED_CLOSE_MESSAGE));
    expect(screen.queryByRole("tab", { name: "Landing" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close Landing" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Landing" })).toBeNull());
    expect(flush).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("rebinds a tab when its frame moves to another item, without reloading the frame", async () => {
    seedTabs("t2");
    locations.set("pen-tab-t2", { pathname: "/doc", search: "?id=d2&chat=off" });
    vi.useFakeTimers();
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(JSON.parse(localStorage.getItem(TABS_STORAGE_KEY)!).tabs[1].itemId).toBe("d2");
    expect(frames()[0].getAttribute("src")).toBe("/doc?id=d1&chat=off");
  });

  it("shows the error when creating a document fails", async () => {
    vi.mocked(createDoc).mockImplementationOnce(() => {
      throw new Error("storage full");
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    expect(toast.error).toHaveBeenCalledWith("storage full");
    expect(frames()).toHaveLength(0);
    await act(async () => {});
  });

  it("opens one settings tab however often the gear is pressed", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(frames()[0].getAttribute("src")).toBe("/settings?chat=off");
    await act(async () => {});
  });

  it("opens a new document tab from the start page card", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    expect(frames()[0].getAttribute("src")).toBe("/doc?id=doc_new&chat=off");
    await act(async () => {});
  });

  it("redirects to /app inside the desktop shell", () => {
    (window as { penDesktop?: unknown }).penDesktop = {};
    renderPage();
    expect(screen.getByText("Editor route")).toBeTruthy();
  });

  describe("agent panel", () => {
    it("always shows the chat frame, with or without tabs, and keeps the same element", async () => {
      seedTabs("t2");
      renderPage();
      const panel = panelFrame();
      expect(panel?.getAttribute("src")).toBe("/agent");
      fireEvent.click(screen.getByRole("button", { name: "Start page" }));
      expect(panelFrame()).toBe(panel);
      await act(async () => {});
    });

    function fromFrame(source: unknown, data: unknown, origin = window.location.origin) {
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as MessageEventSource }));
      });
    }

    it("routes the panel's list request and ignores foreign origins and unknown windows", async () => {
      seedTabs("t1");
      renderPage();
      const panel = winOf(panelFrame()!);
      fromFrame(panel, wire({ type: "list", rid: "r1" }), "https://evil.example");
      fromFrame({}, wire({ type: "list", rid: "r2" }));
      expect(panel.postMessage).not.toHaveBeenCalled();
      fromFrame(panel, wire({ type: "list", rid: "r3" }));
      expect(panel.postMessage).toHaveBeenCalledWith(
        { ns: wire({ type: "x" }).ns, type: "list-reply", rid: "r3", tabs: [] },
        window.location.origin,
      );
      await act(async () => {});
    });

    it("opens a canvas tab on the panel's request and answers once that frame registers", async () => {
      renderPage();
      const panel = winOf(panelFrame()!);
      fromFrame(panel, wire({ type: "open", rid: "o1" }));
      await waitFor(() => expect(frames()).toHaveLength(1));
      expect(frames()[0].getAttribute("src")).toMatch(/^\/app\?canvas=cv_[a-z0-9]{16}&chat=off$/);
      fromFrame(winOf(frames()[0]), wire({ type: "register" }));
      expect(panel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "open-reply", rid: "o1", ok: true, registrationId: 1 }),
        window.location.origin,
      );
    });

    it("mounts both frames when two opens land in one batch, without taking keyboard focus", async () => {
      renderPage();
      const panel = winOf(panelFrame()!);
      act(() => {
        for (const rid of ["o1", "o2"]) {
          window.dispatchEvent(
            new MessageEvent("message", {
              data: wire({ type: "open", rid, activate: true }),
              origin: window.location.origin,
              source: panel as unknown as MessageEventSource,
            }),
          );
        }
      });
      await waitFor(() => expect(frames()).toHaveLength(2));
      expect(frames().map((f) => f.style.visibility).sort()).toEqual(["hidden", "visible"]);
      for (const f of frames()) expect(winOf(f).focus).not.toHaveBeenCalled();
    });

    it("wakes a restored, unregistered canvas tab for an implicit open instead of creating one", async () => {
      seedTabs("t2");
      renderPage();
      const panel = winOf(panelFrame()!);
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: wire({ type: "open", rid: "o1" }),
            origin: window.location.origin,
            source: panel as unknown as MessageEventSource,
          }),
        );
      });
      await waitFor(() => expect(frames().some((f) => f.name === "pen-tab-t1")).toBe(true));
      expect(frames().find((f) => f.name === "pen-tab-t1")!.style.visibility).toBe("visible");
      expect(document.querySelectorAll("[role=tab]")).toHaveLength(2);
    });

    it("two implicit opens in one batch share one tab and take no keyboard focus", async () => {
      renderPage();
      const panel = winOf(panelFrame()!);
      act(() => {
        for (const rid of ["o1", "o2"]) {
          window.dispatchEvent(
            new MessageEvent("message", {
              data: wire({ type: "open", rid }),
              origin: window.location.origin,
              source: panel as unknown as MessageEventSource,
            }),
          );
        }
      });
      await waitFor(() => expect(frames()).toHaveLength(1));
      expect(winOf(frames()[0]).focus).not.toHaveBeenCalled();
      fromFrame(winOf(frames()[0]), wire({ type: "register" }));
      const replies = panel.postMessage.mock.calls.filter((c) => (c[0] as { type: string }).type === "open-reply");
      expect(replies.map((c) => (c[0] as { rid: string }).rid)).toEqual(["o1", "o2"]);
    });
  });
});
