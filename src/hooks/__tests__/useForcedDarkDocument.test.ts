import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useForcedDarkDocument } from "@/hooks/useForcedDarkDocument";
import { applyThemeWithoutTransitions, UI_THEME_STORAGE_KEY } from "@/lib/uiTheme";

const html = document.documentElement;

afterEach(() => {
  html.classList.remove("dark");
  localStorage.clear();
});

describe("useForcedDarkDocument", () => {
  it("darkens a light document while mounted and restores it on unmount", () => {
    const { unmount } = renderHook(() => useForcedDarkDocument());
    expect(html.classList.contains("dark")).toBe(true);
    unmount();
    expect(html.classList.contains("dark")).toBe(false);
  });

  it("leaves an already dark document dark after unmount", () => {
    html.classList.add("dark");
    const { unmount } = renderHook(() => useForcedDarkDocument());
    unmount();
    expect(html.classList.contains("dark")).toBe(true);
  });

  it("re-asserts dark after a light theme is applied, without writing the stored preference", () => {
    const { unmount } = renderHook(() => useForcedDarkDocument());
    applyThemeWithoutTransitions("light");
    expect(html.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(UI_THEME_STORAGE_KEY)).toBeNull();
    unmount();
    expect(html.classList.contains("dark")).toBe(false);
  });

  it("keeps dark on unmount when the dark theme was applied meanwhile", () => {
    const { unmount } = renderHook(() => useForcedDarkDocument());
    applyThemeWithoutTransitions("dark");
    unmount();
    expect(html.classList.contains("dark")).toBe(true);
  });
});
