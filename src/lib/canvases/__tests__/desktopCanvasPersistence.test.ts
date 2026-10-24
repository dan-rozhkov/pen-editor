import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { usePageStore } from "@/store/pageStore";
import { useSceneStore } from "@/store/sceneStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { useDocumentStore } from "@/store/documentStore";
import { useThemeStore } from "@/store/themeStore";
import {
  deriveCanvasTitle,
  ensureCanvasIdInUrl,
  generateCanvasId,
  serializeLiveDocument,
  UNTITLED_CANVAS,
} from "../canvasIdentity";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  AUTOSAVE_RETRY_MS,
  OPEN_FAILED_MESSAGE,
  READY_CAP_MS,
  SAVE_FAILED_MESSAGE,
  isCanvasLoadPending,
  resetDesktopCanvasPersistenceForTests,
  startDesktopCanvasPersistence,
  whenCanvasLoadReady,
} from "../desktopCanvasPersistence";
import { toast } from "sonner";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { buildLiveDocumentData, collectDocumentData } from "@/lib/commands/fileCommands";
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import type { DesktopCanvasesApi, StoredCanvas } from "@/lib/desktopBridge";

function resetPages(): void {
  // Start from the store's own default page so no page literal is repeated here.
  const base = usePageStore.getState().pages[0];
  usePageStore.setState({
    pages: [{ ...base, id: "p1", name: "Page 1", nodesById: {}, parentById: {}, childrenById: {}, rootIds: [] }],
    activePageId: "p1",
  });
}

function setUrl(search: string, hash = ""): void {
  window.history.replaceState(null, "", `/app${search}${hash}`);
}

function stubBridge(over: Partial<DesktopCanvasesApi> = {}) {
  const read = vi.fn<NonNullable<DesktopCanvasesApi["read"]>>(async () => ({ canvas: null }));
  const save = vi.fn<NonNullable<DesktopCanvasesApi["save"]>>(async (c) => ({ ok: true as const, rev: c.rev }));
  const api: DesktopCanvasesApi = { read, save, ...over };
  (window as unknown as { penDesktop?: unknown }).penDesktop = { canvases: api };
  return { read, save };
}

/** Makes the next save hang until the returned function is called. */
function holdNextSave(save: ReturnType<typeof stubBridge>["save"]): () => void {
  let release: () => void = () => {};
  save.mockImplementationOnce((c) => new Promise((r) => (release = () => r({ ok: true as const, rev: c.rev }))));
  return () => release();
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Lets the post-apply settle (macrotask + frame cap) of a stored-canvas restore finish. */
async function settled(): Promise<void> {
  await flushMicrotasks();
  await vi.advanceTimersByTimeAsync(250);
}

async function typeNode(name = "A"): Promise<void> {
  useSceneStore.getState().addNode({
    id: `n_${Math.random().toString(36).slice(2)}`,
    type: "rect",
    name,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    fill: "#000",
  } as never);
}

describe("canvas identity", () => {
  beforeEach(() => {
    resetStores();
    resetPages();
  });
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => setUrl(""));

  it("generates cv_ ids that satisfy the shell's id pattern", () => {
    const id = generateCanvasId();
    expect(id).toMatch(/^cv_[a-z0-9]{16}$/);
    expect(generateCanvasId()).not.toBe(id);
  });

  it("adds ?canvas= keeping other params and the hash", () => {
    setUrl("?chat=off&x=1", "#h");
    const id = ensureCanvasIdInUrl();
    const url = new URL(window.location.href);
    expect(url.searchParams.get("canvas")).toBe(id);
    expect(url.searchParams.get("chat")).toBe("off");
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.hash).toBe("#h");
    expect(url.pathname).toBe("/app");
  });

  it("keeps an existing valid id and replaces an invalid one", () => {
    setUrl("?canvas=cv_abc");
    expect(ensureCanvasIdInUrl()).toBe("cv_abc");
    setUrl("?canvas=bad%20id");
    const id = ensureCanvasIdInUrl();
    expect(id).toMatch(/^cv_/);
    expect(new URL(window.location.href).searchParams.get("canvas")).toBe(id);
  });
});

describe("canvas id across in-app navigation", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => setUrl(""));

  it("keeps the id in sessionStorage and re-adds it after a navigation dropped the query", () => {
    setUrl("?canvas=cv_keep");
    expect(ensureCanvasIdInUrl()).toBe("cv_keep");
    setUrl("");
    expect(ensureCanvasIdInUrl()).toBe("cv_keep");
    expect(new URL(window.location.href).searchParams.get("canvas")).toBe("cv_keep");
  });

  it("prefers the URL param over sessionStorage", () => {
    window.sessionStorage.setItem("pen.canvasId", "cv_old");
    setUrl("?canvas=cv_new");
    expect(ensureCanvasIdInUrl()).toBe("cv_new");
    setUrl("");
    expect(ensureCanvasIdInUrl()).toBe("cv_new");
  });

  it("still works when sessionStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const id = ensureCanvasIdInUrl();
    expect(id).toMatch(/^cv_/);
    expect(new URL(window.location.href).searchParams.get("canvas")).toBe(id);
    spy.mockRestore();
    set.mockRestore();
  });
});

describe("buildLiveDocumentData", () => {
  beforeEach(() => {
    resetStores();
    resetPages();
  });

  it("matches collectDocumentData but does not write pageStore", () => {
    seedScene();
    const pagesBefore = usePageStore.getState().pages;
    const live = buildLiveDocumentData();
    expect(usePageStore.getState().pages).toBe(pagesBefore);
    expect(live.pages[0].nodes.length).toBeGreaterThan(0);
    expect(collectDocumentData()).toEqual(live);
    expect(usePageStore.getState().pages).not.toBe(pagesBefore);
  });
});

describe("deriveCanvasTitle", () => {
  beforeEach(() => {
    resetStores();
    resetPages();
  });

  it("falls back to Untitled canvas", () => {
    expect(deriveCanvasTitle()).toBe(UNTITLED_CANVAS);
  });

  it("uses the first top-level frame name", () => {
    seedScene();
    expect(deriveCanvasTitle()).toBe("Screen");
  });

  it("prefers the file name without extension, trimmed and capped", () => {
    seedScene();
    useDocumentStore.setState({ fileName: "  My design.pen " });
    expect(deriveCanvasTitle()).toBe("My design");
    useDocumentStore.setState({ fileName: `${"x".repeat(300)}.pen` });
    expect(deriveCanvasTitle()).toHaveLength(200);
  });
});

describe("startDesktopCanvasPersistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
    resetPages();
    resetDesktopCanvasPersistenceForTests();
    window.sessionStorage.clear();
    vi.mocked(toast.error).mockClear();
    useEditorModeStore.setState({ mode: "edit" });
    useSharedViewStore.setState({ isSharedView: false });
    setUrl("?chat=off&canvas=cv_test");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as unknown as { penDesktop?: unknown }).penDesktop;
    setUrl("");
  });

  it("is a no-op without the bridge, on an older shell, in view mode and in the shared viewer", () => {
    expect(startDesktopCanvasPersistence()).toBeUndefined();
    expect(window.location.search).toBe("?chat=off&canvas=cv_test");

    (window as unknown as { penDesktop?: unknown }).penDesktop = { canvases: { list: vi.fn() } };
    expect(startDesktopCanvasPersistence()).toBeUndefined();

    const { read } = stubBridge();
    useEditorModeStore.setState({ mode: "view" });
    expect(startDesktopCanvasPersistence()).toBeUndefined();
    useEditorModeStore.setState({ mode: "edit" });
    setUrl("?canvas=cv_test");
    useSharedViewStore.setState({ isSharedView: true });
    expect(startDesktopCanvasPersistence()).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("writes the id into the URL when absent", () => {
    setUrl("?chat=off");
    const { read } = stubBridge();
    const stop = startDesktopCanvasPersistence()!;
    const id = new URL(window.location.href).searchParams.get("canvas");
    expect(id).toMatch(/^cv_/);
    expect(read).toHaveBeenCalledWith(id);
    stop();
  });

  it("does not save before read resolves, then saves after the debounce", async () => {
    let resolveRead!: (v: { canvas: null }) => void;
    const { read, save } = stubBridge();
    read.mockImplementation(() => new Promise((r) => (resolveRead = r as never)));
    const stop = startDesktopCanvasPersistence()!;
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 3);
    expect(save).not.toHaveBeenCalled();

    resolveRead({ canvas: null });
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0][0];
    expect(sent.id).toBe("cv_test");
    expect(sent.rev).toBe(1);
    expect(sent.title).toBe(UNTITLED_CANVAS);
    expect(JSON.parse(sent.document).pages[0].nodes.length).toBeGreaterThan(0);
    stop();
  });

  it("never saves after a read error or rejection", async () => {
    const { read, save } = stubBridge();
    read.mockResolvedValue({ error: "boom" });
    let stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 3);
    expect(save).not.toHaveBeenCalled();
    stop();

    read.mockRejectedValue(new Error("ipc"));
    stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 3);
    expect(save).not.toHaveBeenCalled();
    stop();
  });

  it("applies a stored canvas and continues from its rev", async () => {
    seedScene();
    const document = serializeLiveDocument();
    resetStores();
    resetPages();
    const stored: StoredCanvas = { id: "cv_test", title: "T", updatedAt: 1, rev: 7, document };
    const { read, save } = stubBridge();
    read.mockResolvedValue({ canvas: stored });
    const stop = startDesktopCanvasPersistence()!;
    await settled();
    expect(useSceneStore.getState().nodesById["rect1"]).toBeDefined();

    // Loading itself must not cause a save.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 3);
    expect(save).not.toHaveBeenCalled();

    useSceneStore.getState().updateNode("rect1", { x: 55 } as never);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].rev).toBe(8);
    expect(save.mock.calls[0][0].title).toBe("Screen");
    stop();
  });

  it("coalesces rapid changes into one save and skips identical content", async () => {
    const { save } = stubBridge();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(500);
    await typeNode();
    await vi.advanceTimersByTimeAsync(500);
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 10);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledTimes(1);

    // A store update with unchanged content writes nothing.
    useDocumentStore.setState({ fileName: null });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps one save in flight and runs another for a change made meanwhile", async () => {
    const { save } = stubBridge();
    let release!: () => void;
    save.mockImplementationOnce(
      (c) => new Promise((r) => (release = () => r({ ok: true as const, rev: c.rev }))),
    );
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);

    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].rev).toBe(2);
    stop();
  });

  it("does not save a blank canvas, but keeps saving once something was stored", async () => {
    const { save } = stubBridge();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    useDocumentStore.setState({ fileName: "x.pen" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).not.toHaveBeenCalled();

    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);

    useSceneStore.setState({ nodesById: {}, parentById: {}, childrenById: {}, rootIds: [], _cachedTree: null });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(2);
    expect(JSON.parse(save.mock.calls[1][0].document).pages[0].nodes).toEqual([]);
    stop();
  });

  it("adopts the disk rev on a stale answer and retries", async () => {
    const { save } = stubBridge();
    save.mockResolvedValueOnce({ ok: true, stale: true, rev: 10 });
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].rev).toBe(11);
    stop();
  });

  it("flushes on pagehide without waiting for the debounce, and stops after teardown", async () => {
    const { save } = stubBridge();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    window.dispatchEvent(new Event("pagehide"));
    expect(save).toHaveBeenCalledTimes(1);
    await flushMicrotasks();

    stop();
    await typeNode();
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushes the pending save on teardown", async () => {
    const { save } = stubBridge();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    stop();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not save on teardown without unsaved changes or before the load finished", async () => {
    const { read, save } = stubBridge();
    let stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    stop();
    expect(save).not.toHaveBeenCalled();

    read.mockImplementation(() => new Promise(() => {}));
    resetDesktopCanvasPersistenceForTests();
    stop = startDesktopCanvasPersistence()!;
    await typeNode();
    stop();
    expect(save).not.toHaveBeenCalled();
  });

  it("saves at most AUTOSAVE_MAX_WAIT_MS after the first change under continuous changes", async () => {
    const { save } = stubBridge();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    for (let t = 0; t < AUTOSAVE_MAX_WAIT_MS - 500; t += 500) {
      await typeNode();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(save).not.toHaveBeenCalled();
    await typeNode();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    stop();
  });

  it("ignores UI-only store changes", async () => {
    const { save } = stubBridge();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);
    const serialize = vi.spyOn(JSON, "stringify");
    useSceneStore.setState({ expandedFrameIds: new Set(["x"]) });
    usePageStore.setState({ pages: usePageStore.getState().pages.map((p) => ({ ...p, viewport: { scale: 2, x: 1, y: 1 } })) });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(serialize).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stores the document compact", async () => {
    const { save } = stubBridge();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save.mock.calls[0][0].document).not.toContain("\n");
    stop();
  });

  it("does not change the UI chrome theme when restoring", async () => {
    seedScene();
    useThemeStore.setState({ activeTheme: "dark" });
    const document = serializeLiveDocument();
    resetStores();
    resetPages();
    useUIThemeStore.setState({ uiTheme: "light" });
    const { read } = stubBridge();
    read.mockResolvedValue({ canvas: { id: "cv_test", title: "T", updatedAt: 1, rev: 1, document } });
    const stop = startDesktopCanvasPersistence()!;
    await settled();
    expect(useSceneStore.getState().nodesById["rect1"]).toBeDefined();
    expect(useThemeStore.getState().activeTheme).toBe("dark");
    expect(useUIThemeStore.getState().uiTheme).toBe("light");
    stop();
  });

  it("a remount with the same id reuses the loaded canvas instead of reading and applying again", async () => {
    seedScene();
    const document = serializeLiveDocument();
    resetStores();
    resetPages();
    const { read, save } = stubBridge();
    read.mockResolvedValue({ canvas: { id: "cv_test", title: "T", updatedAt: 1, rev: 3, document } });
    let stop = startDesktopCanvasPersistence()!;
    await settled();
    useSceneStore.getState().updateNode("rect1", { x: 77 } as never);
    stop();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);

    // router navigate('/app') dropped the query: the id comes back from sessionStorage
    setUrl("");
    stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    expect(new URL(window.location.href).searchParams.get("canvas")).toBe("cv_test");
    expect(read).toHaveBeenCalledTimes(1);
    expect((useSceneStore.getState().nodesById["rect1"] as { x: number }).x).toBe(77);

    useSceneStore.getState().updateNode("rect1", { x: 78 } as never);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].rev).toBe(5);
    stop();
  });

  it("a remount during the read shares one read and one apply (StrictMode)", async () => {
    const { read } = stubBridge();
    startDesktopCanvasPersistence()!();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    expect(read).toHaveBeenCalledTimes(1);
    stop();
  });

  it("forks to a NEW id when the scene got nodes during the read: the stored canvas is never overwritten", async () => {
    seedScene();
    const document = serializeLiveDocument();
    resetStores();
    resetPages();
    let resolveRead!: (v: unknown) => void;
    const { read, save } = stubBridge();
    read.mockImplementation(() => new Promise((r) => (resolveRead = r)) as never);
    const stop = startDesktopCanvasPersistence()!;
    await typeNode("live");
    resolveRead({ canvas: { id: "cv_test", title: "T", updatedAt: 1, rev: 4, document } });
    await settled();
    expect(useSceneStore.getState().nodesById["rect1"]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0][0];
    expect(sent.id).not.toBe("cv_test");
    expect(sent.id).toMatch(/^cv_/);
    expect(sent.rev).toBe(1);
    expect(new URL(window.location.href).searchParams.get("canvas")).toBe(sent.id);
    expect(window.sessionStorage.getItem("pen.canvasId")).toBe(sent.id);
    expect(save.mock.calls.every((c) => c[0].id !== "cv_test")).toBe(true);
    stop();
  });

  it("forks on remount when the stores were replaced while App was unmounted", async () => {
    const { save } = stubBridge();
    let stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode("mine");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);
    stop();

    // shared viewer replaced the document while the editor was unmounted
    seedScene();
    stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    const forkedId = new URL(window.location.href).searchParams.get("canvas");
    expect(forkedId).not.toBe("cv_test");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].id).toBe(forkedId);
    expect(save.mock.calls[1][0].rev).toBe(1);
    expect(save.mock.calls.filter((c) => c[0].id === "cv_test")).toHaveLength(1);
    stop();
  });

  it("does not fork on remount when the stores did not change", async () => {
    stubBridge();
    startDesktopCanvasPersistence()!();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    expect(new URL(window.location.href).searchParams.get("canvas")).toBe("cv_test");
    stop();
  });

  it("window.penCanvasFlush saves pending content and resolves after the reply; no-op when clean; removed on teardown", async () => {
    const { save } = stubBridge();
    const release = holdNextSave(save);
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    expect(typeof window.penCanvasFlush).toBe("function");
    await window.penCanvasFlush!(); // nothing pending: at once
    expect(save).not.toHaveBeenCalled();

    await typeNode();
    let done = false;
    const flushed = window.penCanvasFlush!().then(() => (done = true));
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    release();
    await flushed;
    expect(done).toBe(true);

    // a change made while a save is in flight: flush waits for it and saves the change too
    const release2 = holdNextSave(save);
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(2);
    await typeNode();
    await vi.advanceTimersByTimeAsync(10);
    const flushed2 = window.penCanvasFlush!();
    release2();
    await flushed2;
    expect(save).toHaveBeenCalledTimes(3);

    stop();
    expect(window.penCanvasFlush).toBeUndefined();
  });

  it("window.penCanvasFlush never rejects, and a stale teardown does not remove a newer flush", async () => {
    const { save } = stubBridge();
    save.mockRejectedValue(new Error("ipc"));
    const stopA = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    const stopB = startDesktopCanvasPersistence()!;
    const flushB = window.penCanvasFlush;
    await typeNode();
    await expect(window.penCanvasFlush!()).resolves.toBeUndefined();
    stopA();
    expect(window.penCanvasFlush).toBe(flushB);
    stopB();
  });

  it("flushes on teardown for a change made during an in-flight save", async () => {
    const { save } = stubBridge();
    const release = holdNextSave(save);
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10); // save() sees inFlight: dirty, no timer
    expect(save).toHaveBeenCalledTimes(1);
    stop();
    expect(save).toHaveBeenCalledTimes(2);
    release();
  });

  it("starts when the editor enters edit mode later", async () => {
    stubBridge();
    useEditorModeStore.setState({ mode: "view" });
    expect(startDesktopCanvasPersistence()).toBeUndefined();
    useEditorModeStore.setState({ mode: "edit" });
    const stop = startDesktopCanvasPersistence();
    expect(stop).toBeTypeOf("function");
    stop!();
  });

  it("rolls the rev back only when it is still the rev this save sent", async () => {
    const { save } = stubBridge();
    let failFirst!: () => void;
    save.mockImplementationOnce(
      () => new Promise((r) => (failFirst = () => r({ error: "disk full" } as never))),
    );
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10); // rev 1 in flight
    await typeNode();
    window.dispatchEvent(new Event("pagehide")); // forced overlapping save: rev 2
    await flushMicrotasks();
    expect(save.mock.calls.map((c) => c[0].rev)).toEqual([1, 2]);
    failFirst(); // rev 1 fails after rev 2 was sent: must not undo rev 2
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_MS + 10);
    expect(save.mock.calls.at(-1)![0].rev).toBe(3);
    stop();
  });

  it("takes the baseline after the post-apply settle, so later normalization is not an edit", async () => {
    seedScene();
    const document = serializeLiveDocument();
    resetStores();
    resetPages();
    const { read, save } = stubBridge();
    read.mockResolvedValue({ canvas: { id: "cv_test", title: "T", updatedAt: 1, rev: 2, document } });
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    expect(isCanvasLoadPending()).toBe(true); // still settling
    expect(useSceneStore.getState().nodesById["rect1"]).toBeDefined();
    // a layout pass after the apply, before the baseline
    useSceneStore.getState().updateNode("rect1", { x: 123 } as never);
    await settled();
    expect(isCanvasLoadPending()).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 3);
    expect(save).not.toHaveBeenCalled();
    stop();
  });

  it("never writes a zero-page document", async () => {
    const { save } = stubBridge();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    usePageStore.setState({ pages: [] });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).not.toHaveBeenCalled();
    stop();
  });

  it("does not serialize when no subscribed slice changed since the last save", async () => {
    const { save } = stubBridge();
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);
    const serialize = vi.spyOn(JSON, "stringify");
    window.dispatchEvent(new Event("pagehide"));
    await flushMicrotasks();
    expect(serialize).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    stop();
  });

  it("whenCanvasLoadReady resolves at once when inactive, after the read, and at the cap", async () => {
    expect(isCanvasLoadPending()).toBe(false);
    await whenCanvasLoadReady();

    let resolveRead!: (v: unknown) => void;
    const { read } = stubBridge();
    read.mockImplementation(() => new Promise((r) => (resolveRead = r)) as never);
    const stop = startDesktopCanvasPersistence()!;
    expect(isCanvasLoadPending()).toBe(true);
    let done = false;
    void whenCanvasLoadReady().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(READY_CAP_MS - 10);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(true);

    done = false;
    void whenCanvasLoadReady().then(() => (done = true));
    resolveRead({ canvas: null });
    await flushMicrotasks();
    expect(done).toBe(true);
    expect(isCanvasLoadPending()).toBe(false);
    stop();
  });

  it("tells the user once when the canvas cannot be read", async () => {
    const { read } = stubBridge();
    read.mockResolvedValue({ error: "boom" });
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    expect(toast.error).toHaveBeenCalledWith(OPEN_FAILED_MESSAGE);
    expect(toast.error).toHaveBeenCalledTimes(1);
    stop();
  });

  it("tells the user once about repeated save failures, retries, and re-arms after a success", async () => {
    const { save } = stubBridge();
    save.mockResolvedValue({ error: "disk full" });
    const stop = startDesktopCanvasPersistence()!;
    await flushMicrotasks();
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(toast.error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000 + 10);
    expect(save).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith(SAVE_FAILED_MESSAGE);
    await vi.advanceTimersByTimeAsync(5000 + 10);
    expect(save).toHaveBeenCalledTimes(3);
    expect(toast.error).toHaveBeenCalledTimes(1);

    save.mockImplementation(async (c) => ({ ok: true as const, rev: c.rev }));
    await vi.advanceTimersByTimeAsync(5000 + 10);
    save.mockResolvedValue({ error: "disk full" });
    await typeNode();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    await vi.advanceTimersByTimeAsync(5000 + 10);
    expect(toast.error).toHaveBeenCalledTimes(2);
    stop();
  });
});
