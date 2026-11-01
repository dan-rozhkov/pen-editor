import { useLayoutEffect } from "react";

import { getAppliedUITheme, onUIThemeApplied, type UITheme } from "@/lib/uiTheme";

/**
 * Keeps <html> in the dark theme while the calling page is mounted, for pages
 * that are dark-only (the landing). The `.dark` class on the page root is not
 * enough: portaled popups (selects, menus, tooltips, toasts) render outside it
 * and would pick up light tokens when the stored UI theme is light.
 *
 * The stored `ui-theme` preference is never written. A theme switch elsewhere
 * re-asserts `.dark` right after it is applied; on unmount `.dark` is removed
 * only if this hook added it and the theme applied meanwhile is light.
 */
export function useForcedDarkDocument(): void {
  useLayoutEffect(() => {
    const html = document.documentElement;
    let appliedTheme: UITheme = getAppliedUITheme();
    let added = false;

    const assertDark = () => {
      if (html.classList.contains("dark")) return;
      html.classList.add("dark");
      added = true;
    };
    assertDark();

    const off = onUIThemeApplied((theme) => {
      appliedTheme = theme;
      assertDark();
    });

    return () => {
      off();
      if (added && appliedTheme === "light") html.classList.remove("dark");
    };
  }, []);
}
