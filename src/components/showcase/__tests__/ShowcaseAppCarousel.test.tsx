import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShowcaseAppCarousel } from "@/components/showcase/ShowcaseAppCarousel";
import type { ShowcaseApp } from "@/components/showcase/showcaseApps";
import type { ShowcaseScreen } from "@/lib/showcase";

// Clicking a slide is meant to copy `screen.id` to the clipboard, for
// `npm run showcase:pin -- --screen <uuid>` on the backend. Drag-vs-click
// suppression is Embla's own job (its DragHandler swallows the native click
// event once a drag crosses its distance threshold, via a capture-phase
// listener on the carousel root — see ShowcaseAppCarousel.tsx) and isn't
// reproducible here: happy-dom has no real pointer/layout model for Embla to
// compute a drag distance against, so that path is exercised only by hand /
// e2e, not this suite.

function makeScreen(id: string): ShowcaseScreen {
  return {
    id,
    runId: "run-1",
    theme: "dark",
    title: `Screen ${id}`,
    model: "test/model",
    imageUrl: `https://example.com/${id}.png`,
    htmlUrl: `https://example.com/${id}.html`,
    width: 390,
    height: 844,
    createdAt: "2026-07-28T00:00:00.000Z",
  };
}

function makeApp(screens: ShowcaseScreen[]): ShowcaseApp {
  return { runId: "run-1", screens };
}

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("<ShowcaseAppCarousel /> copy-id-on-click", () => {
  it("copies the clicked screen's id to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<ShowcaseAppCarousel app={makeApp([makeScreen("screen-a")])} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy screen id: Screen screen-a" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("screen-a"));
  });

  it("shows a transient success confirmation after copying", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<ShowcaseAppCarousel app={makeApp([makeScreen("screen-a")])} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy screen id: Screen screen-a" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("ID copied");
  });

  it("clears the confirmation after ~2s and does not leak the timer", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<ShowcaseAppCarousel app={makeApp([makeScreen("screen-a")])} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy screen id: Screen screen-a" }));
    // Flush the microtask queue so the clipboard promise resolves and the
    // resulting setState is applied, without relying on testing-library's
    // timer-driven waitFor/findBy (which fake timers would stall).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("status")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows an error confirmation when the clipboard promise rejects, without throwing", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    stubClipboard(writeText);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<ShowcaseAppCarousel app={makeApp([makeScreen("screen-a")])} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy screen id: Screen screen-a" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Couldn't copy");
  });

  it("shows an error confirmation when navigator.clipboard is unavailable, without throwing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    render(<ShowcaseAppCarousel app={makeApp([makeScreen("screen-a")])} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy screen id: Screen screen-a" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Couldn't copy");
  });
});

describe("<ShowcaseAppCarousel /> existing controls", () => {
  beforeEach(() => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
  });

  it("keeps the screen selector dots working alongside the click-to-copy target", () => {
    render(
      <ShowcaseAppCarousel app={makeApp([makeScreen("screen-a"), makeScreen("screen-b")])} />,
    );

    const goToScreen2 = screen.getByRole("button", { name: "Go to screen 2" });
    expect(goToScreen2.getAttribute("aria-current")).toBeNull();
    fireEvent.click(goToScreen2);
    // Clicking the dot must not trigger a clipboard copy.
    expect(screen.queryByRole("status")).toBeNull();
  });
});
