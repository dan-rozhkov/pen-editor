import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RootErrorBoundary } from "@/components/RootErrorBoundary";

function Bomb(): never {
  throw new Error("boom");
}

// React logs the thrown error to the console by default (via its own
// internal error logging) on top of componentDidCatch — silence that noise,
// it isn't what these tests are checking.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RootErrorBoundary", () => {
  // This is the whole point of the boundary: a render crash must not just
  // leave a blank #root — it renders a static fallback with a Reload button.
  it("renders a fallback when a child throws while rendering", () => {
    render(
      <RootErrorBoundary>
        <Bomb />
      </RootErrorBoundary>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
  });

  it("renders children normally when nothing throws", () => {
    render(
      <RootErrorBoundary>
        <div>all good</div>
      </RootErrorBoundary>,
    );

    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("reloads the page when the Reload button is clicked", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });

    render(
      <RootErrorBoundary>
        <Bomb />
      </RootErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /reload/i }));

    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
