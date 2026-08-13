import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  useLeftSidebarStore,
} from "@/store/leftSidebarStore";
import { LeftSidebarResizer } from "../LeftSidebarResizer";

/**
 * The resizer is a bare drag handle with no visible affordance; behaviour is
 * verified against the store (width changes) and document.body (cursor/
 * selection lock is applied while dragging and always restored after).
 */

function pointerDown(el: Element, clientX: number) {
  fireEvent.pointerDown(el, { button: 0, clientX, pointerId: 1 });
}

describe("<LeftSidebarResizer />", () => {
  beforeEach(() => {
    localStorage.clear();
    useLeftSidebarStore.getState().setWidth(LEFT_SIDEBAR_DEFAULT_WIDTH);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  afterEach(() => {
    cleanup();
  });

  it("drags the sidebar wider and narrower", () => {
    render(<LeftSidebarResizer />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    pointerDown(handle, 100);
    fireEvent.pointerMove(handle, { clientX: 150, pointerId: 1 });
    expect(useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH + 50);

    fireEvent.pointerMove(handle, { clientX: 80, pointerId: 1 });
    expect(useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH - 20);

    fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  it("clamps to the minimum width while dragging", () => {
    render(<LeftSidebarResizer />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    pointerDown(handle, 100);
    fireEvent.pointerMove(handle, { clientX: -10000, pointerId: 1 });
    expect(useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_MIN_WIDTH);
    fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  it("sets and restores the document cursor/selection lock across a drag", () => {
    render(<LeftSidebarResizer />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    expect(document.body.style.cursor).toBe("");
    pointerDown(handle, 100);
    expect(document.body.style.cursor).toBe("ew-resize");
    expect(document.body.style.userSelect).toBe("none");

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("restores the document cursor on unmount mid-drag", () => {
    const { unmount } = render(<LeftSidebarResizer />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    pointerDown(handle, 100);
    expect(document.body.style.cursor).toBe("ew-resize");

    unmount();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("ignores non-primary buttons", () => {
    render(<LeftSidebarResizer />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    fireEvent.pointerDown(handle, { button: 2, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
    expect(useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH);
  });

  it("ignores a second pointer landing mid-drag", () => {
    render(<LeftSidebarResizer />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    pointerDown(handle, 100);
    // A second finger must not re-capture the (already overridden) body styles,
    // or releasing it would restore "ew-resize" as if it were the original.
    fireEvent.pointerDown(handle, { button: 0, clientX: 400, pointerId: 2 });
    fireEvent.pointerUp(handle, { pointerId: 2 });
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("persists the width once the drag ends", () => {
    render(<LeftSidebarResizer />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    pointerDown(handle, 100);
    fireEvent.pointerMove(handle, { clientX: 150, pointerId: 1 });
    expect(localStorage.getItem("left-sidebar-width")).toBeNull();

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(localStorage.getItem("left-sidebar-width")).toBe(
      String(LEFT_SIDEBAR_DEFAULT_WIDTH + 50),
    );
  });

  it("double-click resets to the default width", () => {
    useLeftSidebarStore.getState().setWidth(500);
    render(<LeftSidebarResizer />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    fireEvent.doubleClick(handle);
    expect(useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH);
  });

  it("supports arrow-key resizing, with Shift for a finer step", () => {
    render(<LeftSidebarResizer />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH + 16);

    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH + 15);
  });
});
