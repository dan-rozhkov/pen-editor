import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("../canvasFocusRequest", () => ({ requestCanvasFocus: vi.fn() }));
vi.mock("../docStore", () => ({ readDoc: vi.fn() }));

import { toast } from "sonner";
import { classifyHref, docLinkHref, nodeLinkHref } from "../docLinks";
import { DOC_MISSING_MESSAGE, DOC_PLACEHOLDER_MESSAGE, focusNodeLink, handleLinkClick, NODE_PLACEHOLDER_MESSAGE, openDocLink } from "../docLinkActions";
import { requestCanvasFocus } from "../canvasFocusRequest";
import { readDoc } from "../docStore";

beforeEach(() => vi.clearAllMocks());

describe("classifyHref", () => {
  it.each([
    ["/doc?id=doc_abc", { kind: "doc", id: "doc_abc" }],
    ["/doc?id=doc_abc&chat=off", { kind: "doc", id: "doc_abc" }],
    ["/app?node=n1", { kind: "node", id: "n1" }],
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
  });
});

describe("handleLinkClick", () => {
  it.each([
    ["/doc?id=d1", "openDoc", "d1"],
    ["/app?node=n1", "focusNode", "n1"],
    ["https://x.test", "openExternal", "https://x.test"],
  ] as const)("routes %s to %s", (href, method, arg) => {
    const actions = { openDoc: vi.fn(), focusNode: vi.fn(), openExternal: vi.fn() };
    handleLinkClick(href, actions);
    expect(actions[method]).toHaveBeenCalledWith(arg);
    const calls = Object.values(actions).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
    expect(calls).toBe(1);
  });

  it("does not throw when an action does", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => handleLinkClick("/doc?id=d1", { openDoc: () => { throw new Error("x"); }, focusNode: vi.fn(), openExternal: vi.fn() })).not.toThrow();
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
