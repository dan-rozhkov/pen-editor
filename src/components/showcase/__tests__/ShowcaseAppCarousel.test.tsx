import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShowcaseAppCarousel } from "@/components/showcase/ShowcaseAppCarousel";
import { accumulateWindow, getInitialWindow } from "@/components/showcase/carouselWindow";
import type { ShowcaseApp, ShowcaseScreen } from "@/lib/showcase";

// This is a real native scroll-snap scroller now (no Embla), so clicking a
// card is a plain click — there is no drag-vs-click suppression to reason
// about here anymore.
//
// happy-dom implements neither layout nor `Element.prototype.scrollTo`/
// `scrollBy` (scrolling a real element throws "not implemented"), so every
// test that would depend on real geometry (which screen is "centred", where
// an arrow/dot scrolls to) stubs `scrollBy`/`scrollTo` and asserts on the
// call arguments instead of on the resulting scroll position. Real
// snap-centering behaviour is covered by e2e (showcase-smoke.spec.ts).

function makeScreen(id: string): ShowcaseScreen {
  return {
    id,
    title: `Screen ${id}`,
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
  return {
    runId: "run-1",
    theme: "dark",
    // The model badge reads this app-level field — screens no longer carry
    // theme/model at all.
    model: "test/model",
    createdAt: "2026-07-28T00:00:00.000Z",
    screens,
  };
}

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

// happy-dom has no layout engine, so every element reports a zero rect.
// Stub `getBoundingClientRect` on the given elements with the rects we want
// the component's "which screen is centred"/"stride" math to see.
function stubRect(el: Element, rect: Partial<DOMRect>) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON() {
      return this;
    },
    ...rect,
  } as DOMRect);
}

beforeEach(() => {
  // happy-dom throws "not implemented" for these; stub on the prototype so
  // every scroller element in a test picks them up without individual setup.
  Element.prototype.scrollBy = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});

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

describe("<ShowcaseAppCarousel /> scroll-snap markup", () => {
  beforeEach(() => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
  });

  it("renders a single native scroller with the required scroll-snap classes", () => {
    render(
      <ShowcaseAppCarousel app={makeApp([makeScreen("screen-a"), makeScreen("screen-b")])} />,
    );

    const scroller = screen.getByRole("list", { name: "Screen screen-a screens" });
    expect(scroller.tagName).toBe("OL");
    for (const cls of [
      "overflow-x-auto",
      "overflow-y-hidden",
      "snap-x",
      "snap-mandatory",
      "scroll-smooth",
      "overscroll-x-contain",
      "scrollbar-none",
    ]) {
      expect(scroller.classList.contains(cls)).toBe(true);
    }
  });

  it("renders one <li> per screen with the item snap classes and aria labels", () => {
    render(
      <ShowcaseAppCarousel app={makeApp([makeScreen("screen-a"), makeScreen("screen-b")])} />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("aria-label")).toBe("Screen 1 of 2");
    expect(items[1].getAttribute("aria-label")).toBe("Screen 2 of 2");
    for (const cls of ["w-full", "shrink-0", "snap-center", "snap-always"]) {
      expect(items[0].classList.contains(cls)).toBe(true);
    }
  });
});

describe("<ShowcaseAppCarousel /> lazy slide mounting", () => {
  beforeEach(() => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
  });

  it("mounts exactly 2 <img> elements for a 5-screen app (selected ± 1, clamped)", () => {
    const screens = ["a", "b", "c", "d", "e"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} />);

    // happy-dom has no layout, so the scroll measurement bails and
    // `selectedIndex` stays at 0. The native scroller does not loop, so the
    // window at index 0 is clamped to {0, 1} — screens "a" and "b".
    const images = Array.from(document.querySelectorAll("img"));
    expect(images.map((img) => img.getAttribute("alt")).sort()).toEqual([
      "Screen a",
      "Screen b",
    ]);
  });

  it("still renders a same-sized card for a slide outside the loaded window", () => {
    const screens = ["a", "b", "c", "d", "e"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} />);

    // Screen "c" (index 2) sits outside {0, 1} — its card mounts but
    // without an <img>.
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

  // Selection is no longer something a click can set directly: the native
  // scroller derives it from where the content actually sits, so this drives
  // it the way the browser would — stub the geometry so the second item is
  // the one centred, then fire the scroller's own `scroll` event. rAF is made
  // synchronous so the throttled measurement runs inside `act`.
  it("moves the eager slide to whichever slide becomes selected", () => {
    const screens = ["a", "b", "c"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} />);

    expect(screen.getByAltText("Screen a").getAttribute("loading")).toBe("eager");
    expect(screen.getByAltText("Screen b").getAttribute("loading")).toBe("lazy");

    const scroller = screen.getByRole("list", { name: "Screen a screens" });
    const items = screen.getAllByRole("listitem");
    stubRect(scroller, { left: 0, width: 400 });
    stubRect(items[0], { left: -432, width: 400 });
    stubRect(items[1], { left: 0, width: 400 });
    stubRect(items[2], { left: 432, width: 400 });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByRole("button", { name: "Go to screen 2" }).getAttribute("aria-current")).toBe(
      "true",
    );
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
    expect(document.querySelectorAll("img").length).toBe(2);

    const appB = makeApp(
      ["v", "w", "x", "y", "z", "0", "1", "2", "3", "4"].map((id) => makeScreen(id)),
    );
    rerender(<ShowcaseAppCarousel app={appB} />);

    const images = Array.from(document.querySelectorAll("img"));
    // Window at selectedIndex 0 for a 10-slide non-looping scroller: {0, 1}.
    expect(images.map((img) => img.getAttribute("alt")).sort()).toEqual([
      "Screen v",
      "Screen w",
    ]);
  });
});

describe("getInitialWindow / accumulateWindow (pure window logic)", () => {
  // These exercise the actual fix for "return to an already-viewed slide
  // shows an empty card" directly: happy-dom runs no layout at all, so
  // `selectedIndex` can't be driven through simulated scrolling in a
  // DOM-level test (see the file-level comment above and the existing
  // "existing controls" suite, which only checks that clicking a dot
  // doesn't misfire the copy handler).

  it("returns every index for 3 or fewer screens", () => {
    expect(getInitialWindow(3, 1)).toEqual(new Set([0, 1, 2]));
    expect(getInitialWindow(1, 0)).toEqual(new Set([0]));
  });

  // The scroller does not loop (a native scroll container cannot), so the
  // window clamps at both ends instead of wrapping.
  it("returns the selected slide plus its clamped neighbors for more than 3 screens", () => {
    expect(getInitialWindow(5, 0)).toEqual(new Set([0, 1]));
    expect(getInitialWindow(5, 2)).toEqual(new Set([1, 2, 3]));
    expect(getInitialWindow(5, 4)).toEqual(new Set([3, 4]));
  });

  it("keeps a slide mounted after the window scrolls past it and back (the leave-and-return case)", () => {
    let mounted = getInitialWindow(5, 0); // {0, 1} — the scroller opens on slide 0
    mounted = accumulateWindow(mounted, getInitialWindow(5, 2)); // scroll to slide 2: window becomes {1, 2, 3}
    expect(mounted).toEqual(new Set([0, 1, 2, 3]));

    // Scroll back to the start: slide 2 is no longer in the *current*
    // window ({0, 1}), but it was shown once, so it must stay mounted.
    mounted = accumulateWindow(mounted, getInitialWindow(5, 0));
    expect(mounted.has(2)).toBe(true);
    expect(mounted).toEqual(new Set([0, 1, 2, 3]));
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

  it("scrolls the matching item into view (centred) when a dot is clicked", () => {
    render(
      <ShowcaseAppCarousel app={makeApp([makeScreen("screen-a"), makeScreen("screen-b")])} />,
    );

    const scroller = screen.getByRole("list", { name: "Screen screen-a screens" });
    const items = screen.getAllByRole("listitem");
    stubRect(scroller, { left: 0, width: 400 });
    stubRect(items[0], { left: 0, width: 400 });
    stubRect(items[1], { left: 432, width: 400 });

    fireEvent.click(screen.getByRole("button", { name: "Go to screen 2" }));

    expect(scroller.scrollBy).toHaveBeenCalledWith({ left: 432, behavior: "smooth" });
  });

  // At an end of the track an arrow stays mounted and is marked
  // `aria-disabled` with a no-op handler — it is neither unmounted (that would
  // drop keyboard focus to <body> the moment a keyboard user reaches the last
  // screen) nor given the native `disabled` attribute (`Button`'s
  // `disabled:opacity-50` outranks the `opacity-0` that keeps arrows hidden
  // until hover, leaving a dead arrow permanently visible). Embla never hit
  // any of this because it looped.
  it("scrolls by one item stride on the next arrow, and marks the spent arrow aria-disabled", () => {
    render(
      <ShowcaseAppCarousel app={makeApp([makeScreen("screen-a"), makeScreen("screen-b")])} />,
    );

    const scroller = screen.getByRole("list", { name: "Screen screen-a screens" });
    const items = screen.getAllByRole("listitem");
    stubRect(scroller, { left: 0, width: 400 });
    stubRect(items[0], { left: 0, width: 400 });
    stubRect(items[1], { left: 432, width: 400 });
    Object.defineProperty(scroller, "scrollWidth", { value: 832, configurable: true });
    Object.defineProperty(scroller, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(scroller, "scrollLeft", { value: 0, configurable: true, writable: true });

    const next = screen.getByRole("button", { name: "Next screen" });
    fireEvent.click(next);
    expect(scroller.scrollBy).toHaveBeenCalledWith({ left: 432, behavior: "smooth" });

    // Sitting at scrollLeft 0 there is nowhere to go back to, so "previous"
    // is still focusable but inert.
    const prev = screen.getByRole("button", { name: "Previous screen" });
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    (scroller.scrollBy as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(prev);
    expect(scroller.scrollBy).not.toHaveBeenCalled();
  });

  it("does not render arrows or dots for a single-screen app", () => {
    render(<ShowcaseAppCarousel app={makeApp([makeScreen("screen-a")])} />);

    expect(screen.queryByRole("button", { name: "Next screen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous screen" })).toBeNull();
    expect(screen.queryByLabelText("Screen selector")).toBeNull();
  });
});

describe("<ShowcaseAppCarousel /> off-centre fade", () => {
  // Queue rAF callbacks and run them on demand rather than calling them
  // inline: the component throttles with `rafId = requestAnimationFrame(...)`,
  // and a mock that invokes the callback synchronously runs `measure` (which
  // clears the handle) *before* the assignment lands — leaving a stale handle
  // that swallows every later scroll. Deferring keeps the real ordering.
  let pendingFrames: FrameRequestCallback[] = [];

  function flushFrames() {
    const frames = pendingFrames;
    pendingFrames = [];
    for (const frame of frames) frame(0);
  }

  beforeEach(() => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    pendingFrames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      pendingFrames.push(cb);
      return pendingFrames.length;
    });
  });

  // Measured off mobbin.com/discover/apps/ios/latest, which writes an inline
  // opacity per slide per scroll frame: `max(0, 1 - |offset| / stride)`, where
  // offset is the slide's centre relative to the scroller's and stride is the
  // distance between snap points. The peek at the scroller's edges is a faded
  // hint of the next screen, not a hard-clipped crop.
  it("fades each slide linearly with its distance from the scroller's centre", () => {
    const screens = ["a", "b", "c"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} />);

    const scroller = screen.getByRole("list", { name: "Screen a screens" });
    const items = screen.getAllByRole("listitem");
    // Items are 400 wide on a 432 stride (a 32px gap), laid out with the
    // middle one centred in a 400-wide scroller — i.e. resting on a snap
    // point. Centres: -232, 200, 632.
    stubRect(items[0], { left: -432, width: 400 });
    stubRect(items[1], { left: 0, width: 400 });
    stubRect(items[2], { left: 432, width: 400 });

    stubRect(scroller, { left: 0, width: 400 }); // centre 200 → on slide 1
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
      flushFrames();
    });

    expect(items[1].style.opacity).toBe("1.000");
    // Exactly one stride out, so fully faded — and it never goes negative.
    expect(items[0].style.opacity).toBe("0.000");
    expect(items[2].style.opacity).toBe("0.000");

    // Now halfway between two snap points: both neighbours sit half a stride
    // from the centre and are equally half-faded, which is the cross-fade you
    // see mid-swipe.
    stubRect(scroller, { left: 216, width: 400 }); // centre 416
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
      flushFrames();
    });

    expect(items[1].style.opacity).toBe("0.500");
    expect(items[2].style.opacity).toBe("0.500");
    expect(items[0].style.opacity).toBe("0.000");
  });

  it("leaves slides untouched when there is no layout to measure", () => {
    const screens = ["a", "b"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} />);

    // happy-dom reports a zero-width scroller, so the measurement bails before
    // touching any style — slides must not be left invisible.
    for (const item of screen.getAllByRole("listitem")) {
      expect(item.style.opacity).toBe("");
    }
  });
});
