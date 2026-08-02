export type UITheme = "light" | "dark";

export const UI_THEME_STORAGE_KEY = "ui-theme";

export function getStoredUITheme(): UITheme {
  const stored = localStorage.getItem(UI_THEME_STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

export function applyUITheme(theme: UITheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function getAppliedUITheme(): UITheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyStoredUITheme() {
  applyUITheme(getStoredUITheme());
}
