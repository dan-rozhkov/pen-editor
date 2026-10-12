import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "pen.browserAgentSettings";

async function freshStore() {
  vi.resetModules();
  return import("../browserAgentSettingsStore");
}

beforeEach(() => localStorage.removeItem(KEY));
afterEach(() => vi.restoreAllMocks());

describe("browserAgentSettingsStore", () => {
  it("defaults to password OFF and confirm ON", async () => {
    const { getBrowserAgentPermissions } = await freshStore();
    expect(getBrowserAgentPermissions()).toEqual({
      allowPasswordEntry: false,
      confirmIrreversible: true,
    });
  });

  it("toggles each switch independently", async () => {
    const { useBrowserAgentSettingsStore, getBrowserAgentPermissions } = await freshStore();
    useBrowserAgentSettingsStore.getState().setAllowPasswordEntry(true);
    expect(getBrowserAgentPermissions()).toEqual({ allowPasswordEntry: true, confirmIrreversible: true });
    useBrowserAgentSettingsStore.getState().setConfirmIrreversible(false);
    expect(getBrowserAgentPermissions()).toEqual({ allowPasswordEntry: true, confirmIrreversible: false });
  });

  it("persists across a reload", async () => {
    const first = await freshStore();
    first.useBrowserAgentSettingsStore.getState().setAllowPasswordEntry(true);
    first.useBrowserAgentSettingsStore.getState().setConfirmIrreversible(false);
    const second = await freshStore();
    expect(second.getBrowserAgentPermissions()).toEqual({
      allowPasswordEntry: true,
      confirmIrreversible: false,
    });
  });

  it.each([
    ["corrupt JSON", "{nope"],
    ["wrong types", JSON.stringify({ allowPasswordEntry: "yes", confirmIrreversible: 0 })],
  ])("falls back to defaults on %s", async (_name, raw) => {
    localStorage.setItem(KEY, raw);
    const { getBrowserAgentPermissions } = await freshStore();
    expect(getBrowserAgentPermissions()).toEqual({ allowPasswordEntry: false, confirmIrreversible: true });
  });

  it("survives storage throwing on read and write", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { useBrowserAgentSettingsStore, getBrowserAgentPermissions } = await freshStore();
    expect(getBrowserAgentPermissions().confirmIrreversible).toBe(true);
    expect(() => useBrowserAgentSettingsStore.getState().setAllowPasswordEntry(true)).not.toThrow();
    expect(getBrowserAgentPermissions().allowPasswordEntry).toBe(true);
  });

  it("a setter keeps the other key's newer stored value", async () => {
    const { useBrowserAgentSettingsStore } = await freshStore();
    localStorage.setItem(KEY, JSON.stringify({ allowPasswordEntry: false, confirmIrreversible: false }));
    useBrowserAgentSettingsStore.getState().setAllowPasswordEntry(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      allowPasswordEntry: true,
      confirmIrreversible: false,
    });
  });

  it("syncs from another tab via the storage event", async () => {
    const { getBrowserAgentPermissions } = await freshStore();
    localStorage.setItem(KEY, JSON.stringify({ allowPasswordEntry: true, confirmIrreversible: false }));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(getBrowserAgentPermissions()).toEqual({ allowPasswordEntry: true, confirmIrreversible: false });
  });
});
