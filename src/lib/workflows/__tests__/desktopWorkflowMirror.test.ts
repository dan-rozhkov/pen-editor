import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredWorkflow } from "@/lib/desktopBridge";
import { getDesktopWorkflowsBridge, isDesktopWorkflowsReady, resetDesktopWorkflowMirrorForTests, startDesktopWorkflowMirror, whenDesktopWorkflowsReady } from "@/lib/workflows/desktopWorkflowMirror";
import { createWorkflow, deleteWorkflow, getWorkflow, importWorkflow, readTombstones, setWorkflowPersistence, updateWorkflow } from "@/lib/workflows/workflowStore";

const stored = (id: string, rev: number, text = `m${rev}`): StoredWorkflow => ({ id, title: id, steps: [{ id: `${id}_s`, text }], updatedAt: 100 + rev, rev });

function makeBridge(disk: unknown[] = [], deleted?: unknown) {
  return {
    list: vi.fn(async () => ({ workflows: disk as StoredWorkflow[], ...(deleted === undefined ? {} : { deleted: deleted as { id: string; rev: number }[] }) })),
    save: vi.fn(async (d: StoredWorkflow) => ({ ok: true as const, rev: d.rev })),
    remove: vi.fn(async (_id: string) => ({ ok: true as const })),
  };
}

function setPanel(workflows: unknown) {
  (window as unknown as { penAgentPanel?: unknown }).penAgentPanel = { version: 2, workflows };
}
function setTab(workflows: unknown) {
  (window as unknown as { penDesktop?: unknown }).penDesktop = { workflows };
}

describe("desktopWorkflowMirror", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDesktopWorkflowMirrorForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    resetDesktopWorkflowMirrorForTests();
    delete (window as unknown as { penAgentPanel?: unknown }).penAgentPanel;
    delete (window as unknown as { penDesktop?: unknown }).penDesktop;
    vi.restoreAllMocks();
  });

  it("is a no-op without a bridge or with an old one lacking the methods", async () => {
    await startDesktopWorkflowMirror();
    setTab({ open: vi.fn() });
    expect(getDesktopWorkflowsBridge()).toBeUndefined();
    await startDesktopWorkflowMirror();
    const wf = createWorkflow({ title: "T" }, "editor");
    expect(getWorkflow(wf.id)).not.toBeNull();
  });

  it("prefers the panel bridge over the tab bridge and falls back to the tab", () => {
    const panel = makeBridge();
    const tab = makeBridge();
    setPanel(panel);
    setTab(tab);
    expect(getDesktopWorkflowsBridge()).toBe(panel);
    setPanel({ open: vi.fn() });
    expect(getDesktopWorkflowsBridge()).toBe(tab);
  });

  it("imports newer disk workflows, uploads local-only and locally newer ones, skips equal ones", async () => {
    importWorkflow(stored("equal", 2));
    importWorkflow(stored("older", 1));
    importWorkflow(stored("newer", 5));
    importWorkflow(stored("localonly", 1));
    const bridge = makeBridge([stored("equal", 2), stored("older", 3, "disk"), stored("newer", 2), stored("diskonly", 1, "d")]);
    setTab(bridge);
    await startDesktopWorkflowMirror();

    expect(getWorkflow("older")).toEqual(stored("older", 3, "disk"));
    expect(getWorkflow("diskonly")).toEqual(stored("diskonly", 1, "d"));
    expect(getWorkflow("newer")?.rev).toBe(5);
    expect(bridge.save.mock.calls.map(([w]) => w.id).sort()).toEqual(["localonly", "newer"]);
  });

  it("mirrors local writes and deletes after the mirror started, but not imports", async () => {
    const bridge = makeBridge([stored("fromdisk", 1)]);
    setTab(bridge);
    await startDesktopWorkflowMirror();
    expect(getWorkflow("fromdisk")).not.toBeNull();
    expect(bridge.save).not.toHaveBeenCalled();
    const wf = createWorkflow({ title: "T" }, "editor");
    updateWorkflow(wf.id, { title: "b" }, "agent");
    deleteWorkflow(wf.id, "editor");
    expect(bridge.save.mock.calls.map(([d]) => d.rev)).toEqual([1, 2]);
    expect(bridge.remove).toHaveBeenCalledWith(wf.id);
  });

  it("skips invalid disk entries", async () => {
    const bridge = makeBridge([null, { id: "x" }, { ...stored("badrev", 1), rev: "1" }, stored("good", 1)]);
    setTab(bridge);
    await startDesktopWorkflowMirror();
    expect(getWorkflow("good")).not.toBeNull();
    expect(getWorkflow("x")).toBeNull();
    expect(getWorkflow("badrev")).toBeNull();
  });

  it("is idempotent", async () => {
    const bridge = makeBridge();
    setTab(bridge);
    const a = startDesktopWorkflowMirror();
    const b = startDesktopWorkflowMirror();
    expect(a).toBe(b);
    await a;
    await startDesktopWorkflowMirror();
    expect(bridge.list).toHaveBeenCalledTimes(1);
    createWorkflow({ title: "T" }, "editor");
    expect(bridge.save).toHaveBeenCalledTimes(1);
  });

  it("upgrades a legacy rev-0 body to rev 1 locally before uploading; later edits and deletes use rev >= 1", async () => {
    localStorage.setItem("pen.workflows.wf.legacy", JSON.stringify({ id: "legacy", title: "L", steps: [], updatedAt: 1 }));
    localStorage.setItem("pen.workflows.index", JSON.stringify([{ id: "legacy", title: "L", updatedAt: 1, stepCount: 0 }]));
    expect(getWorkflow("legacy")?.rev).toBe(0);
    const bridge = makeBridge();
    setTab(bridge);
    await startDesktopWorkflowMirror();
    expect(getWorkflow("legacy")?.rev).toBe(1);
    expect(bridge.save.mock.calls.map(([d]) => [d.id, d.rev])).toEqual([["legacy", 1]]);
    updateWorkflow("legacy", { title: "n" }, "editor");
    expect(bridge.save.mock.calls[1]?.[0].rev).toBe(2);
    deleteWorkflow("legacy", "editor");
    expect(readTombstones().legacy?.rev).toBeGreaterThanOrEqual(1);
  });

  it("whenDesktopWorkflowsReady resolves at once without a mirror and after the reconcile with one", async () => {
    expect(isDesktopWorkflowsReady()).toBe(true);
    await whenDesktopWorkflowsReady();
    let release: (v: { workflows: StoredWorkflow[] }) => void = () => {};
    const bridge = makeBridge();
    bridge.list.mockReturnValue(new Promise((r) => (release = r)));
    setTab(bridge);
    const start = startDesktopWorkflowMirror();
    expect(isDesktopWorkflowsReady()).toBe(false);
    release({ workflows: [stored("late", 2)] });
    await whenDesktopWorkflowsReady();
    await start;
    expect(isDesktopWorkflowsReady()).toBe(true);
    expect(getWorkflow("late")).not.toBeNull();
  });

  it("is ready after a failed list too", async () => {
    const bridge = makeBridge();
    bridge.list.mockRejectedValue(new Error("ipc"));
    setTab(bridge);
    await startDesktopWorkflowMirror();
    expect(isDesktopWorkflowsReady()).toBe(true);
  });

  const withSink = () => setWorkflowPersistence({ save: () => {}, remove: () => {} });

  it("does not resurrect a locally deleted workflow, retries its remove and KEEPS the tombstone", async () => {
    withSink();
    importWorkflow(stored("dead", 3));
    importWorkflow(stored("alive", 1));
    deleteWorkflow("dead", "editor");
    let onDisk = [stored("dead", 3), stored("alive", 1)];
    const bridge = makeBridge();
    bridge.list.mockImplementation(async () => ({ workflows: onDisk }));
    bridge.remove.mockImplementation(async (id: string) => {
      onDisk = onDisk.filter((d) => d.id !== id);
      return { ok: true as const };
    });
    setTab(bridge);
    await startDesktopWorkflowMirror();
    expect(getWorkflow("dead")).toBeNull();
    expect(bridge.remove).toHaveBeenCalledWith("dead");
    expect(readTombstones().dead?.rev).toBe(3);
    // A late save re-creates the file: the next start removes it again.
    onDisk = [stored("dead", 3)];
    resetDesktopWorkflowMirrorForTests();
    bridge.remove.mockClear();
    await startDesktopWorkflowMirror();
    expect(bridge.remove).toHaveBeenCalledWith("dead");
    expect(getWorkflow("dead")).toBeNull();
  });

  it("keeps the tombstone while the workflow is still on disk after a failed remove", async () => {
    withSink();
    importWorkflow(stored("dead", 3));
    deleteWorkflow("dead", "editor");
    const bridge = makeBridge([stored("dead", 3)]);
    bridge.remove.mockResolvedValue({ error: "locked" } as never);
    setTab(bridge);
    await startDesktopWorkflowMirror();
    expect(getWorkflow("dead")).toBeNull();
    expect(readTombstones().dead?.rev).toBe(3);
  });

  it("imports a disk workflow with a higher rev than the tombstone and clears it", async () => {
    withSink();
    importWorkflow(stored("back", 3));
    deleteWorkflow("back", "editor");
    const bridge = makeBridge([stored("back", 5)]);
    setTab(bridge);
    await startDesktopWorkflowMirror();
    expect(getWorkflow("back")?.rev).toBe(5);
    expect(readTombstones()).toEqual({});
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it("prunes tombstones older than 30 days during the reconcile", async () => {
    localStorage.setItem("pen.workflows.deleted", JSON.stringify({ old: { rev: 2, at: Date.now() - 31 * 86400000 }, fresh: { rev: 2, at: Date.now() } }));
    setTab(makeBridge());
    await startDesktopWorkflowMirror();
    expect(Object.keys(readTombstones())).toEqual(["fresh"]);
  });

  it("writes no tombstone without a mirror", () => {
    const wf = createWorkflow({ title: "T" }, "editor");
    deleteWorkflow(wf.id, "editor");
    expect(readTombstones()).toEqual({});
  });

  it("onRemoved deletes the local workflow, leaves a tombstone and ignores unknown ids", async () => {
    importWorkflow(stored("gone", 2));
    importWorkflow(stored("kept", 1));
    let emit: (ids: string[]) => void = () => {};
    const off = vi.fn();
    const listed = [stored("gone", 2), stored("kept", 1)];
    const bridge = { ...makeBridge(listed), onRemoved: vi.fn((cb: (ids: string[]) => void) => ((emit = cb), off)) };
    setPanel(bridge);
    await startDesktopWorkflowMirror();

    emit(["gone", "unknown", 7 as unknown as string]);
    expect(getWorkflow("gone")).toBeNull();
    expect(getWorkflow("kept")).not.toBeNull();
    expect(readTombstones().gone?.rev).toBe(2);
    expect(readTombstones().unknown).toBeUndefined();
    expect(bridge.remove).not.toHaveBeenCalled();

    resetDesktopWorkflowMirrorForTests();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("works with a bridge that has no onRemoved", async () => {
    importWorkflow(stored("a", 1));
    setPanel(makeBridge([stored("a", 1)]));
    await startDesktopWorkflowMirror();
    expect(getWorkflow("a")).not.toBeNull();
  });

  it("reconcile drops a local workflow tombstoned on disk without saving or removing it", async () => {
    importWorkflow(stored("gone", 2));
    importWorkflow(stored("kept", 1));
    const bridge = makeBridge([stored("kept", 1)], [{ id: "gone", rev: 3 }]);
    setPanel(bridge);
    await startDesktopWorkflowMirror();

    expect(getWorkflow("gone")).toBeNull();
    expect(readTombstones().gone?.rev).toBe(2);
    expect(bridge.save).not.toHaveBeenCalled();
    expect(bridge.remove).not.toHaveBeenCalled();
    expect(getWorkflow("kept")).not.toBeNull();
  });

  it("reconcile keeps and uploads a local workflow newer than the disk tombstone", async () => {
    importWorkflow(stored("edited", 5));
    const bridge = makeBridge([], [{ id: "edited", rev: 3 }]);
    setPanel(bridge);
    await startDesktopWorkflowMirror();

    expect(getWorkflow("edited")?.rev).toBe(5);
    expect(bridge.save.mock.calls.map(([d]) => d.id)).toEqual(["edited"]);
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it("reconcile does not import a disk workflow that is also tombstoned on disk at the same rev", async () => {
    const bridge = makeBridge([stored("both", 2)], [{ id: "both", rev: 2 }]);
    setPanel(bridge);
    await startDesktopWorkflowMirror();

    expect(getWorkflow("both")).toBeNull();
    expect(bridge.save).not.toHaveBeenCalled();
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it("reconcile does not re-import a workflow that onRemoved deleted while the list was pending", async () => {
    importWorkflow(stored("gone", 2));
    let emit: (ids: string[]) => void = () => {};
    let release: (v: { workflows: StoredWorkflow[] }) => void = () => {};
    const bridge = { ...makeBridge(), onRemoved: vi.fn((cb: (ids: string[]) => void) => ((emit = cb), () => {})) };
    bridge.list.mockReturnValue(new Promise((r) => (release = r)));
    setPanel(bridge);
    const start = startDesktopWorkflowMirror();

    emit(["gone"]);
    expect(getWorkflow("gone")).toBeNull();
    release({ workflows: [stored("gone", 2)] });
    await start;

    expect(getWorkflow("gone")).toBeNull();
    expect(bridge.save).not.toHaveBeenCalled();
  });

  it("reconcile ignores malformed disk tombstones", async () => {
    importWorkflow(stored("a", 1));
    const bridge = makeBridge([stored("a", 1)], [null, 5, { id: "a" }, { id: 7, rev: 9 }, { id: "a", rev: "9" }, { id: "a", rev: Number.NaN }]);
    setPanel(bridge);
    await startDesktopWorkflowMirror();
    expect(getWorkflow("a")).not.toBeNull();
    expect(readTombstones()).toEqual({});

    resetDesktopWorkflowMirrorForTests();
    const notArray = makeBridge([stored("a", 1)], "nope");
    setPanel(notArray);
    await startDesktopWorkflowMirror();
    expect(getWorkflow("a")).not.toBeNull();
  });
});
