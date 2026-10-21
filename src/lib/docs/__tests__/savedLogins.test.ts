import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopLoginsApi } from "@/lib/desktopBridge";
import { addSavedLogin, cachedLoginIcon, ensureLoginIconsLoaded, filterLogins, loadSavedLogins, loginHost, resolveLoginHost, savedLoginsAvailable, subscribeLoginIcons, type SavedLogin } from "../savedLogins";

const ENTRIES: SavedLogin[] = [
  { id: "1", origin: "https://github.com", username: "alice", label: "Work GitHub" },
  { id: "2", origin: "https://mail.example.org:8443", username: "bob@example.org", label: "", icon: "data:image/png;base64,AA==" },
  { id: "3", origin: "https://github.com", username: "carol", label: "" },
];

function setBridge(logins: Partial<DesktopLoginsApi> | undefined) {
  window.penDesktop = logins ? ({ logins } as never) : undefined;
}

afterEach(() => setBridge(undefined));

describe("filterLogins", () => {
  it("returns everything for an empty query", () => {
    expect(filterLogins(ENTRIES, "  ")).toEqual(ENTRIES);
  });
  it("matches username, label and host, case-insensitively", () => {
    expect(filterLogins(ENTRIES, "ALI").map((e) => e.id)).toEqual(["1"]);
    expect(filterLogins(ENTRIES, "work").map((e) => e.id)).toEqual(["1"]);
    expect(filterLogins(ENTRIES, "github").map((e) => e.id)).toEqual(["1", "3"]);
  });
  it("needs every word to match", () => {
    expect(filterLogins(ENTRIES, "github carol").map((e) => e.id)).toEqual(["3"]);
    expect(filterLogins(ENTRIES, "github bob")).toEqual([]);
  });
});

describe("loginHost", () => {
  it("takes the host (port kept) of an origin or a bare domain", () => {
    expect(loginHost("https://mail.example.org:8443/x")).toBe("mail.example.org:8443");
    expect(loginHost("example.com")).toBe("example.com");
  });
});

describe("saved logins bridge", () => {
  it("is off without window.penDesktop.logins", async () => {
    expect(savedLoginsAvailable()).toBe(false);
    setBridge(undefined);
    expect((await loadSavedLogins()).ok).toBe(false);
    expect((await addSavedLogin({ site: "a.com", username: "u", password: "p" })).ok).toBe(false);
  });

  it("is on when list and add exist", () => {
    setBridge({ list: vi.fn(), add: vi.fn() });
    expect(savedLoginsAvailable()).toBe(true);
  });

  it("returns entries and remembers favicons", async () => {
    setBridge({ list: vi.fn().mockResolvedValue({ entries: ENTRIES, encryptionAvailable: true }), add: vi.fn() });
    expect(await loadSavedLogins()).toEqual({ ok: true, entries: ENTRIES });
    expect(cachedLoginIcon("2")).toBe("data:image/png;base64,AA==");
    expect(cachedLoginIcon("1")).toBeUndefined();
  });

  it("passes on a list error", async () => {
    setBridge({ list: vi.fn().mockResolvedValue({ ok: false, error: "Store is locked" }), add: vi.fn() });
    expect(await loadSavedLogins()).toEqual({ ok: false, error: "Store is locked" });
  });

  it("turns a rejected list into an error", async () => {
    setBridge({ list: vi.fn().mockRejectedValue(new Error("ipc closed")), add: vi.fn() });
    expect(await loadSavedLogins()).toEqual({ ok: false, error: "ipc closed" });
  });

  it("turns a rejected add into an error", async () => {
    setBridge({ list: vi.fn(), add: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(await addSavedLogin({ site: "a.com", username: "u", password: "p" })).toEqual({ ok: false, error: "boom" });
  });
});

describe("icon cache", () => {
  it("notifies subscribers when a list brings a new icon, once", async () => {
    const list = vi.fn().mockResolvedValue({ entries: [{ id: "i1", origin: "https://a.test", username: "u", label: "", icon: "data:image/png;base64,QQ==" }], encryptionAvailable: true });
    setBridge({ list, add: vi.fn() });
    const listener = vi.fn();
    const off = subscribeLoginIcons(listener);
    await loadSavedLogins();
    await loadSavedLogins();
    off();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cachedLoginIcon("i1")).toBe("data:image/png;base64,QQ==");
  });

  it("does nothing without the bridge", () => {
    expect(() => ensureLoginIconsLoaded()).not.toThrow();
  });
});

describe("resolveLoginHost", () => {
  it("takes the stored origin, port kept", async () => {
    setBridge({ list: vi.fn().mockResolvedValue({ entries: [{ id: "x", origin: "https://app.test:8443", username: "u", label: "" }], encryptionAvailable: true }), add: vi.fn() });
    expect(await resolveLoginHost("x", "https://www.typed.test")).toBe("app.test:8443");
  });
  it("falls back to the typed site when the entry is missing", async () => {
    setBridge({ list: vi.fn().mockResolvedValue({ entries: [], encryptionAvailable: true }), add: vi.fn() });
    expect(await resolveLoginHost("x", "https://typed.test/login")).toBe("typed.test");
  });
});

describe("ensureLoginIconsLoaded retry", () => {
  it("fetches again after a failure, but shares a fetch in flight", async () => {
    vi.resetModules();
    const mod = await import("../savedLogins");
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "busy" })
      .mockResolvedValue({ entries: [], encryptionAvailable: true });
    setBridge({ list, add: vi.fn() });
    mod.ensureLoginIconsLoaded();
    mod.ensureLoginIconsLoaded();
    expect(list).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    mod.ensureLoginIconsLoaded();
    await new Promise((r) => setTimeout(r, 0));
    expect(list).toHaveBeenCalledTimes(2);
    mod.ensureLoginIconsLoaded();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
