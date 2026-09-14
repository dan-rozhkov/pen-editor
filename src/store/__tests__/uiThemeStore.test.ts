import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIThemeStore } from "@/store/uiThemeStore";

describe("applyThemeWithoutTransitions (via useUIThemeStore.setUITheme)", () => {
  let rafCallback: FrameRequestCallback | null;
  let offsetHeightSpy: ReturnType<typeof vi.fn<() => number>>;
  let events: string[];

  beforeEach(() => {
    // Force the store back to "light" (using the real rAF/offsetHeight,
    // before the spies below are installed) so every test starts from the
    // same known state and its own setUITheme("dark") call actually fires
    // the subscribe listener — zustand's subscribe is a no-op when the
    // value doesn't change.
    useUIThemeStore.getState().setUITheme("light");
    document.documentElement.classList.remove("dark", "disable-theme-transitions");

    events = [];
    rafCallback = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        events.push("raf-scheduled");
        rafCallback = cb;
        return 1;
      }),
    );

    offsetHeightSpy = vi.fn(() => {
      events.push("offsetHeight-read");
      return 0;
    });
    Object.defineProperty(document.documentElement, "offsetHeight", {
      configurable: true,
      get: () => offsetHeightSpy(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(
      document.documentElement,
      "offsetHeight",
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
    );
    document.documentElement.classList.remove("dark", "disable-theme-transitions");
  });

  it("forces a reflow (reads offsetHeight) before the class is removed, and only removes it inside rAF", () => {
    useUIThemeStore.getState().setUITheme("dark");

    // Reflow was forced, and it happened before anything scheduled the
    // class removal.
    expect(offsetHeightSpy).toHaveBeenCalled();
    expect(events).toEqual(["offsetHeight-read", "raf-scheduled"]);

    // Class stays on synchronously — only rAF removes it.
    expect(document.documentElement.classList.contains("disable-theme-transitions")).toBe(
      true,
    );

    rafCallback?.(0);

    expect(document.documentElement.classList.contains("disable-theme-transitions")).toBe(
      false,
    );
  });

  it("reads offsetHeight while disable-theme-transitions is still applied and the new theme has already been applied", () => {
    let hadDisableClassDuringReflow = false;
    let hadDarkClassDuringReflow = false;
    Object.defineProperty(document.documentElement, "offsetHeight", {
      configurable: true,
      get: () => {
        hadDisableClassDuringReflow = document.documentElement.classList.contains(
          "disable-theme-transitions",
        );
        hadDarkClassDuringReflow = document.documentElement.classList.contains("dark");
        return 0;
      },
    });

    useUIThemeStore.getState().setUITheme("dark");

    // The reflow must happen after the theme mutation (so the flushed
    // recalc bakes in the new theme's styles) and before the class is
    // removed (so that recalc still has transitions disabled). Flushing
    // before the theme changes would let the class-add, theme mutation and
    // class removal collapse into a single recalc, and the transition would
    // run anyway.
    expect(hadDisableClassDuringReflow).toBe(true);
    expect(hadDarkClassDuringReflow).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
