import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKFLOW_TITLE,
  WORKFLOW_STORAGE_ERROR,
  createWorkflow,
  deleteWorkflow,
  dropStaleWorkflowIndexEntry,
  getWorkflow,
  importWorkflow,
  readTombstones,
  setWorkflowPersistence,
  pruneTombstones,
  upgradeLegacyRev,
  type Workflow,
  listWorkflows,
  stepsFromTexts,
  subscribeWorkflows,
  updateWorkflow,
  type WorkflowChange,
} from "../workflowStore";

beforeEach(() => {
  localStorage.clear();
  setWorkflowPersistence(null);
});
afterEach(() => vi.restoreAllMocks());

describe("workflowStore", () => {
  it("creates at rev 1 with a default title and reads it back", () => {
    const wf = createWorkflow({ title: "  ", steps: stepsFromTexts(["a", "b"]) }, "editor");
    expect(wf.rev).toBe(1);
    expect(wf.title).toBe(DEFAULT_WORKFLOW_TITLE);
    expect(getWorkflow(wf.id)).toEqual(wf);
    expect(new Set(wf.steps.map((s) => s.id)).size).toBe(2);
  });

  it("update bumps rev and honours expectedRev", () => {
    const wf = createWorkflow({ title: "T" }, "editor");
    const next = updateWorkflow(wf.id, { title: " New " }, "agent");
    expect(next).toMatchObject({ title: "New", rev: 2 });
    expect(updateWorkflow(wf.id, { title: "X" }, "editor", { expectedRev: 1 })).toBe("conflict");
    expect(getWorkflow(wf.id)?.title).toBe("New");
    expect(updateWorkflow(wf.id, { title: "Y" }, "editor", { expectedRev: 2 })).toMatchObject({ rev: 3 });
    expect(updateWorkflow("missing", { title: "Y" }, "editor")).toBeNull();
  });

  it("lists newest first and drops deleted workflows", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200).mockReturnValue(300);
    const a = createWorkflow({ title: "A" }, "editor");
    const b = createWorkflow({ title: "B" }, "editor");
    expect(listWorkflows().map((m) => m.id)).toEqual([b.id, a.id]);
    deleteWorkflow(b.id, "editor");
    expect(listWorkflows().map((m) => m.id)).toEqual([a.id]);
    expect(getWorkflow(b.id)).toBeNull();
  });

  it("subscribers hear writes and deletes with the source", () => {
    const changes: WorkflowChange[] = [];
    const off = subscribeWorkflows((c) => changes.push(c));
    const wf = createWorkflow({ title: "T" }, "agent");
    deleteWorkflow(wf.id, "editor");
    off();
    createWorkflow({ title: "after" }, "agent");
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ id: wf.id, source: "agent", workflow: { rev: 1 } });
    expect(changes[1]).toMatchObject({ id: wf.id, deleted: true, source: "editor" });
  });

  it("keeps stepCount in the index, counting only non-blank steps", () => {
    createWorkflow({ title: "T", steps: stepsFromTexts(["a", "  ", "b", "", "c"]) }, "editor");
    expect(listWorkflows()[0].stepCount).toBe(3);
  });

  it("dropStaleWorkflowIndexEntry removes only an entry with no body at all", () => {
    const gone = createWorkflow({ title: "Gone" }, "editor");
    const corrupt = createWorkflow({ title: "Corrupt" }, "editor");
    const fine = createWorkflow({ title: "Fine" }, "editor");
    localStorage.removeItem(`pen.workflows.wf.${gone.id}`);
    localStorage.setItem(`pen.workflows.wf.${corrupt.id}`, "{not json");
    expect(dropStaleWorkflowIndexEntry(gone.id)).toBe(true);
    expect(dropStaleWorkflowIndexEntry(corrupt.id)).toBe(false);
    expect(dropStaleWorkflowIndexEntry(fine.id)).toBe(false);
    expect(localStorage.getItem(`pen.workflows.wf.${corrupt.id}`)).toBe("{not json");
    expect(listWorkflows().map((m) => m.id).sort()).toEqual([corrupt.id, fine.id].sort());
  });

  it("throws WORKFLOW_STORAGE_ERROR when storage is blocked", () => {
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => createWorkflow({ title: "T" }, "editor")).toThrow(WORKFLOW_STORAGE_ERROR);
    expect(listWorkflows()).toEqual([]);
    spy.mockRestore();
  });
});

const wfAt = (id: string, rev: number): Workflow => ({ id, title: id, steps: [{ id: `_s`, text: "a" }], updatedAt: 50 + rev, rev });

describe("workflowStore persistence and disk import", () => {
  it("sink hears local writes and deletes, never imports, and a throwing sink does not fail the write", () => {
    const sink = { save: vi.fn(), remove: vi.fn() };
    setWorkflowPersistence(sink);
    const wf = createWorkflow({ title: "T" }, "editor");
    updateWorkflow(wf.id, { title: "U" }, "agent");
    importWorkflow(wfAt("disk", 1));
    deleteWorkflow(wf.id, "editor");
    expect(sink.save.mock.calls.map(([w]) => [w.id, w.rev])).toEqual([[wf.id, 1], [wf.id, 2]]);
    expect(sink.remove).toHaveBeenCalledWith(wf.id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    sink.save.mockImplementation(() => {
      throw new Error("x");
    });
    expect(() => createWorkflow({ title: "Z" }, "editor")).not.toThrow();
  });

  it("importWorkflow writes only a newer rev, keeps rev/updatedAt, updates the index and notifies without source", () => {
    const changes: WorkflowChange[] = [];
    subscribeWorkflows((c) => changes.push(c));
    expect(importWorkflow(wfAt("a", 2))).toBe(true);
    expect(importWorkflow(wfAt("a", 2))).toBe(false);
    expect(importWorkflow(wfAt("a", 1))).toBe(false);
    expect(importWorkflow(wfAt("a", 3))).toBe(true);
    expect(getWorkflow("a")).toEqual(wfAt("a", 3));
    expect(listWorkflows()).toEqual([{ id: "a", title: "a", updatedAt: 53, stepCount: 1 }]);
    expect(changes.every((c) => c.source === undefined)).toBe(true);
    expect(changes).toHaveLength(2);
  });

  it("delete leaves a tombstone only with a sink; persist:false skips the sink's remove", () => {
    const plain = createWorkflow({ title: "P" }, "editor");
    deleteWorkflow(plain.id, "editor");
    expect(readTombstones()).toEqual({});
    const sink = { save: vi.fn(), remove: vi.fn() };
    setWorkflowPersistence(sink);
    const wf = createWorkflow({ title: "T" }, "editor");
    deleteWorkflow(wf.id, "editor", { persist: false });
    expect(sink.remove).not.toHaveBeenCalled();
    expect(readTombstones()[wf.id]?.rev).toBe(1);
    expect(getWorkflow(wf.id)).toBeNull();
    expect(listWorkflows()).toEqual([]);
  });

  it("a tombstone blocks an import at or below its rev and is cleared by a higher one", () => {
    setWorkflowPersistence({ save: () => {}, remove: () => {} });
    importWorkflow(wfAt("x", 3));
    deleteWorkflow("x", "editor");
    expect(importWorkflow(wfAt("x", 3))).toBe(false);
    expect(importWorkflow(wfAt("x", 2))).toBe(false);
    expect(importWorkflow(wfAt("x", 4))).toBe(true);
    expect(readTombstones()).toEqual({});
  });

  it("pruneTombstones drops old entries only", () => {
    localStorage.setItem("pen.workflows.deleted", JSON.stringify({ old: { rev: 1, at: Date.now() - 31 * 86400000 }, fresh: { rev: 1, at: Date.now() } }));
    expect(pruneTombstones()).toBe(1);
    expect(Object.keys(readTombstones())).toEqual(["fresh"]);
  });

  it("upgradeLegacyRev raises rev 0 to 1 silently for the sink and leaves others alone", () => {
    const sink = { save: vi.fn(), remove: vi.fn() };
    setWorkflowPersistence(sink);
    localStorage.setItem("pen.workflows.wf.old", JSON.stringify({ id: "old", title: "O", steps: [], updatedAt: 1 }));
    expect(getWorkflow("old")?.rev).toBe(0);
    expect(upgradeLegacyRev("old")).toBe(true);
    expect(getWorkflow("old")).toMatchObject({ rev: 1, title: "O", updatedAt: 1 });
    expect(upgradeLegacyRev("old")).toBe(false);
    expect(upgradeLegacyRev("missing")).toBe(false);
    expect(sink.save).not.toHaveBeenCalled();
  });
});
