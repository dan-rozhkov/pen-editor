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

  it("selects on mousedown", () => {
    const p = setup();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Beta" }));
    expect(p.onSelect).toHaveBeenCalledWith("b");
    // The click after a mouse press (detail 1) must not select twice.
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }), { detail: 1 });
    expect(p.onSelect).toHaveBeenCalledTimes(1);
    // A keyboard activation is a click with no detail.
    fireEvent.click(screen.getByRole("tab", { name: "Alpha" }), { detail: 0 });
    expect(p.onSelect).toHaveBeenLastCalledWith("a");
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
    fireEvent.click(await screen.findByRole("menuitem", { name: /New Document/ }));
    expect(p.onNew).toHaveBeenCalledWith("doc");
  });
});

describe("TabStrip drag to reorder", () => {
  const origCapture = Element.prototype.setPointerCapture;
  afterEach(() => {
    Element.prototype.setPointerCapture = origCapture;
  });

  function setupDrag(tabs: WorkspaceTab[] = TABS) {
    Element.prototype.setPointerCapture = vi.fn();
    const onMove = vi.fn();
    const props = { onSelect: vi.fn(), onClose: vi.fn(), onHome: vi.fn(), onNew: vi.fn(), onSettings: vi.fn(), onMove };
    render(<TabStrip tabs={tabs} activeTabId="a" {...props} />);
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-ws-tab]"));
    // Three 100px tabs, 2px apart.
    els.forEach((el, i) => {
      el.getBoundingClientRect = () => ({ left: i * 102, right: i * 102 + 100, width: 100, top: 0, bottom: 28, height: 28, x: i * 102, y: 0, toJSON() {} });
    });
    const list = screen.getByRole("tablist");
    list.getBoundingClientRect = () => ({ left: 0, right: 400, width: 400, top: 0, bottom: 28, height: 28, x: 0, y: 0, toJSON() {} });
    return { onMove, els, props };
  }
  const ptr = (type: string, x: number, init: PointerEventInit = {}) =>
    new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, button: 0, buttons: type === "pointerup" ? 0 : 1, ...init });

  it("drops the first tab after the second: sends move with the tab it now sits before", () => {
    const { onMove, els } = setupDrag();
    fireEvent(els[0], ptr("pointerdown", 50));
    fireEvent(window, ptr("pointermove", 60));
    expect(els[0].classList.contains("dragging")).toBe(true);
    fireEvent(window, ptr("pointermove", 170)); // centre now at 170: past tab b's centre (152), before c's (254)
    fireEvent(window, ptr("pointerup", 170));
    expect(onMove).toHaveBeenCalledWith("a", "c");
    expect(els[0].classList.contains("dragging")).toBe(false);
    expect(els[0].style.transform).toBe("");
  });

  it("cancels the drag when the strip scrolls", () => {
    const { onMove, els } = setupDrag();
    fireEvent(els[0], ptr("pointerdown", 50));
    fireEvent(window, ptr("pointermove", 170));
    fireEvent.scroll(screen.getByRole("tablist"));
    fireEvent(window, ptr("pointerup", 170));
    expect(onMove).not.toHaveBeenCalled();
    expect(els[0].classList.contains("dragging")).toBe(false);
  });

  it("sends null when dropped past the last tab", () => {
    const { onMove, els } = setupDrag();
    fireEvent(els[0], ptr("pointerdown", 50));
    fireEvent(window, ptr("pointermove", 400));
    fireEvent(window, ptr("pointerup", 400));
    expect(onMove).toHaveBeenCalledWith("a", null);
  });

  it("does nothing for a small move, a cancel, a lost button, a touch pointer or the close button", () => {
    const { onMove, els } = setupDrag();
    fireEvent(els[0], ptr("pointerdown", 50));
    fireEvent(window, ptr("pointermove", 52));
    fireEvent(window, ptr("pointerup", 52));
    fireEvent(els[0], ptr("pointerdown", 50));
    fireEvent(window, ptr("pointermove", 200));
    fireEvent(window, ptr("pointercancel", 200));
    expect(els[0].classList.contains("dragging")).toBe(false);
    fireEvent(els[0], ptr("pointerdown", 50));
    fireEvent(window, ptr("pointermove", 200));
    fireEvent(window, ptr("pointermove", 210, { buttons: 0 }));
    expect(els[0].classList.contains("dragging")).toBe(false);
    fireEvent(els[0], ptr("pointerdown", 50, { pointerType: "touch" }));
    fireEvent(window, ptr("pointermove", 300));
    expect(els[0].classList.contains("dragging")).toBe(false);
    fireEvent(screen.getByRole("button", { name: "Close Alpha" }), ptr("pointerdown", 50));
    fireEvent(window, ptr("pointermove", 300));
    expect(els[0].classList.contains("dragging")).toBe(false);
    fireEvent(window, ptr("pointerup", 300));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not start with fewer than two tabs", () => {
    const { els, onMove } = setupDrag(TABS.slice(0, 1));
    fireEvent(els[0], ptr("pointerdown", 50));
    fireEvent(window, ptr("pointermove", 300));
    expect(els[0].classList.contains("dragging")).toBe(false);
    fireEvent(window, ptr("pointerup", 300));
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("TabStrip context menu", () => {
  it("closes a tab from the right-click menu and does not activate it", async () => {
    const p = setup("a");
    const tab = screen.getByRole("tab", { name: "Beta" }).parentElement as HTMLElement;
    fireEvent.mouseDown(tab, { button: 2 });
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.contextMenu(tab);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Close Tab" }));
    expect(p.onClose).toHaveBeenCalledWith("b");
  });
});

describe("TabStrip motion", () => {
  it("keeps a closed tab as an inert ghost that is not a tab, then removes it", () => {
    const props = { onSelect: vi.fn(), onClose: vi.fn(), onHome: vi.fn(), onNew: vi.fn(), onSettings: vi.fn() };
    const { rerender, container } = render(<TabStrip tabs={TABS} activeTabId="a" {...props} />);
    rerender(<TabStrip tabs={TABS.slice(1)} activeTabId="b" {...props} />);
    const ghost = container.querySelector(".ws-tab-ghost");
    expect(ghost?.getAttribute("aria-hidden")).toBe("true");
    expect(ghost?.hasAttribute("inert")).toBe(true);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(container.querySelector("[role=tablist]")?.firstElementChild).toBe(ghost);
  });

  it("does not animate the first render", () => {
    const { container } = render(<TabStrip tabs={TABS} activeTabId="a" onSelect={vi.fn()} onClose={vi.fn()} onHome={vi.fn()} onNew={vi.fn()} onSettings={vi.fn()} />);
    expect(container.querySelector(".entering, .ws-tab-ghost")).toBeNull();
  });
});

describe("TabStrip new active tab", () => {
  const proto = HTMLElement.prototype as { scrollIntoView?: unknown; animate?: unknown };
  const saved = { scroll: proto.scrollIntoView, animate: proto.animate };
  afterEach(() => {
    proto.scrollIntoView = saved.scroll;
    proto.animate = saved.animate;
  });

  it("scrolls again once the enter animation finishes", () => {
    const spy = vi.fn();
    const anims: { onfinish: (() => void) | null; oncancel: (() => void) | null }[] = [];
    proto.scrollIntoView = spy;
    proto.animate = vi.fn(() => {
      const anim = { onfinish: null, oncancel: null };
      anims.push(anim);
      return anim;
    });
    const props = { onSelect: vi.fn(), onClose: vi.fn(), onHome: vi.fn(), onNew: vi.fn(), onSettings: vi.fn() };
    const four: WorkspaceTab[] = [...TABS, { id: "d", kind: "doc", itemId: "d2", title: "Delta" }];
    const { rerender } = render(<TabStrip tabs={TABS} activeTabId="a" {...props} />);
    rerender(<TabStrip tabs={four} activeTabId="d" {...props} />);
    spy.mockClear();
    anims[0].onfinish?.();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.contexts[0] as HTMLElement).getAttribute("data-ws-tab")).toBe("d");
  });
});

describe("TabStrip panel toggle", () => {
  it.each([
    [false, "Hide agent panel"],
    [true, "Show agent panel"],
  ])("with panelCollapsed=%s the button reads %s and calls onTogglePanel", (panelCollapsed, name) => {
    const onTogglePanel = vi.fn();
    render(
      <TabStrip tabs={TABS} activeTabId="a" onSelect={vi.fn()} onClose={vi.fn()} onHome={vi.fn()} onNew={vi.fn()} onSettings={vi.fn()} panelCollapsed={panelCollapsed} onTogglePanel={onTogglePanel} />,
    );
    fireEvent.click(screen.getByRole("button", { name }));
    expect(onTogglePanel).toHaveBeenCalledOnce();
  });
});
