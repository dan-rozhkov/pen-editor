import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { PresentOverlay } from "@/components/PresentOverlay";
import { useEditorModeStore } from "@/store/editorModeStore";

afterEach(() => cleanup());

describe("<PresentOverlay />", () => {
  beforeEach(() => {
    useEditorModeStore.setState({ mode: "present", presentFrameIds: ["a", "b", "c"], presentIndex: 1 });
  });

  it("shows a 1-based counter", () => {
    render(<PresentOverlay />);
    expect(screen.getByTestId("present-counter").textContent).toContain("2 / 3");
  });

  it("navigates and exits", () => {
    render(<PresentOverlay />);
    fireEvent.click(screen.getByTestId("present-next"));
    expect(useEditorModeStore.getState().presentIndex).toBe(2);
    fireEvent.click(screen.getByTestId("present-prev"));
    expect(useEditorModeStore.getState().presentIndex).toBe(1);
    fireEvent.click(screen.getByTestId("present-exit"));
    expect(useEditorModeStore.getState().mode).toBe("edit");
  });
});

describe("<PresentOverlay /> auto-hide on mouse idle", () => {
  beforeEach(() => {
    useEditorModeStore.setState({ mode: "present", presentFrameIds: ["a", "b", "c"], presentIndex: 1 });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function getPill() {
    return screen.getByTestId("present-counter").closest("[data-testid='present-pill']") as HTMLElement;
  }

  it("is visible immediately on mount", () => {
    render(<PresentOverlay />);
    expect(getPill().className).not.toMatch(/opacity-0/);
  });

  it("fades out after ~3s of no mouse movement", () => {
    render(<PresentOverlay />);
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(getPill().className).toMatch(/opacity-0/);
    expect(getPill().className).toMatch(/pointer-events-none/);
  });

  it("reappears and resets the timer on mousemove", () => {
    render(<PresentOverlay />);
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(getPill().className).toMatch(/opacity-0/);

    act(() => {
      fireEvent.mouseMove(window);
    });
    expect(getPill().className).not.toMatch(/opacity-0/);

    // Still visible just before the new timer would fire.
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(getPill().className).not.toMatch(/opacity-0/);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(getPill().className).toMatch(/opacity-0/);
  });

  it("stays visible while the pointer hovers the pill itself", () => {
    render(<PresentOverlay />);
    fireEvent.mouseEnter(getPill());
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(getPill().className).not.toMatch(/opacity-0/);

    fireEvent.mouseLeave(getPill());
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(getPill().className).toMatch(/opacity-0/);
  });

  it("clears the idle timer on unmount", () => {
    const { unmount } = render(<PresentOverlay />);
    unmount();
    expect(() => act(() => vi.advanceTimersByTime(5000))).not.toThrow();
  });
});
