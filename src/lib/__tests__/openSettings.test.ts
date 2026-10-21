import { afterEach, describe, expect, it, vi } from "vitest";

import { openSettings, parseSettingsSection, SETTINGS_SECTION_EVENT } from "@/lib/openSettings";

afterEach(() => {
  delete window.penAgentPanel;
  delete window.penDesktop;
  window.history.pushState({}, "", "/");
  vi.restoreAllMocks();
});

describe("parseSettingsSection", () => {
  it("accepts known ids and defaults the rest", () => {
    expect(parseSettingsSection("agent")).toBe("agent");
    expect(parseSettingsSection("bogus")).toBe("appearance");
    expect(parseSettingsSection(null)).toBe("appearance");
  });
});

describe("openSettings", () => {
  it("prefers the agent panel bridge", () => {
    const panel = vi.fn(async () => ({ ok: true }));
    const desktop = vi.fn();
    window.penAgentPanel = { version: 2, settings: { open: panel } };
    window.penDesktop = { settings: { open: desktop }, onMenuCommand: () => () => undefined };
    openSettings("agent");
    expect(panel).toHaveBeenCalledWith("agent");
    expect(desktop).not.toHaveBeenCalled();
  });

  it("then the desktop bridge", () => {
    const desktop = vi.fn();
    window.penDesktop = { settings: { open: desktop }, onMenuCommand: () => () => undefined };
    openSettings();
    expect(desktop).toHaveBeenCalledWith(undefined);
  });

  it("warns instead of leaving an unhandled rejection when the bridge rejects or answers ok:false", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    window.penDesktop = {
      settings: { open: vi.fn(async () => Promise.reject(new Error("ipc down"))) },
      onMenuCommand: () => () => undefined,
    };
    openSettings();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

    window.penDesktop = {
      settings: { open: vi.fn(async () => ({ ok: false })) },
      onMenuCommand: () => () => undefined,
    };
    openSettings("agent");
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));

    window.penDesktop = {
      settings: {
        open: vi.fn(() => {
          throw new Error("sync throw");
        }),
      },
      onMenuCommand: () => () => undefined,
    };
    expect(() => openSettings()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("changes the section in place when already on /settings", () => {
    window.history.pushState({}, "", "/settings");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const seen = vi.fn();
    window.addEventListener(SETTINGS_SECTION_EVENT, (e) => seen((e as CustomEvent).detail), { once: true });
    openSettings("canvas");
    expect(seen).toHaveBeenCalledWith("canvas");
    expect(open).not.toHaveBeenCalled();
  });

  it("falls back to a new browser tab", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openSettings("integrations");
    expect(open).toHaveBeenCalledWith("/settings?section=integrations", "pen-settings");
    openSettings();
    expect(open).toHaveBeenLastCalledWith("/settings", "pen-settings");
  });
});
