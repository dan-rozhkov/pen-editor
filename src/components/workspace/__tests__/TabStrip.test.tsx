import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TabStrip } from "../TabStrip";
import type { WorkspaceTab } from "@/lib/workspace/tabsModel";

const TABS: WorkspaceTab[] = [
  { id: "a", kind: "canvas", itemId: "cv_1", title: "Alpha" },
  { id: "b", kind: "doc", itemId: "d1", title: "Beta" },
  { id: "c", kind: "workflow", itemId: "w1", title: "" },
];

function setup(activeTabId: string | null = "a") {
  const props = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onHome: vi.fn(),
    onNew: vi.fn(),
    onSettings: vi.fn(),
  };
  render(<TabStrip tabs={TABS} activeTabId={activeTabId} {...props} />);
  return props;
}

afterEach(cleanup);

describe("TabStrip scrolling", () => {
  const proto = HTMLElement.prototype as { scrollIntoView?: unknown };
  const original = proto.scrollIntoView;
  afterEach(() => {
    proto.scrollIntoView = original;
  });

  it("scrolls the active tab into view when it changes", () => {
    const spy = vi.fn();
    proto.scrollIntoView = spy;
    const props = { onSelect: vi.fn(), onClose: vi.fn(), onHome: vi.fn(), onNew: vi.fn(), onSettings: vi.fn() };
    const { rerender } = render(<TabStrip tabs={TABS} activeTabId="a" {...props} />);
    spy.mockClear();
    rerender(<TabStrip tabs={TABS} activeTabId="c" {...props} />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect((spy.mock.contexts[0] as HTMLElement).getAttribute("data-tab-id")).toBe("c");
  });

  it("does not throw where scrollIntoView is missing", () => {
    proto.scrollIntoView = undefined;
    expect(() => setup("b")).not.toThrow();
  });
});

describe("TabStrip", () => {
  it("renders a tablist with aria-selected and a title fallback", () => {
    setup("b");
    expect(screen.getByRole("tablist")).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(screen.getByRole("tab", { name: "Untitled" })).toBeTruthy();
  });

  it("selects on click", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(p.onSelect).toHaveBeenCalledWith("b");
  });

  it("closes through the close button", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close Beta" }));
    expect(p.onClose).toHaveBeenCalledWith("b");
  });

  it("moves focus with the arrow keys, wrapping around, and closes with Delete", () => {
    const p = setup("a");
    const [a, b, c] = screen.getAllByRole("tab");
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c, { key: "End" });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(b, { key: "Delete" });
    expect(p.onClose).toHaveBeenCalledWith("b");
  });

  it("uses a roving tab stop on the active tab", () => {
    setup("b");
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
  });

  it("calls home and settings", () => {
    const p = setup(null);
    expect(screen.getByRole("button", { name: "Start page" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Start page" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(p.onHome).toHaveBeenCalled();
    expect(p.onSettings).toHaveBeenCalled();
  });

  it("opens the new-tab menu", async () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /New document/ }));
    expect(p.onNew).toHaveBeenCalledWith("doc");
  });
});
