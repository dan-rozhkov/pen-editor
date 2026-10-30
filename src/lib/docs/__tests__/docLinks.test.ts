import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("../canvasFocusRequest", () => ({ requestCanvasFocus: vi.fn() }));
vi.mock("../docStore", () => ({ readDoc: vi.fn() }));

import { toast } from "sonner";
import { classifyHref, docLinkHref, nodeLinkHref, traceLinkHref } from "../docLinks";
import { DOC_MISSING_MESSAGE, CANVAS_TAB_IN_DOC_MESSAGE, TRACE_OPEN_FAILED_MESSAGE, canvasTabInDocLink, DOC_PLACEHOLDER_MESSAGE, activateCanvasTabLink, CANVAS_TAB_UNAVAILABLE_MESSAGE, focusNodeLink, handleLinkClick, openTraceLink, NODE_PLACEHOLDER_MESSAGE, openDocLink } from "../docLinkActions";
import { requestCanvasFocus } from "../canvasFocusRequest";
import { readDoc } from "../docStore";

beforeEach(() => vi.clearAllMocks());

const linkActions = () => ({
  openDoc: vi.fn(),
  focusNode: vi.fn(),
  activateCanvasTab: vi.fn(),
  openTrace: vi.fn(),
  openExternal: vi.fn(),
});

describe("classifyHref", () => {
  it.each([
    ["/doc?id=doc_abc", { kind: "doc", id: "doc_abc" }],
    ["/doc?id=doc_abc&chat=off", { kind: "doc", id: "doc_abc" }],
    ["/app?node=n1", { kind: "node", id: "n1" }],
    ["/app?tab=12", { kind: "canvasTab", tabId: 12 }],
    ["/app?tab=abc", { kind: "external", href: "/app?tab=abc" }],
    ["/doc?tab=3", { kind: "external", href: "/doc?tab=3" }],
    ["/trace/t1?src=local", { kind: "trace", id: "t1", source: "local" }],
    ["/trace/t1?src=cloud", { kind: "trace", id: "t1", source: "cloud" }],
    ["/trace/t1", { kind: "trace", id: "t1", source: "cloud" }],
    ["/trace/t1?src=weird", { kind: "trace", id: "t1", source: "cloud" }],
    ["/trace/a%20b?src=local", { kind: "trace", id: "a b", source: "local" }],
    ["/trace/%E0%A4%A", { kind: "external", href: "/trace/%E0%A4%A" }],
    ["/trace/", { kind: "external", href: "/trace/" }],
    ["javascript:alert(1)", { kind: "external", href: "javascript:alert(1)" }],
    ["/doc?id=", { kind: "external", href: "/doc?id=" }],
    ["/doc", { kind: "external", href: "/doc" }],
    ["https://x.test/doc?id=doc_abc", { kind: "external", href: "https://x.test/doc?id=doc_abc" }],
    ["mailto:a@b.c", { kind: "external", href: "mailto:a@b.c" }],
  ])("%s", (href, expected) => {
    expect(classifyHref(href)).toEqual(expected);
  });

  it("builds hrefs that classify back to the same id", () => {
    expect(classifyHref(docLinkHref("doc_1"))).toEqual({ kind: "doc", id: "doc_1" });
    expect(classifyHref(nodeLinkHref("a b"))).toEqual({ kind: "node", id: "a b" });
    expect(classifyHref(traceLinkHref("a/b", "local"))).toEqual({ kind: "trace", id: "a/b", source: "local" });
  });
});

describe("handleLinkClick", () => {
  it.each([
    ["/doc?id=d1", "openDoc", "d1"],
    ["/app?node=n1", "focusNode", "n1"],
    ["/app?tab=7", "activateCanvasTab", 7],
    ["https://x.test", "openExternal", "https://x.test"],
  ] as const)("routes %s to %s", (href, method, arg) => {
    const actions = linkActions();
    handleLinkClick(href, actions);
    expect(actions[method]).toHaveBeenCalledWith(arg);
    const calls = Object.values(actions).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
    expect(calls).toBe(1);
  });

  it("routes a trace link with its source", () => {
    const actions = linkActions();
    handleLinkClick("/trace/t9?src=local", actions);
    expect(actions.openTrace).toHaveBeenCalledWith("t9", "local");
  });

  it("does not throw when an action does", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => handleLinkClick("/doc?id=d1", { ...linkActions(), openDoc: () => { throw new Error("x"); } })).not.toThrow();
    spy.mockRestore();
  });
});

describe("openDocLink / focusNodeLink", () => {
  it("switches to a document that exists", () => {
    vi.mocked(readDoc).mockReturnValue({ kind: "ok", doc: {} as never });
    const select = vi.fn();
    openDocLink("d1", select);
    expect(select).toHaveBeenCalledWith("d1");
    expect(toast).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing document", "d1", DOC_MISSING_MESSAGE],
    ["the DOC_ID placeholder", "DOC_ID", DOC_PLACEHOLDER_MESSAGE],
  ])("toasts for %s and does not navigate", (_name, id, message) => {
    vi.mocked(readDoc).mockReturnValue({ kind: "missing" });
    const select = vi.fn();
    openDocLink(id, select);
    expect(select).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(message);
  });

  it("asks the canvas for a real node and only hints for NODE_ID", () => {
    focusNodeLink("n1");
    focusNodeLink("NODE_ID");
    expect(requestCanvasFocus).toHaveBeenCalledExactlyOnceWith("n1");
    expect(toast).toHaveBeenCalledWith(NODE_PLACEHOLDER_MESSAGE);
  });
});

describe("activateCanvasTabLink / openTraceLink", () => {
  afterEach(() => {
    delete window.penAgentPanel;
    vi.restoreAllMocks();
  });

  it("activates the tab through the panel bridge", () => {
    const activateTab = vi.fn();
    window.penAgentPanel = { version: 1, canvas: { activateTab } } as never;
    activateCanvasTabLink(4);
    expect(activateTab).toHaveBeenCalledWith(4);
  });

  it("says so when there is no panel bridge", () => {
    activateCanvasTabLink(4);
    expect(toast).toHaveBeenCalledWith(CANVAS_TAB_UNAVAILABLE_MESSAGE);
  });

  it("opens a local trace through the panel", () => {
    const open = vi.fn(async () => undefined);
    window.penAgentPanel = { version: 1, traces: { open } } as never;
    openTraceLink("t1", "local");
    expect(open).toHaveBeenCalledWith("t1");
  });

  it("falls back to the viewer route for a local trace without the panel", () => {
    const win = vi.spyOn(window, "open").mockReturnValue(null);
    openTraceLink("t 1", "local");
    expect(win).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}trace/t%201?src=local`, "_blank", "noopener");
  });

  it("opens a local trace through the desktop doc-page bridge without the panel", () => {
    const win = vi.spyOn(window, "open").mockReturnValue(null);
    const open = vi.fn(async () => ({ ok: true }));
    window.penDesktop = { traces: { open } } as never;
    openTraceLink("t1", "local");
    expect(open).toHaveBeenCalledWith("t1");
    expect(win).not.toHaveBeenCalled();
    delete window.penDesktop;
  });

  it("toasts when the desktop bridge reports a failure or rejects", async () => {
    window.penDesktop = { traces: { open: vi.fn(async () => ({ ok: false, error: "No such trace." })) } } as never;
    openTraceLink("t1", "local");
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("No such trace."));
    window.penDesktop = { traces: { open: vi.fn(async () => Promise.reject(new Error("boom"))) } } as never;
    openTraceLink("t1", "local");
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("boom"));
    window.penDesktop = { traces: { open: vi.fn(async () => ({ ok: false })) } } as never;
    openTraceLink("t1", "local");
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(TRACE_OPEN_FAILED_MESSAGE));
    delete window.penDesktop;
  });

  it("a canvas tab link in a document only toasts", () => {
    const activateTab = vi.fn();
    window.penAgentPanel = { version: 1, canvas: { activateTab } } as never;
    canvasTabInDocLink();
    expect(toast).toHaveBeenCalledWith(CANVAS_TAB_IN_DOC_MESSAGE);
    expect(activateTab).not.toHaveBeenCalled();
  });

  it("opens a cloud trace in a new window", () => {
    const win = vi.spyOn(window, "open").mockReturnValue(null);
    openTraceLink("t1", "cloud");
    expect(win).toHaveBeenCalledWith(expect.stringContaining("trace/t1?src=cloud"), "_blank", "noopener");
  });
});
