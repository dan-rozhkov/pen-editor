import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docCreate, docEdit, docList, docOpen, docRead } from "../docTools";
import { getDoc, listDocs } from "@/lib/docs/docStore";
import { getAgentPanelDocsBridge } from "@/lib/agentPanel";
import { resetDesktopDocMirrorForTests, startDesktopDocMirror } from "@/lib/docs/desktopDocMirror";

const run = async (h: (a: Record<string, unknown>, c?: never) => Promise<string>, args: Record<string, unknown> = {}) =>
  JSON.parse(await h(args));

function setBridge(open: ((id: string) => Promise<{ ok: boolean; error?: string }>) | undefined) {
  window.penAgentPanel = open ? ({ version: 3, docs: { open } } as unknown as Window["penAgentPanel"]) : undefined;
}

beforeEach(() => {
  localStorage.clear();
  setBridge(undefined);
});
afterEach(() => setBridge(undefined));

describe("doc tools", () => {
  it("doc_list is empty, then lists created docs", async () => {
    expect(await run(docList)).toEqual({ documents: [] });
    const { docId } = await run(docCreate, { title: "A", markdown: "# A" });
    const { documents } = await run(docList);
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ docId, title: "A" });
    expect(typeof documents[0].updatedAt).toBe("number");
  });

  it("doc_create stores an agent doc and opens the tab via the bridge", async () => {
    const open = vi.fn(async () => ({ ok: true }));
    setBridge(open);
    const r = await run(docCreate, { title: "Plan", markdown: "body" });
    expect(open).toHaveBeenCalledWith(r.docId);
    expect(r).toEqual({ docId: r.docId, title: "Plan" });
    expect(getDoc(r.docId)?.markdown).toBe("body");
  });

  it("doc_create keeps the doc and reports openError without a bridge", async () => {
    const r = await run(docCreate, { title: "Plan", markdown: "body" });
    expect(r.openError).toMatch(/not available/);
    expect(listDocs()).toHaveLength(1);
  });

  it("doc_create reports a bridge error and a throwing bridge", async () => {
    setBridge(async () => ({ ok: false, error: "no window" }));
    expect((await run(docCreate, { title: "T", markdown: "" })).openError).toBe("no window");
    setBridge(async () => {
      throw new Error("boom");
    });
    expect((await run(docCreate, { title: "T", markdown: "" })).openError).toBe("boom");
    expect(listDocs()).toHaveLength(2);
  });

  it("doc_create validates its arguments", async () => {
    expect((await run(docCreate, { title: "T" })).error).toBeTruthy();
    expect(listDocs()).toHaveLength(0);
  });

  it("doc_read returns the document or an error", async () => {
    const { docId } = await run(docCreate, { title: "R", markdown: "text" });
    expect(await run(docRead, { docId })).toEqual({ docId, title: "R", markdown: "text" });
    expect((await run(docRead, { docId: "nope" })).error).toMatch(/Unknown docId/);
    expect((await run(docRead, {})).error).toBeTruthy();
  });

  it("doc_edit applies edits, renames, and counts", async () => {
    const { docId } = await run(docCreate, { title: "E", markdown: "one two two" });
    const r = await run(docEdit, {
      docId,
      title: "Edited",
      edits: [{ oldString: "one", newString: "1" }, { oldString: "two", newString: "2", replaceAll: true }],
    });
    expect(r).toEqual({ docId, title: "Edited", applied: 2 });
    expect(getDoc(docId)).toMatchObject({ title: "Edited", markdown: "1 2 2" });
  });

  it("doc_edit is atomic: a failing edit leaves the document untouched", async () => {
    const { docId } = await run(docCreate, { title: "E", markdown: "a a" });
    const r = await run(docEdit, { docId, edits: [{ oldString: "a", newString: "b", replaceAll: true }, { oldString: "zzz", newString: "q" }] });
    expect(r.error).toContain("Edit 1");
    expect(getDoc(docId)?.markdown).toBe("a a");
    const amb = await run(docEdit, { docId, edits: [{ oldString: "a", newString: "b" }] });
    expect(amb.error).toContain("2 times");
  });

  it("doc_edit replaces the whole markdown and rejects bad combinations", async () => {
    const { docId } = await run(docCreate, { title: "E", markdown: "old" });
    expect(await run(docEdit, { docId, markdown: "new" })).toMatchObject({ applied: 1 });
    expect(getDoc(docId)?.markdown).toBe("new");
    expect((await run(docEdit, { docId, markdown: "x", edits: [{ oldString: "new", newString: "y" }] })).error).toMatch(/not both/);
    expect((await run(docEdit, { docId })).error).toMatch(/Nothing to change/);
    expect((await run(docEdit, { docId: "nope", markdown: "x" })).error).toMatch(/Unknown docId/);
    expect(getDoc(docId)?.markdown).toBe("new");
  });

  it("doc_open opens a known doc and fails for unknown id, missing bridge, bridge error", async () => {
    const { docId } = await run(docCreate, { title: "O", markdown: "" });
    expect((await run(docOpen, { docId })).error).toMatch(/not available/);
    const open = vi.fn(async () => ({ ok: true }));
    setBridge(open);
    expect(await run(docOpen, { docId })).toEqual({ docId, opened: true });
    expect(open).toHaveBeenCalledWith(docId);
    expect((await run(docOpen, { docId: "nope" })).error).toMatch(/Unknown docId/);
    setBridge(async () => ({ ok: false, error: "denied" }));
    expect((await run(docOpen, { docId })).error).toBe("denied");
  });

  it("getAgentPanelDocsBridge requires a function", () => {
    expect(getAgentPanelDocsBridge()).toBeUndefined();
    window.penAgentPanel = { version: 3, docs: {} } as unknown as Window["penAgentPanel"];
    expect(getAgentPanelDocsBridge()).toBeUndefined();
  });
});

describe("doc tools wait for the desktop disk mirror", () => {
  afterEach(() => {
    resetDesktopDocMirrorForTests();
    delete (window as unknown as { penDesktop?: unknown }).penDesktop;
  });

  function startSlowMirror() {
    let release: (v: { docs: unknown[] }) => void = () => {};
    (window as unknown as { penDesktop?: unknown }).penDesktop = {
      docs: {
        list: () => new Promise((r) => (release = r)),
        save: vi.fn(async (d: { rev: number }) => ({ ok: true, rev: d.rev })),
        remove: vi.fn(async () => ({ ok: true })),
      },
    };
    const started = startDesktopDocMirror();
    return { started, release: (docs: unknown[]) => release({ docs }) };
  }

  it("doc_list and doc_read see a disk-only doc after the reconcile", async () => {
    const m = startSlowMirror();
    let settled = false;
    const listed = run(docList).then((r) => ((settled = true), r));
    const read = run(docRead, { docId: "doc_disk" });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    m.release([{ id: "doc_disk", title: "Disk", markdown: "body", updatedAt: 5, rev: 2 }]);
    await m.started;
    expect((await listed).documents.map((d: { docId: string }) => d.docId)).toEqual(["doc_disk"]);
    expect(await read).toMatchObject({ docId: "doc_disk", markdown: "body" });
  });

  it("doc_edit waits, then edits the disk-only doc", async () => {
    const m = startSlowMirror();
    const edit = run(docEdit, { docId: "doc_disk", markdown: "new" });
    m.release([{ id: "doc_disk", title: "Disk", markdown: "body", updatedAt: 5, rev: 2 }]);
    await m.started;
    expect(await edit).toMatchObject({ docId: "doc_disk" });
    expect(getDoc("doc_disk")).toMatchObject({ markdown: "new", rev: 3 });
  });

  it("doc_create does not write before the reconcile ends", async () => {
    const m = startSlowMirror();
    const created = run(docCreate, { title: "N", markdown: "x" });
    await new Promise((r) => setTimeout(r, 0));
    expect(listDocs()).toHaveLength(0);
    m.release([]);
    await m.started;
    expect((await created).docId).toBeTruthy();
    expect(listDocs()).toHaveLength(1);
  });
});
