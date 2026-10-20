import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDoc, deleteDoc, dropStaleIndexEntry, clearTombstone, importDoc, pruneTombstones, readTombstones, setDocPersistence, upgradeLegacyRev, getDoc, listDocs, readDoc, repairDocIndex, subscribeDocs, updateDoc, type DocChange } from "@/lib/docs/docStore";

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

describe("persistence sink", () => {
  const sink = { save: vi.fn(), remove: vi.fn() };
  beforeEach(() => {
    localStorage.clear();
    sink.save.mockReset();
    sink.remove.mockReset();
    setDocPersistence(sink);
  });
  afterEach(() => {
    setDocPersistence(null);
    vi.restoreAllMocks();
  });

  it("gets every create and update with the written doc", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    expect(sink.save).toHaveBeenLastCalledWith(doc);
    const next = updateDoc(doc.id, { markdown: "b" }, "agent");
    expect(sink.save).toHaveBeenLastCalledWith(next);
    expect(sink.save).toHaveBeenCalledTimes(2);
  });

  it("gets deletes but never a dropped stale index entry", () => {
    const doc = createDoc({ title: "T" }, "editor");
    deleteDoc(doc.id, "editor");
    expect(sink.remove).toHaveBeenCalledWith(doc.id);
    sink.remove.mockClear();

    localStorage.setItem("pen.docs.index", JSON.stringify([{ id: "ghost", title: "G", updatedAt: 1 }]));
    expect(dropStaleIndexEntry("ghost")).toBe(true);
    const live = createDoc({ title: "L" }, "editor");
    expect(dropStaleIndexEntry(live.id)).toBe(false);
    expect(sink.remove).not.toHaveBeenCalled();
    expect(readTombstones()).toEqual({ [doc.id]: { rev: 1, at: expect.any(Number) } });
  });

  it("is not called for a failed write", () => {
    const spy = failIndexWrites();
    expect(() => createDoc({ title: "T" }, "editor")).toThrow();
    spy.mockRestore();
    expect(sink.save).not.toHaveBeenCalled();
  });

  it("does not fail the write when the sink throws", () => {
    sink.save.mockImplementation(() => {
      throw new Error("disk");
    });
    sink.remove.mockImplementation(() => {
      throw new Error("disk");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    expect(getDoc(doc.id)).not.toBeNull();
    expect(updateDoc(doc.id, { markdown: "b" }, "editor")).toMatchObject({ rev: 2 });
    expect(() => deleteDoc(doc.id, "editor")).not.toThrow();
    expect(getDoc(doc.id)).toBeNull();
  });

  it("is not called for changes that arrive from other pages", () => {
    const unsubscribe = subscribeDocs(() => {});
    const doc = { id: "x", title: "X", markdown: "m", updatedAt: 1, rev: 3 };
    window.dispatchEvent(new StorageEvent("storage", { key: "pen.docs.doc.x", newValue: JSON.stringify(doc) }));
    window.dispatchEvent(new StorageEvent("storage", { key: "pen.docs.doc.x", newValue: null }));
    unsubscribe();
    expect(sink.save).not.toHaveBeenCalled();
    expect(sink.remove).not.toHaveBeenCalled();
  });
});

describe("importDoc", () => {
  const sink = { save: vi.fn(), remove: vi.fn() };
  const doc = (rev: number, markdown = `r${rev}`) => ({ id: "d1", title: "Disk", markdown, updatedAt: 500 + rev, rev });
  beforeEach(() => {
    localStorage.clear();
    sink.save.mockReset();
    setDocPersistence(sink);
  });
  afterEach(() => {
    setDocPersistence(null);
    vi.restoreAllMocks();
  });

  it("writes a missing doc as is, indexes it and notifies without a source", () => {
    const changes: DocChange[] = [];
    const unsubscribe = subscribeDocs((c) => changes.push(c));
    expect(importDoc(doc(4))).toBe(true);
    unsubscribe();
    expect(getDoc("d1")).toEqual(doc(4));
    expect(listDocs()).toEqual([{ id: "d1", title: "Disk", updatedAt: 504 }]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ id: "d1", doc: doc(4) });
    expect("source" in changes[0]).toBe(false);
    expect(sink.save).not.toHaveBeenCalled();
  });

  it("replaces a lower rev, ignores equal and higher local revs", () => {
    importDoc(doc(2));
    expect(importDoc(doc(3))).toBe(true);
    expect(importDoc(doc(3, "other"))).toBe(false);
    expect(importDoc(doc(2))).toBe(false);
    expect(getDoc("d1")).toEqual(doc(3));
  });

  it("replaces an unreadable local body", () => {
    localStorage.setItem(BODY_KEY("d1"), "{broken");
    expect(importDoc(doc(1))).toBe(true);
    expect(getDoc("d1")).toEqual(doc(1));
  });

  it("rolls back and returns false when the index write fails", () => {
    importDoc(doc(1));
    const spy = failIndexWrites();
    expect(importDoc(doc(2))).toBe(false);
    expect(getDoc("d1")).toEqual(doc(1));
    spy.mockRestore();
    localStorage.clear();
    const spy2 = failIndexWrites();
    expect(importDoc(doc(2))).toBe(false);
    spy2.mockRestore();
    expect(readDoc("d1")).toEqual({ kind: "missing" });
  });
});

describe("delete tombstones", () => {
  const disk = (rev: number) => ({ id: "gone", title: "Disk", markdown: `r${rev}`, updatedAt: 1, rev });
  const tomb = (rev: number) => ({ rev, at: expect.any(Number) });
  beforeEach(() => {
    localStorage.clear();
    setDocPersistence({ save: vi.fn(), remove: vi.fn() });
  });
  afterEach(() => setDocPersistence(null));

  it("deleteDoc records the deleted rev and time, keeping the higher rev", () => {
    const doc = createDoc({ title: "T" }, "editor");
    updateDoc(doc.id, { markdown: "b" }, "editor");
    deleteDoc(doc.id, "editor");
    expect(readTombstones()).toEqual({ [doc.id]: tomb(2) });
    expect(JSON.parse(localStorage.getItem("pen.docs.deleted") ?? "{}")).toEqual({ [doc.id]: tomb(2) });
  });

  it("records nothing without a persistence sink (web pages)", () => {
    setDocPersistence(null);
    const doc = createDoc({ title: "T" }, "editor");
    deleteDoc(doc.id, "editor");
    expect(localStorage.getItem("pen.docs.deleted")).toBeNull();
  });

  it("importDoc skips a copy at or below the tombstone rev", () => {
    expect(importDoc(disk(3))).toBe(true);
    deleteDoc("gone", "editor");
    expect(importDoc(disk(3))).toBe(false);
    expect(importDoc(disk(2))).toBe(false);
    expect(getDoc("gone")).toBeNull();
    expect(readTombstones()).toEqual({ gone: tomb(3) });
  });

  it("a higher rev wins and clears the tombstone", () => {
    importDoc(disk(3));
    deleteDoc("gone", "editor");
    expect(importDoc(disk(4))).toBe(true);
    expect(getDoc("gone")?.rev).toBe(4);
    expect(readTombstones()).toEqual({});
    expect(localStorage.getItem("pen.docs.deleted")).toBeNull();
  });

  it("clearTombstone removes one id; broken and old numeric records are ignored", () => {
    localStorage.setItem("pen.docs.deleted", "not json");
    expect(readTombstones()).toEqual({});
    localStorage.setItem("pen.docs.deleted", JSON.stringify({ a: 1, b: "x", c: { rev: 2, at: 5 }, d: { rev: 1, at: 7 } }));
    expect(readTombstones()).toEqual({ c: { rev: 2, at: 5 }, d: { rev: 1, at: 7 } });
    clearTombstone("c");
    expect(readTombstones()).toEqual({ d: { rev: 1, at: 7 } });
  });

  it("pruneTombstones drops only entries older than the limit", () => {
    const now = Date.now();
    localStorage.setItem("pen.docs.deleted", JSON.stringify({ old: { rev: 1, at: now - 40 * 86400000 }, fresh: { rev: 1, at: now - 86400000 } }));
    expect(pruneTombstones()).toBe(1);
    expect(Object.keys(readTombstones())).toEqual(["fresh"]);
    expect(pruneTombstones()).toBe(0);
  });
});

describe("upgradeLegacyRev", () => {
  beforeEach(() => localStorage.clear());

  it("raises a rev-0 body to 1, keeps its content, notifies without a source and skips the sink", () => {
    localStorage.setItem("pen.docs.doc.legacy", JSON.stringify({ id: "legacy", title: "L", markdown: "m", updatedAt: 7 }));
    localStorage.setItem("pen.docs.index", JSON.stringify([{ id: "legacy", title: "L", updatedAt: 7 }]));
    const sink = { save: vi.fn(), remove: vi.fn() };
    setDocPersistence(sink);
    const changes: DocChange[] = [];
    const off = subscribeDocs((c) => changes.push(c));
    expect(upgradeLegacyRev("legacy")).toBe(true);
    off();
    setDocPersistence(null);
    expect(getDoc("legacy")).toEqual({ id: "legacy", title: "L", markdown: "m", updatedAt: 7, rev: 1 });
    expect(sink.save).not.toHaveBeenCalled();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: "legacy", doc: { rev: 1 } });
    expect(changes[0]?.source).toBeUndefined();
  });

  it("does nothing for a rev >= 1 body or a missing one", () => {
    const doc = createDoc({ title: "T" }, "editor");
    expect(upgradeLegacyRev(doc.id)).toBe(false);
    expect(upgradeLegacyRev("nope")).toBe(false);
    expect(getDoc(doc.id)?.rev).toBe(1);
  });
});
