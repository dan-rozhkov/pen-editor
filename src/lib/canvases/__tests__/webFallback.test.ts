import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/test/fixtures";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import {
  OTHER_WINDOW_NOTICE,
  OPEN_FAILED_MESSAGE,
  resetDesktopCanvasPersistenceForTests,
  startDesktopCanvasPersistence,
} from "../desktopCanvasPersistence";
import { OTHER_WINDOW_MESSAGE, releaseWebCanvasLock, webCanvasStore } from "../webCanvasStore";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("../webCanvasStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../webCanvasStore")>();
  return { ...actual, releaseWebCanvasLock: vi.fn() };
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setParent(value: unknown): void {
  Object.defineProperty(window, "parent", { configurable: true, value });
}

describe("persistence bridge selection", () => {
  let readSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetStores();
    resetDesktopCanvasPersistenceForTests();
    useEditorModeStore.setState({ mode: "edit" });
    window.history.replaceState(null, "", "/app?canvas=cv_web");
    readSpy = vi.spyOn(webCanvasStore, "read").mockResolvedValue({ canvas: null });
  });
  afterEach(() => {
    delete (window as unknown as { parent?: unknown }).parent;
    delete (window as unknown as { penDesktop?: unknown }).penDesktop;
    resetDesktopCanvasPersistenceForTests();
    vi.restoreAllMocks();
  });

  it("is a no-op on a plain top-level web page", () => {
    expect(startDesktopCanvasPersistence()).toBeUndefined();
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("uses the web store when framed by /workspace", () => {
    setParent({ location: { pathname: "/workspace", origin: window.location.origin } });
    const stop = startDesktopCanvasPersistence();
    expect(stop).toBeTypeOf("function");
    expect(readSpy).toHaveBeenCalledWith("cv_web");
    stop?.();
  });

  it("lets the desktop bridge win even when framed", () => {
    setParent({ location: { pathname: "/workspace", origin: window.location.origin } });
    const read = vi.fn(async () => ({ canvas: null }));
    (window as unknown as { penDesktop?: unknown }).penDesktop = { canvases: { read, save: vi.fn() } };
    const stop = startDesktopCanvasPersistence();
    expect(read).toHaveBeenCalledWith("cv_web");
    expect(readSpy).not.toHaveBeenCalled();
    stop?.();
  });

  const stops: Array<(() => void) | undefined> = [];
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop?.());
  });
  const inWorkspaceFrame = () => setParent({ location: { pathname: "/workspace", origin: window.location.origin } });

  async function openWithReadError(error: string): Promise<void> {
    // Stays mounted: a stopped page has nothing to tell the user about.
    inWorkspaceFrame();
    vi.mocked(toast.error).mockClear();
    readSpy.mockResolvedValue({ error });
    stops.push(startDesktopCanvasPersistence());
    await tick();
  }

  it("tells the user, without auto-dismiss, that a canvas open in another window is not saved here", async () => {
    await openWithReadError(OTHER_WINDOW_MESSAGE);
    expect(OTHER_WINDOW_NOTICE).toContain(OTHER_WINDOW_MESSAGE);
    expect(OTHER_WINDOW_NOTICE).toMatch(/not saved/);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(OTHER_WINDOW_NOTICE, { duration: Infinity });
  });

  it("keeps the generic notice for any other read error", async () => {
    await openWithReadError("boom");
    expect(toast.error).toHaveBeenCalledWith(OPEN_FAILED_MESSAGE);
  });

  describe("lock release on fork", () => {
    /** Starts persistence on a pending read, adds a node meanwhile, then resolves the read: a fork. */
    async function forkDuringRead(read: ReturnType<typeof vi.fn>): Promise<void> {
      let resolveRead!: (v: unknown) => void;
      read.mockImplementation(() => new Promise((r) => (resolveRead = r)));
      vi.mocked(releaseWebCanvasLock).mockClear();
      const stop = startDesktopCanvasPersistence();
      useSceneStore.getState().addNode({ id: "n1", type: "rect", name: "n", x: 0, y: 0, width: 1, height: 1 } as never);
      resolveRead({ canvas: { id: "cv_web", title: "T", updatedAt: 1, rev: 4, document: "{}" } });
      await tick();
      stop?.();
    }

    it("gives the old id's Web Lock back when the web store forks", async () => {
      inWorkspaceFrame();
      await forkDuringRead(readSpy);
      expect(releaseWebCanvasLock).toHaveBeenCalledWith("cv_web");
    });

    it("does not touch the web lock when a desktop bridge is used", async () => {
      inWorkspaceFrame();
      const read = vi.fn();
      const save = vi.fn(async () => ({ ok: true as const, rev: 1 }));
      (window as unknown as { penDesktop?: unknown }).penDesktop = { canvases: { read, save } };
      await forkDuringRead(read);
      expect(releaseWebCanvasLock).not.toHaveBeenCalled();
    });
  });
});
