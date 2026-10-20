import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredDoc } from "@/lib/desktopBridge";
import { getDesktopDocsBridge, isDesktopDocsReady, resetDesktopDocMirrorForTests, startDesktopDocMirror, whenDesktopDocsReady } from "@/lib/docs/desktopDocMirror";
import { createDoc, deleteDoc, getDoc, importDoc, readTombstones, setDocPersistence, updateDoc } from "@/lib/docs/docStore";

const stored = (id: string, rev: number, markdown = `m${rev}`): StoredDoc => ({ id, title: id, markdown, updatedAt: 100 + rev, rev });

function makeBridge(disk: unknown[] = []) {
  return {
    list: vi.fn(async () => ({ docs: disk as StoredDoc[] })),
    save: vi.fn(async (d: StoredDoc) => ({ ok: true as const, rev: d.rev })),
    remove: vi.fn(async (_id: string) => ({ ok: true as const })),
  };
}

function setPanel(docs: unknown) {
  (window as unknown as { penAgentPanel?: unknown }).penAgentPanel = { version: 2, docs };
}
function setTab(docs: unknown) {
  (window as unknown as { penDesktop?: unknown }).penDesktop = { docs };
}

describe("desktopDocMirror", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDesktopDocMirrorForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    resetDesktopDocMirrorForTests();
    delete (window as unknown as { penAgentPanel?: unknown }).penAgentPanel;
    delete (window as unknown as { penDesktop?: unknown }).penDesktop;
    vi.restoreAllMocks();
  });

  it("is a no-op without a bridge or with an old one lacking the methods", async () => {
    await startDesktopDocMirror();
    setTab({ open: vi.fn() });
    expect(getDesktopDocsBridge()).toBeUndefined();
    await startDesktopDocMirror();
    const doc = createDoc({ title: "T" }, "editor");
    expect(getDoc(doc.id)).not.toBeNull();
  });

  it("prefers the panel bridge over the tab bridge and falls back to the tab", () => {
    const panel = makeBridge();
    const tab = makeBridge();
    setPanel(panel);
    setTab(tab);
    expect(getDesktopDocsBridge()).toBe(panel);
    setPanel({ open: vi.fn() });
    expect(getDesktopDocsBridge()).toBe(tab);
  });

  it("imports newer disk docs, uploads local-only and locally newer docs, skips equal ones", async () => {
    importDoc(stored("equal", 2));
    importDoc(stored("older", 1));
    importDoc(stored("newer", 5));
    importDoc(stored("localonly", 1));
    const bridge = makeBridge([stored("equal", 2), stored("older", 3, "disk"), stored("newer", 2), stored("diskonly", 1, "d")]);
    setTab(bridge);
    await startDesktopDocMirror();

    expect(getDoc("older")).toEqual(stored("older", 3, "disk"));
    expect(getDoc("diskonly")).toEqual(stored("diskonly", 1, "d"));
    expect(getDoc("newer")?.rev).toBe(5);
    const saved = bridge.save.mock.calls.map(([d]) => d.id).sort();
    expect(saved).toEqual(["localonly", "newer"]);
  });

  it("mirrors local writes and deletes after the mirror started, but not imports", async () => {
    const bridge = makeBridge([stored("fromdisk", 1)]);
    setTab(bridge);
    await startDesktopDocMirror();
    expect(bridge.save).not.toHaveBeenCalled();
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    updateDoc(doc.id, { markdown: "b" }, "agent");
    deleteDoc(doc.id, "editor");
    expect(bridge.save.mock.calls.map(([d]) => d.rev)).toEqual([1, 2]);
    expect(bridge.remove).toHaveBeenCalledWith(doc.id);
  });

  it("tolerates a list error and keeps the sink installed", async () => {
    const bridge = makeBridge();
    bridge.list.mockResolvedValue({ error: "boom" } as never);
    setTab(bridge);
    await startDesktopDocMirror();
    expect(console.warn).toHaveBeenCalled();
    createDoc({ title: "T" }, "editor");
    expect(bridge.save).toHaveBeenCalledTimes(1);
  });

  it("logs rejections and error results of save without throwing", async () => {
    const bridge = makeBridge();
    bridge.save.mockRejectedValueOnce(new Error("ipc")).mockResolvedValueOnce({ error: "disk full" } as never);
    setTab(bridge);
    await startDesktopDocMirror();
    expect(() => createDoc({ title: "A" }, "editor")).not.toThrow();
    expect(() => createDoc({ title: "B" }, "editor")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("skips invalid disk entries", async () => {
    const bridge = makeBridge([null, { id: "x" }, { ...stored("badrev", 1), rev: "1" }, stored("good", 1)]);
    setTab(bridge);
    await startDesktopDocMirror();
    expect(getDoc("good")).not.toBeNull();
    expect(getDoc("x")).toBeNull();
    expect(getDoc("badrev")).toBeNull();
  });

  it("is idempotent", async () => {
    const bridge = makeBridge();
    setTab(bridge);
    const a = startDesktopDocMirror();
    const b = startDesktopDocMirror();
    expect(a).toBe(b);
    await a;
    await startDesktopDocMirror();
    expect(bridge.list).toHaveBeenCalledTimes(1);
    createDoc({ title: "T" }, "editor");
    expect(bridge.save).toHaveBeenCalledTimes(1);
  });

  it("upgrades a legacy rev-0 body to rev 1 locally before uploading; later edits and deletes use rev >= 1", async () => {
    localStorage.setItem("pen.docs.doc.legacy", JSON.stringify({ id: "legacy", title: "L", markdown: "m", updatedAt: 1 }));
    localStorage.setItem("pen.docs.index", JSON.stringify([{ id: "legacy", title: "L", updatedAt: 1 }]));
    expect(getDoc("legacy")?.rev).toBe(0);
    const bridge = makeBridge();
    setTab(bridge);
    await startDesktopDocMirror();
    expect(getDoc("legacy")?.rev).toBe(1);
    expect(bridge.save.mock.calls.map(([d]) => [d.id, d.rev])).toEqual([["legacy", 1]]);
    updateDoc("legacy", { markdown: "n" }, "editor");
    expect(bridge.save.mock.calls[1]?.[0].rev).toBe(2);
    deleteDoc("legacy", "editor");
    expect(readTombstones().legacy?.rev).toBeGreaterThanOrEqual(1);
  });

  it("whenDesktopDocsReady resolves at once without a mirror and after the reconcile with one", async () => {
    expect(isDesktopDocsReady()).toBe(true);
    await whenDesktopDocsReady();
    let release: (v: { docs: StoredDoc[] }) => void = () => {};
    const bridge = makeBridge();
    bridge.list.mockReturnValue(new Promise((r) => (release = r)));
    setTab(bridge);
    const start = startDesktopDocMirror();
    expect(isDesktopDocsReady()).toBe(false);
    release({ docs: [stored("late", 2)] });
    await whenDesktopDocsReady();
    await start;
    expect(isDesktopDocsReady()).toBe(true);
    expect(getDoc("late")).not.toBeNull();
  });

  it("is ready after a failed list too", async () => {
    const bridge = makeBridge();
    bridge.list.mockRejectedValue(new Error("ipc"));
    setTab(bridge);
    await startDesktopDocMirror();
    expect(isDesktopDocsReady()).toBe(true);
  });

  const withSink = () => setDocPersistence({ save: () => {}, remove: () => {} });

  it("does not resurrect a locally deleted doc, retries its remove and KEEPS the tombstone", async () => {
    withSink();
    importDoc(stored("dead", 3));
    importDoc(stored("alive", 1));
    deleteDoc("dead", "editor");
    let onDisk = [stored("dead", 3), stored("alive", 1)];
    const bridge = makeBridge();
    bridge.list.mockImplementation(async () => ({ docs: onDisk }));
    bridge.remove.mockImplementation(async (id: string) => {
      onDisk = onDisk.filter((d) => d.id !== id);
      return { ok: true as const };
    });
    setTab(bridge);
    await startDesktopDocMirror();
    expect(getDoc("dead")).toBeNull();
    expect(bridge.remove).toHaveBeenCalledWith("dead");
    expect(readTombstones().dead?.rev).toBe(3);
    // A late save re-creates the file: the next start removes it again.
    onDisk = [stored("dead", 3)];
    resetDesktopDocMirrorForTests();
    bridge.remove.mockClear();
    await startDesktopDocMirror();
    expect(bridge.remove).toHaveBeenCalledWith("dead");
    expect(getDoc("dead")).toBeNull();
  });

  it("keeps the tombstone while the doc is still on disk after a failed remove", async () => {
    withSink();
    importDoc(stored("dead", 3));
    deleteDoc("dead", "editor");
    const bridge = makeBridge([stored("dead", 3)]);
    bridge.remove.mockResolvedValue({ error: "locked" } as never);
    setTab(bridge);
    await startDesktopDocMirror();
    expect(getDoc("dead")).toBeNull();
    expect(readTombstones().dead?.rev).toBe(3);
  });

  it("imports a disk doc with a higher rev than the tombstone and clears it", async () => {
    withSink();
    importDoc(stored("back", 3));
    deleteDoc("back", "editor");
    const bridge = makeBridge([stored("back", 5)]);
    setTab(bridge);
    await startDesktopDocMirror();
    expect(getDoc("back")?.rev).toBe(5);
    expect(readTombstones()).toEqual({});
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it("prunes tombstones older than 30 days during the reconcile", async () => {
    localStorage.setItem("pen.docs.deleted", JSON.stringify({ old: { rev: 2, at: Date.now() - 31 * 86400000 }, fresh: { rev: 2, at: Date.now() } }));
    setTab(makeBridge());
    await startDesktopDocMirror();
    expect(Object.keys(readTombstones())).toEqual(["fresh"]);
  });

  it("writes no tombstone without a mirror", () => {
    const doc = createDoc({ title: "T" }, "editor");
    deleteDoc(doc.id, "editor");
    expect(readTombstones()).toEqual({});
  });
});
