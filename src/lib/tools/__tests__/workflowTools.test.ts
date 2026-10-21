import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workflowCreate, workflowEdit, workflowList, workflowOpen, workflowRead } from "../workflowTools";
import { getWorkflow, listWorkflows, updateWorkflow } from "@/lib/workflows/workflowStore";

const run = async (h: (a: Record<string, unknown>, c?: never) => Promise<string>, args: Record<string, unknown> = {}) =>
  JSON.parse(await h(args));

type Open = (id: string) => Promise<{ ok: boolean; error?: string }>;
function setBridge(open: Open | undefined) {
  window.penAgentPanel = open ? ({ version: 3, workflows: { open } } as unknown as Window["penAgentPanel"]) : undefined;
}

beforeEach(() => {
  localStorage.clear();
  setBridge(undefined);
});
afterEach(() => setBridge(undefined));

describe("workflow tools", () => {
  it("workflow_list is empty, then lists step counts", async () => {
    expect(await run(workflowList)).toEqual({ workflows: [] });
    const { workflowId } = await run(workflowCreate, { title: "A", steps: ["x", "y"] });
    const { workflows } = await run(workflowList);
    expect(workflows).toEqual([{ workflowId, title: "A", stepCount: 2, updatedAt: expect.any(Number) }]);
  });

  it("workflow_create trims, drops empties, opens the tab via the bridge", async () => {
    const open = vi.fn<Open>(async () => ({ ok: true }));
    setBridge(open);
    const r = await run(workflowCreate, { title: "Plan", steps: [" one ", "", "two"] });
    expect(open).toHaveBeenCalledWith(r.workflowId);
    expect(r).toEqual({ workflowId: r.workflowId, title: "Plan", stepCount: 2, markdown: "1. one\n2. two" });
    expect(getWorkflow(r.workflowId)?.steps.map((s) => s.text)).toEqual(["one", "two"]);
  });

  it.each([
    ["no bridge", undefined, /not available/],
    ["bridge error", async () => ({ ok: false, error: "no window" }), /^no window$/],
    ["throwing bridge", async () => { throw new Error("boom"); }, /^boom$/],
  ] as [string, Open | undefined, RegExp][])("workflow_create keeps the workflow and reports openError: %s", async (_n, bridge, pattern) => {
    setBridge(bridge);
    const r = await run(workflowCreate, { title: "T", steps: ["a"] });
    expect(r.openError).toMatch(pattern);
    expect(listWorkflows()).toHaveLength(1);
  });

  it.each([
    ["missing title", { steps: ["a"] }],
    ["missing steps", { title: "T" }],
    ["non-string step", { title: "T", steps: [1] }],
    ["only blank steps", { title: "T", steps: [" ", ""] }],
    ["too many steps", { title: "T", steps: Array.from({ length: 101 }, (_, i) => `s${i}`) }],
  ])("workflow_create rejects %s", async (_n, args) => {
    expect((await run(workflowCreate, args)).error).toBeTruthy();
    expect(listWorkflows()).toHaveLength(0);
  });

  it("workflow_read returns steps with 1-based index, or an error", async () => {
    const { workflowId } = await run(workflowCreate, { title: "T", steps: ["a", "b"] });
    expect(await run(workflowRead, { workflowId })).toEqual({
      workflowId, title: "T", rev: 1, steps: [{ index: 1, text: "a" }, { index: 2, text: "b" }], markdown: "1. a\n2. b",
    });
    expect((await run(workflowRead, { workflowId: "nope" })).error).toMatch(/Unknown workflowId/);
    expect((await run(workflowRead, {})).error).toMatch(/required/);
  });

  it("workflow_read lists only non-blank steps, numbered like the markdown", async () => {
    const { workflowId } = await run(workflowCreate, { title: "T", steps: ["a", "b", "c"] });
    const wf = getWorkflow(workflowId)!;
    localStorage.setItem(`pen.workflows.wf.${workflowId}`, JSON.stringify({ ...wf, steps: [wf.steps[0], { id: "x", text: "  " }, wf.steps[2]] }));
    const r = await run(workflowRead, { workflowId });
    expect(r.steps).toEqual([{ index: 1, text: "a" }, { index: 2, text: "c" }]);
    expect(r.markdown).toBe("1. a\n2. c");
  });

  it("workflow_list hides entries whose body key is gone (it does not parse bodies)", async () => {
    const a = await run(workflowCreate, { title: "A", steps: ["x"] });
    const b = await run(workflowCreate, { title: "B", steps: ["y"] });
    localStorage.removeItem(`pen.workflows.wf.${a.workflowId}`);
    localStorage.setItem(`pen.workflows.wf.${b.workflowId}`, "{not json");
    expect((await run(workflowList)).workflows.map((w: { workflowId: string }) => w.workflowId)).toEqual([b.workflowId]);
  });

  it("workflow_edit replaces steps, keeps ids of unchanged steps, renames", async () => {
    const { workflowId } = await run(workflowCreate, { title: "T", steps: ["a", "b"] });
    const before = getWorkflow(workflowId)!.steps;
    const r = await run(workflowEdit, { workflowId, title: "New", steps: ["a", "c", "d"] });
    expect(r).toMatchObject({ title: "New", rev: 2, markdown: "1. a\n2. c\n3. d" });
    const after = getWorkflow(workflowId)!.steps;
    expect(after[0].id).toBe(before[0].id);
    expect(after[1].id).not.toBe(before[1].id);
    expect(after).toHaveLength(3);
  });

  it("workflow_edit matches ids by trimmed text, first unused match, with blank and padded stored steps", async () => {
    const { workflowId } = await run(workflowCreate, { title: "T", steps: ["x"] });
    updateWorkflow(
      workflowId,
      { steps: [{ id: "s1", text: "  a  " }, { id: "s2", text: "" }, { id: "s3", text: "b" }, { id: "s4", text: "a" }] },
      "editor",
    );
    await run(workflowEdit, { workflowId, steps: ["b", "a", "a", "a", "new"] });
    const steps = getWorkflow(workflowId)!.steps;
    expect(steps.map((s) => s.text)).toEqual(["b", "a", "a", "a", "new"]);
    expect(steps.slice(0, 3).map((s) => s.id)).toEqual(["s3", "s1", "s4"]);
    expect(["s1", "s2", "s3", "s4"]).not.toContain(steps[3].id);
    expect(["s1", "s2", "s3", "s4"]).not.toContain(steps[4].id);
    expect(steps[3].id).not.toBe(steps[4].id);
  });

  it("workflow_edit with only a title keeps the steps", async () => {
    const { workflowId } = await run(workflowCreate, { title: "T", steps: ["a"] });
    await run(workflowEdit, { workflowId, title: "U" });
    expect(getWorkflow(workflowId)).toMatchObject({ title: "U", steps: [{ text: "a" }] });
  });

  it.each([
    ["nothing to change", (id: string) => ({ workflowId: id })],
    ["unknown id", () => ({ workflowId: "nope", title: "x" })],
    ["empty steps", (id: string) => ({ workflowId: id, steps: [] })],
  ])("workflow_edit errors: %s", async (_n, args) => {
    const { workflowId } = await run(workflowCreate, { title: "T", steps: ["a"] });
    expect((await run(workflowEdit, args(workflowId))).error).toBeTruthy();
    expect(getWorkflow(workflowId)?.rev).toBe(1);
  });

  it("workflow_open calls the bridge with the id and reports errors", async () => {
    const { workflowId } = await run(workflowCreate, { title: "T", steps: ["a"] });
    const open = vi.fn<Open>(async () => ({ ok: true }));
    setBridge(open);
    expect(await run(workflowOpen, { workflowId })).toEqual({ workflowId, opened: true });
    expect(open).toHaveBeenCalledWith(workflowId);
    setBridge(undefined);
    expect((await run(workflowOpen, { workflowId })).error).toMatch(/not available/);
    expect((await run(workflowOpen, { workflowId: "nope" })).error).toMatch(/Unknown workflowId/);
  });
});
