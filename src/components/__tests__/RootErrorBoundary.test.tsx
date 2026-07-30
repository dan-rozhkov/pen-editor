import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RootErrorBoundary } from "@/components/RootErrorBoundary";
import { recoverFromFatalError } from "@/pwa/updateSelfHeal";

vi.mock("@/pwa/updateSelfHeal", () => ({
  recoverFromFatalError: vi.fn(),
}));

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
  // This is the whole point of the boundary: a render crash (the incident
  // that motivated this — a stale bundle throwing on a changed API shape)
  // must not just leave a blank #root. It also triggers the same recovery
  // that would otherwise depend on the tree that just failed to mount — see
  // updateSelfHeal.ts's module comment.
  it("renders a fallback and triggers recovery when a child throws while rendering", () => {
    render(
      <RootErrorBoundary>
        <Bomb />
      </RootErrorBoundary>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
    expect(recoverFromFatalError).toHaveBeenCalledTimes(1);
  });

  it("renders children normally when nothing throws", () => {
    render(
      <RootErrorBoundary>
        <div>all good</div>
      </RootErrorBoundary>,
    );

    expect(screen.getByText("all good")).toBeTruthy();
    expect(recoverFromFatalError).not.toHaveBeenCalled();
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
