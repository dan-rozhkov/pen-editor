import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKFLOW_TITLE,
  WORKFLOW_STORAGE_ERROR,
  createWorkflow,
  deleteWorkflow,
  dropStaleWorkflowIndexEntry,
  getWorkflow,
  listWorkflows,
  stepsFromTexts,
  subscribeWorkflows,
  updateWorkflow,
  type WorkflowChange,
} from "../workflowStore";

beforeEach(() => localStorage.clear());
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
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => createWorkflow({ title: "T" }, "editor")).toThrow(WORKFLOW_STORAGE_ERROR);
    expect(listWorkflows()).toEqual([]);
  });
});
