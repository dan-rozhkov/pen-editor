import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// Module-mock pattern mirrors src/lib/__tests__/bridgeBootstrap.test.ts.
const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  track: trackMock,
}));

// ShowcaseAppCarousel calls useNavigate() (FIR-62's "Open in Editor"), which
// throws outside a Router — same stub ShowcaseAppCarousel.test.tsx uses.
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

import { ShowcaseAppCarousel } from "@/components/showcase/ShowcaseAppCarousel";
import type { ShowcaseApp, ShowcaseScreen } from "@/lib/showcase";

function makeScreen(id: string): ShowcaseScreen {
  return {
    id,
    title: `Screen ${id}`,
    imageUrl: `https://example.com/${id}.png`,
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
    model: "test/model",
    createdAt: "2026-07-28T00:00:00.000Z",
    likes: 0,
    platform: "mobile",
    screens,
  };
}

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

// Queue rAF callbacks and run them on demand rather than calling them
// inline — mirrors ShowcaseAppCarousel.test.tsx's "off-centre fade" suite.
// The component throttles with `rafId = requestAnimationFrame(measure)`; a
// mock that invokes `measure` synchronously runs it (which clears the
// handle) *before* that assignment lands, leaving a stale non-null handle
// that silently swallows every later scroll. Deferring keeps the real
// ordering, which matters here since these tests dispatch several scrolls.
let pendingFrames: FrameRequestCallback[] = [];
function flushFrames() {
  const frames = pendingFrames;
  pendingFrames = [];
  for (const frame of frames) frame(0);
}

beforeEach(() => {
  Element.prototype.scrollBy = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  pendingFrames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    pendingFrames.push(cb);
    return pendingFrames.length;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  trackMock.mockClear();
});

describe("ShowcaseAppCarousel showcase_screen_viewed debounce", () => {
  it("does not fire for the initially-visible screen", async () => {
    // Restrict fake timers to setTimeout (the debounce) — Vitest's default
    // fake-timer set also swaps out requestAnimationFrame, which would clash
    // with the synchronous rAF stub installed in beforeEach below.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const screens = ["a", "b", "c"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} feedPosition={0} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(trackMock).not.toHaveBeenCalledWith(
      "showcase_screen_viewed",
      expect.anything(),
    );
  });

  it("emits one event per settled screen rather than one per scroll event during a fast swipe", async () => {
    // Restrict fake timers to setTimeout (the debounce) — Vitest's default
    // fake-timer set also swaps out requestAnimationFrame, which would clash
    // with the synchronous rAF stub installed in beforeEach below.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const screens = ["a", "b", "c"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} feedPosition={3} />);

    const carouselScroller = screen.getByRole("list", { name: "Screen a screens" });
    const items = screen.getAllByRole("listitem");
    stubRect(carouselScroller, { left: 0, width: 400 });
    stubRect(items[0], { left: -432, width: 400 });
    stubRect(items[1], { left: 0, width: 400 });
    stubRect(items[2], { left: 432, width: 400 });

    // A fast swipe fires several scroll events in quick succession — each
    // one re-triggers the measurement (rAF is synchronous here), which must
    // debounce down to a single tracked view of wherever it settles, not one
    // per frame. Move the scroller's rect between dispatches so the settled
    // index actually changes mid-swipe (1 -> 2), the way a real drag would.
    act(() => {
      carouselScroller.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
    act(() => {
      vi.advanceTimersByTime(100);
      stubRect(carouselScroller, { left: 216, width: 400 });
      carouselScroller.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
    act(() => {
      vi.advanceTimersByTime(100);
      stubRect(carouselScroller, { left: 432, width: 400 });
      carouselScroller.dispatchEvent(new Event("scroll"));
      flushFrames();
    });

    expect(trackMock).not.toHaveBeenCalledWith(
      "showcase_screen_viewed",
      expect.anything(),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const screenViewedCalls = trackMock.mock.calls.filter(
      ([event]) => event === "showcase_screen_viewed",
    );
    expect(screenViewedCalls).toHaveLength(1);
    expect(screenViewedCalls[0][1]).toEqual({ app_id: "run-1", screen_index: 2 });
  });

  it("does not re-emit for a screen already credited as viewed", async () => {
    // Restrict fake timers to setTimeout (the debounce) — Vitest's default
    // fake-timer set also swaps out requestAnimationFrame, which would clash
    // with the synchronous rAF stub installed in beforeEach below.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const screens = ["a", "b", "c"].map((id) => makeScreen(id));
    render(<ShowcaseAppCarousel app={makeApp(screens)} feedPosition={0} />);

    const carouselScroller = screen.getByRole("list", { name: "Screen a screens" });
    const items = screen.getAllByRole("listitem");
    stubRect(carouselScroller, { left: 0, width: 400 });
    stubRect(items[0], { left: -432, width: 400 });
    stubRect(items[1], { left: 0, width: 400 });
    stubRect(items[2], { left: 432, width: 400 });

    act(() => {
      carouselScroller.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(
      trackMock.mock.calls.filter(([event]) => event === "showcase_screen_viewed"),
    ).toHaveLength(1);

    trackMock.mockClear();

    // Scrolling back to a previously-viewed screen (index 1, which was
    // already the resting point after the swipe above) must not re-fire.
    act(() => {
      carouselScroller.dispatchEvent(new Event("scroll"));
      flushFrames();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(
      trackMock.mock.calls.filter(([event]) => event === "showcase_screen_viewed"),
    ).toHaveLength(0);
  });
});
