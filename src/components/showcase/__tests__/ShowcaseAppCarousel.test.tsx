import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShowcaseAppCarousel } from "@/components/showcase/ShowcaseAppCarousel";
import { accumulateWindow, getInitialWindow } from "@/components/showcase/carouselWindow";
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
    // Present on every screen in this suite so the lazy-mounting tests
    // exercise the window logic — a screen without `lqip` always loads
    // eagerly (see ShowcaseAppCarousel.tsx's `loadImage` comment).
    lqip: "data:image/webp;base64,AAAA",
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

describe("<ShowcaseAppCarousel /> lazy slide mounting", () => {
  beforeEach(() => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
  });

  it("mounts exactly 3 <img> elements for a 5-screen app (selected ± 1)", () => {
    const screens = ["a", "b", "c", "d", "e"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} />);

    // Embla doesn't run its layout/scroll machinery under happy-dom, so
    // `selectedIndex` stays at the initial 0 — the loaded window is
    // therefore {last, 0, 1} for a looped 5-slide carousel: screens
    // "e" (index 4), "a" (index 0), "b" (index 1).
    const images = Array.from(document.querySelectorAll("img"));
    expect(images.map((img) => img.getAttribute("alt")).sort()).toEqual([
      "Screen a",
      "Screen b",
      "Screen e",
    ]);
  });

  it("still renders a same-sized card for a slide outside the loaded window", () => {
    const screens = ["a", "b", "c", "d", "e"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} />);

    // Screen "c" (index 2) sits outside {4, 0, 1} for a 5-slide looped
    // carousel starting at index 0 — its card mounts but without an <img>.
    const farCard = screen
      .getByRole("button", { name: "Go to screen 3" })
      .closest("[data-slot=showcase-app-carousel]")
      ?.querySelectorAll('[data-slot="showcase-card"]')[2];
    expect(farCard).toBeTruthy();
    expect(farCard?.querySelector("img")).toBeNull();
  });

  it("loads every slide when a screen has no lqip yet (feature-detected, not permanently unmounted)", () => {
    const screens = ["a", "b", "c", "d", "e"].map((id) => makeScreen(id));
    // Simulate rows published before the WebP-derivatives backfill: no
    // `lqip` to show in place of the real image, so gating on the window
    // would leave a blank rectangle forever instead of a placeholder.
    screens.forEach((screen) => {
      screen.lqip = undefined;
    });
    render(<ShowcaseAppCarousel app={makeApp(screens)} />);

    expect(document.querySelectorAll("img").length).toBe(5);
  });

  it("marks only the first slide of the first-in-grid carousel as eager", () => {
    const screens = ["a", "b"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} isFirstInGrid />);

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute("fetchpriority")).toBe("high");
    expect(images[0].getAttribute("loading")).toBe("eager");
    expect(images[1].getAttribute("fetchpriority")).toBeNull();
    expect(images[1].getAttribute("loading")).toBe("lazy");
  });

  it("marks the selected slide loading=eager even when it isn't the first-in-grid card, and its neighbor stays lazy", () => {
    // Regression test for the prod bug: native loading="lazy" never defers a
    // carousel slide (Embla's overlapping-slide viewport defeats the
    // browser's own lazy heuristic), so every non-first carousel on the page
    // was stuck forever on its LQIP. The selected slide must load eagerly
    // regardless of grid position; fetchPriority stays reserved for the
    // true above-the-fold card (`isFirstInGrid` unset here).
    const screens = ["a", "b", "c"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} />);

    const selected = screen.getByAltText("Screen a");
    expect(selected.getAttribute("loading")).toBe("eager");
    expect(selected.getAttribute("fetchpriority")).toBeNull();

    const neighbor = screen.getByAltText("Screen b");
    expect(neighbor.getAttribute("loading")).toBe("lazy");
    expect(neighbor.getAttribute("fetchpriority")).toBeNull();
  });

  it("moves the eager slide to whichever slide becomes selected", () => {
    const screens = ["a", "b", "c"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} />);

    expect(screen.getByAltText("Screen a").getAttribute("loading")).toBe("eager");
    expect(screen.getByAltText("Screen b").getAttribute("loading")).toBe("lazy");

    fireEvent.click(screen.getByRole("button", { name: "Go to screen 2" }));

    expect(screen.getByAltText("Screen a").getAttribute("loading")).toBe("lazy");
    expect(screen.getByAltText("Screen b").getAttribute("loading")).toBe("eager");
  });

  it("does not carry a previous app's mounted window into a different screen set under the same instance", () => {
    // Both apps have >3 screens so each computes a real ±1 window (not the
    // length<=3 "show everything" branch) — if the accumulated window
    // leaked across the screensKey change, the second render would show
    // more than 3 images (its own window unioned with the stale one).
    const appA = makeApp(["a", "b", "c", "d", "e"].map((id) => makeScreen(id)));
    const { rerender } = render(<ShowcaseAppCarousel app={appA} />);
    expect(document.querySelectorAll("img").length).toBe(3);

    const appB = makeApp(
      ["v", "w", "x", "y", "z", "0", "1", "2", "3", "4"].map((id) => makeScreen(id)),
    );
    rerender(<ShowcaseAppCarousel app={appB} />);

    const images = Array.from(document.querySelectorAll("img"));
    // Window at selectedIndex 0 for a 10-slide looped carousel: {9, 0, 1}.
    expect(images.map((img) => img.getAttribute("alt")).sort()).toEqual([
      "Screen 4",
      "Screen v",
      "Screen w",
    ]);
  });
});

describe("getInitialWindow / accumulateWindow (pure window logic)", () => {
  // These exercise the actual fix for "return to an already-viewed slide
  // shows an empty card" directly: happy-dom's Embla instance never runs
  // real layout, so `selectedIndex` can't be driven through simulated
  // scrolling/dragging in a DOM-level test (see the file-level comment
  // above and the existing "existing controls" suite, which only checks
  // that clicking a dot doesn't misfire the copy handler).

  it("returns every index for 3 or fewer screens", () => {
    expect(getInitialWindow(3, 1)).toEqual(new Set([0, 1, 2]));
    expect(getInitialWindow(1, 0)).toEqual(new Set([0]));
  });

  it("returns the selected slide plus its wrap-around neighbors for more than 3 screens", () => {
    expect(getInitialWindow(5, 0)).toEqual(new Set([4, 0, 1]));
    expect(getInitialWindow(5, 2)).toEqual(new Set([1, 2, 3]));
    expect(getInitialWindow(5, 4)).toEqual(new Set([3, 4, 0]));
  });

  it("keeps a slide mounted after the window scrolls past it and back (the leave-and-return case)", () => {
    let mounted = getInitialWindow(5, 0); // {4, 0, 1} — carousel opens on slide 0
    mounted = accumulateWindow(mounted, getInitialWindow(5, 2)); // scroll to slide 2: window becomes {1, 2, 3}
    expect(mounted).toEqual(new Set([4, 0, 1, 2, 3]));

    // Scroll back toward the start: slide 2 is no longer in the *current*
    // window ({4, 0, 1}), but it was shown once, so it must stay mounted.
    mounted = accumulateWindow(mounted, getInitialWindow(5, 0));
    expect(mounted.has(2)).toBe(true);
    expect(mounted).toEqual(new Set([4, 0, 1, 2, 3]));
  });

  it("returns the same Set reference when the window contributes nothing new", () => {
    const mounted = new Set([0, 1, 2]);
    expect(accumulateWindow(mounted, new Set([1]))).toBe(mounted);
    expect(accumulateWindow(mounted, new Set([1, 5]))).not.toBe(mounted);
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
