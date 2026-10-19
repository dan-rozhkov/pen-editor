import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDoc, dropStaleIndexEntry, getDoc, listDocs, readDoc, repairDocIndex, subscribeDocs, updateDoc, type DocChange } from "@/lib/docs/docStore";

const BODY_KEY = (id: string) => `pen.docs.doc.${id}`;

/** Makes writes to the index fail while body writes still pass. */
function failIndexWrites() {
  const original = localStorage.setItem.bind(localStorage);
  return vi.spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => {
    if (key === "pen.docs.index") throw new DOMException("full", "QuotaExceededError");
    original(key, value);
  });
}

describe("updateDoc compare-and-set on rev", () => {
  beforeEach(() => localStorage.clear());

  it("starts at rev 1 and counts every write", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    expect(doc.rev).toBe(1);
    expect(updateDoc(doc.id, { markdown: "b" }, "agent")).toMatchObject({ rev: 2 });
    expect(getDoc(doc.id)?.rev).toBe(2);
  });

  it("writes when the stored rev matches expectedRev", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    expect(updateDoc(doc.id, { markdown: "b" }, "editor", { expectedRev: 1 })).toMatchObject({ markdown: "b", rev: 2 });
  });

  it("returns conflict and writes nothing when the rev differs", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    updateDoc(doc.id, { markdown: "agent" }, "agent");
    expect(updateDoc(doc.id, { markdown: "mine" }, "editor", { expectedRev: 1 })).toBe("conflict");
    expect(getDoc(doc.id)).toMatchObject({ markdown: "agent", rev: 2 });
  });

  it("stays unconditional without expectedRev and null for unknown ids", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    expect(updateDoc(doc.id, { markdown: "z" }, "agent")).not.toBeNull();
    expect(updateDoc("nope", { markdown: "z" }, "editor", { expectedRev: 1 })).toBeNull();
  });

  it("reads a body stored without rev as rev 0", () => {
    localStorage.setItem(BODY_KEY("old"), JSON.stringify({ id: "old", title: "O", markdown: "m", updatedAt: 1 }));
    expect(getDoc("old")?.rev).toBe(0);
    expect(updateDoc("old", { markdown: "n" }, "agent")).toMatchObject({ rev: 1 });
  });
});

describe("readDoc", () => {
  beforeEach(() => localStorage.clear());

  it("tells missing from unreadable", () => {
    localStorage.setItem(BODY_KEY("bad"), "{not json");
    const doc = createDoc({ title: "T" }, "editor");
    expect(readDoc(doc.id).kind).toBe("ok");
    expect(readDoc("nope")).toEqual({ kind: "missing" });
    expect(readDoc("bad")).toEqual({ kind: "unreadable" });
    expect(getDoc("bad")).toBeNull();
  });

  it("drops a stale index entry but never touches an existing body", () => {
    const doc = createDoc({ title: "T" }, "editor");
    expect(dropStaleIndexEntry(doc.id)).toBe(false);
    localStorage.setItem(BODY_KEY(doc.id), "{not json");
    expect(dropStaleIndexEntry(doc.id)).toBe(false);
    expect(localStorage.getItem(BODY_KEY(doc.id))).toBe("{not json");
    localStorage.removeItem(BODY_KEY(doc.id));
    expect(dropStaleIndexEntry(doc.id)).toBe(true);
    expect(listDocs()).toEqual([]);
  });
});

describe("docStore atomic writes", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("restores the previous body and sends no notice when the index write fails on update", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const changes: DocChange[] = [];
    const unsubscribe = subscribeDocs((c) => changes.push(c));
    const spy = failIndexWrites();
    expect(() => updateDoc(doc.id, { markdown: "b" }, "agent")).toThrow(/storage/i);
    spy.mockRestore();
    unsubscribe();
    expect(getDoc(doc.id)).toMatchObject({ markdown: "a", rev: 1 });
    expect(changes).toEqual([]);
  });

  it("removes the new body when the index write fails on create", () => {
    const spy = failIndexWrites();
    expect(() => createDoc({ title: "T" }, "editor")).toThrow(/storage/i);
    spy.mockRestore();
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("pen.docs.doc."));
    expect(keys).toEqual([]);
  });

  it("does not turn a listener throw into a failed write", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: DocChange[] = [];
    const offBad = subscribeDocs(() => {
      throw new Error("listener bug");
    });
    const offGood = subscribeDocs((c) => seen.push(c));
    const doc = createDoc({ title: "T", markdown: "a" }, "agent");
    offBad();
    offGood();
    expect(getDoc(doc.id)?.markdown).toBe("a");
    expect(seen).toHaveLength(1);
    expect(error).toHaveBeenCalled();
  });
});

describe("docStore change payloads", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("carries the written document in the change, and none for a delete", () => {
    const changes: DocChange[] = [];
    const unsubscribe = subscribeDocs((c) => changes.push(c));
    const doc = createDoc({ title: "T", markdown: "a" }, "agent");
    unsubscribe();
    expect(changes[0]).toMatchObject({ id: doc.id, source: "agent", doc: { markdown: "a", title: "T", updatedAt: doc.updatedAt, rev: 1 } });
  });

  it("turns a storage event into an unlabeled change with the parsed document", () => {
    const changes: DocChange[] = [];
    const unsubscribe = subscribeDocs((c) => changes.push(c));
    const doc = { id: "doc_x", title: "X", markdown: "m", updatedAt: 5, rev: 3 };
    window.dispatchEvent(new StorageEvent("storage", { key: "pen.docs.doc.doc_x", newValue: JSON.stringify(doc) }));
    window.dispatchEvent(new StorageEvent("storage", { key: "pen.docs.doc.doc_x", newValue: null }));
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "1" }));
    unsubscribe();
    expect(changes).toEqual([{ id: "doc_x", doc }, { id: "doc_x", deleted: true }]);
  });

  it("repairs a missing index entry and announces it", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    localStorage.setItem("pen.docs.index", "[]");
    expect(repairDocIndex(doc.id)).toBe(true);
    expect(repairDocIndex("nope")).toBe(false);
    expect(JSON.parse(localStorage.getItem("pen.docs.index") ?? "[]")).toHaveLength(1);
  });
});
