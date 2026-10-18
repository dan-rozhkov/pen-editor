import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = document.documentElement;
const fire = (key: string | null, newValue: string | null, area: Storage | null = localStorage) =>
  window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: area }));

describe("isEditorRoute", () => {
  it("matches editor routes under the base only", async () => {
    const { isEditorRoute } = await import("@/lib/uiTheme");
    expect(isEditorRoute("/app", "/")).toBe(true);
    expect(isEditorRoute("/app/x", "/")).toBe(true);
    expect(isEditorRoute("/c/abc", "/")).toBe(true);
    expect(isEditorRoute("/agent", "/")).toBe(false);
    expect(isEditorRoute("/", "/")).toBe(false);
    expect(isEditorRoute("/application", "/")).toBe(false);
    expect(isEditorRoute("/pen/app", "/pen/")).toBe(true);
    expect(isEditorRoute("/pen/agent", "/pen/")).toBe(false);
    expect(isEditorRoute("/app", "/pen/")).toBe(false);
  });
});

describe("cross-document theme sync", () => {
  const added: Array<[string, EventListenerOrEventListenerObject]> = [];
  const nativeAdd = window.addEventListener.bind(window);

  async function load(path: string) {
    vi.resetModules();
    window.history.pushState({}, "", path);
    const lib = await import("@/lib/uiTheme");
    lib.installUIThemeStorageSync();
    const store = await import("@/store/uiThemeStore");
    return { lib, store };
  }

  beforeEach(() => {
    localStorage.clear();
    root.classList.remove("dark", "disable-theme-transitions");
    vi.spyOn(window, "addEventListener").mockImplementation((t, l, o) => {
      if (t === "storage") added.push([t, l]);
      nativeAdd(t, l, o);
    });
  });
  afterEach(() => {
    for (const [t, l] of added.splice(0)) window.removeEventListener(t, l);
    vi.restoreAllMocks();
  });

  it("non-editor route follows: class + state, applied once, nothing written", async () => {
    const { store } = await load("/agent");
    const setItem = vi.spyOn(localStorage, "setItem");
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    fire("ui-theme", "dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(store.useUIThemeStore.getState().uiTheme).toBe("dark");
    expect(raf).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("store-less fallback flips the class without transitions", async () => {
    vi.resetModules();
    window.history.pushState({}, "", "/");
    const lib = await import("@/lib/uiTheme");
    lib.installUIThemeStorageSync();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    fire("ui-theme", "dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.classList.contains("disable-theme-transitions")).toBe(true);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it("editor route ignores remote events (theme, class, scene)", async () => {
    const { store } = await load("/app");
    const { useSceneStore } = await import("@/store/sceneStore");
    const bg = useSceneStore.getState().pageBackground;
    fire("ui-theme", "dark");
    fire(null, null);
    expect(store.useUIThemeStore.getState().uiTheme).toBe("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(useSceneStore.getState().pageBackground).toBe(bg);
  });

  it("filters by key and storageArea; key null means light, unwritten", async () => {
    const { store } = await load("/agent");
    fire("other", "dark");
    fire("ui-theme", "dark", sessionStorage);
    expect(store.useUIThemeStore.getState().uiTheme).toBe("light");
    fire("ui-theme", "dark");
    const setItem = vi.spyOn(localStorage, "setItem");
    fire(null, null);
    expect(store.useUIThemeStore.getState().uiTheme).toBe("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("persistence by source: user always, document on change, remote never", async () => {
    const { store } = await load("/app");
    const { setUITheme } = store.useUIThemeStore.getState();
    const setItem = vi.spyOn(localStorage, "setItem");
    setUITheme("light", { source: "document" }); // no-op: nothing to publish
    expect(setItem).not.toHaveBeenCalled();
    setUITheme("light", { source: "user" }); // stale tab: still publishes the choice
    expect(setItem).toHaveBeenCalledWith("ui-theme", "light");
    setItem.mockClear();
    setUITheme("dark", { source: "document" });
    expect(setItem).toHaveBeenCalledWith("ui-theme", "dark");
    setItem.mockClear();
    setUITheme("light", { source: "remote" });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("ignores events while an editor is mounted, even off an editor route; resumes after unmount", async () => {
    const { lib, store } = await load("/agent");
    const unmount = lib.registerMountedEditor();
    const unmountStrict = lib.registerMountedEditor(); // StrictMode double mount
    fire("ui-theme", "dark");
    expect(store.useUIThemeStore.getState().uiTheme).toBe("light");
    unmount();
    unmount(); // idempotent cleanup
    fire("ui-theme", "dark");
    expect(store.useUIThemeStore.getState().uiTheme).toBe("light"); // one editor still mounted
    unmountStrict();
    fire("ui-theme", "dark");
    expect(store.useUIThemeStore.getState().uiTheme).toBe("dark");
  });

  it("notifies applied-theme listeners (showcase theme-color) on a remote change", async () => {
    const { lib } = await load("/");
    const seen: string[] = [];
    const off = lib.onUIThemeApplied((t) => seen.push(t));
    fire("ui-theme", "dark");
    off();
    fire("ui-theme", "light");
    expect(seen).toEqual(["dark"]);
  });

  it("does not override a locked (embed) theme", async () => {
    const { store } = await load("/agent");
    store.setUIThemeTransient("dark");
    fire("ui-theme", "light");
    expect(store.useUIThemeStore.getState().uiTheme).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
  });
});
