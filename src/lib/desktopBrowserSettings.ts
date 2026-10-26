import type { DesktopBrowserSettings } from "@/lib/desktopBridge";

export type { DesktopBrowserSettings };

/** True when the desktop shell exposes the built-in browser switches (Settings tab of a recent shell only). */
export function hasDesktopBrowserSettings(): boolean {
  return typeof window !== "undefined" && !!window.penDesktop?.browserSettings;
}

function unwrap(result: DesktopBrowserSettings | { error: string }): DesktopBrowserSettings {
  if ("error" in result) throw new Error(result.error);
  return result;
}

/** Reads the current switches. Rejects on a shell error or when the API is absent. */
export async function getDesktopBrowserSettings(): Promise<DesktopBrowserSettings> {
  const api = window.penDesktop?.browserSettings;
  if (!api) throw new Error("Browser settings are unavailable");
  return unwrap(await api.get());
}

/** Applies a patch and resolves the saved switches. Rejects on a shell error or when the API is absent. */
export async function setDesktopBrowserSettings(patch: Partial<DesktopBrowserSettings>): Promise<DesktopBrowserSettings> {
  const api = window.penDesktop?.browserSettings;
  if (!api) throw new Error("Browser settings are unavailable");
  return unwrap(await api.set(patch));
}
