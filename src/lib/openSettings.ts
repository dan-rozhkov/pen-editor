import { appHref, stripBase } from "@/lib/auth/paths";

export const SETTINGS_SECTIONS = ["account", "appearance", "canvas", "agent", "memory", "skills", "browser", "integrations", "privacy", "advanced", "shortcuts"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const DEFAULT_SETTINGS_SECTION: SettingsSection = "appearance";

/** An unknown or missing `section` query value falls back to the default. */
export function parseSettingsSection(value: string | null | undefined): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s === value) ?? DEFAULT_SETTINGS_SECTION;
}

/** Fired on `window` when openSettings() is called while the Settings page is already showing. */
export const SETTINGS_SECTION_EVENT = "pen:settings-section";

/** Named browser target: every web open reuses one Settings tab instead of piling up new ones. */
export const SETTINGS_WINDOW_NAME = "pen-settings";

/**
 * Opens Settings the way the host supports: the desktop shell's Settings tab
 * (agent panel first, then an editor tab), the page itself when it is already
 * showing, or a new browser tab on the web.
 */
export function openSettings(section?: SettingsSection): void {
  const bridge = window.penAgentPanel?.settings?.open ? window.penAgentPanel.settings : window.penDesktop?.settings;
  if (typeof bridge?.open === "function") {
    const warn = (reason: unknown) => console.warn("[openSettings] the desktop shell could not open Settings", reason);
    try {
      void Promise.resolve(bridge.open(section)).then((result) => {
        if (result && result.ok === false) warn(result);
      }, warn);
    } catch (error) {
      warn(error);
    }
    return;
  }
  if (stripBase(window.location.pathname) === "/settings") {
    if (section) window.dispatchEvent(new CustomEvent(SETTINGS_SECTION_EVENT, { detail: section }));
    return;
  }
  const query = section ? `?section=${section}` : "";
  window.open(appHref(`/settings${query}`), SETTINGS_WINDOW_NAME);
}
