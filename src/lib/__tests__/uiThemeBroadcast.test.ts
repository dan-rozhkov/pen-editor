import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = document.documentElement;

// Same-origin BroadcastChannel stand-in: delivers to every OTHER instance of the name, like the real one.
class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  name: string;
  constructor(name: string) {
    this.name = name;
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all) {
      if (c !== this && c.name === this.name) c.onmessage?.({ data } as MessageEvent);
    }
  }
  close() {}
}

describe("theme BroadcastChannel sync", () => {
  beforeEach(() => {
    FakeChannel.all = [];
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    vi.resetModules();
    localStorage.clear();
    root.classList.remove("dark");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a user choice is posted; an editor route applies it as remote and does not write", async () => {
    // Settings tab: its own module instance posts.
    const settings = await import("@/store/uiThemeStore");
    settings.useUIThemeStore.getState().setUITheme("dark", { source: "user" });
    expect(FakeChannel.all).toHaveLength(1);

    // Another document: a fresh module graph, sitting on an editor route.
    vi.resetModules();
    window.history.pushState({}, "", "/app");
    const lib = await import("@/lib/uiTheme");
    const editorStore = await import("@/store/uiThemeStore");
    lib.registerMountedEditor();
    lib.installUIThemeBroadcastSync();
    const setItem = vi.spyOn(localStorage, "setItem");
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);

    // The Settings tab posts again; the editor ignores `storage` but follows this channel.
    FakeChannel.all[0].postMessage({ theme: "dark" });
    expect(editorStore.useUIThemeStore.getState().uiTheme).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("only user-sourced changes are posted", async () => {
    const { useUIThemeStore } = await import("@/store/uiThemeStore");
    const lib = await import("@/lib/uiTheme");
    const post = vi.spyOn(lib, "postUserTheme");
    useUIThemeStore.getState().setUITheme("dark", { source: "document" });
    useUIThemeStore.getState().setUITheme("light", { source: "remote" });
    expect(FakeChannel.all.every((c) => c.onmessage === null)).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores malformed messages", async () => {
    const lib = await import("@/lib/uiTheme");
    const { useUIThemeStore } = await import("@/store/uiThemeStore");
    lib.installUIThemeBroadcastSync();
    const sender = new FakeChannel("pen-ui-theme");
    sender.postMessage({ theme: "purple" });
    sender.postMessage(null);
    expect(useUIThemeStore.getState().uiTheme).toBe("light");
  });
});
