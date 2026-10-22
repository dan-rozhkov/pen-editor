import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useDocSync } from "@/components/doc/useDocSync";
import { resetDesktopDocMirrorForTests, startDesktopDocMirror } from "@/lib/docs/desktopDocMirror";
import { createDoc, deleteDoc, getDoc, importDoc, listDocs, updateDoc, type Doc } from "@/lib/docs/docStore";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const CONFLICT = "The agent changed this document. Your last edits were replaced.";
const DELETED = "This document was deleted.";
const UNREADABLE = "This document cannot be read.";
const STORAGE = "Could not save the document: browser storage is full or blocked.";

function mount(id: string | null) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[id ? `/doc?id=${id}` : "/doc"]}>{children}</MemoryRouter>
  );
  return renderHook(() => useDocSync(), { wrapper });
}

/** A write from another page whose localStorage copy this page has not seen yet. */
function remoteWrite(doc: Doc) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: `pen.docs.doc.${doc.id}`, newValue: JSON.stringify(doc) }));
  });
}

describe("useDocSync autosave", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.mocked(toast).mockClear();
    vi.mocked(toast.error).mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("saves at most 1000 ms after the first unsaved change even while typing continues", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const { result } = mount(doc.id);
    for (const text of ["v0", "v1", "v2", "v3"]) {
      act(() => result.current.onEditorMarkdown(text));
      act(() => void vi.advanceTimersByTime(text === "v3" ? 249 : 250));
    }
    expect(getDoc(doc.id)?.markdown).toBe("a");
    act(() => void vi.advanceTimersByTime(1));
    // t = 1000: the max wait fires although the 300 ms debounce keeps restarting.
    expect(getDoc(doc.id)?.markdown).toBe("v3");
  });

  it("keeps the stored version on a conflict and tells the user once", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const { result } = mount(doc.id);
    act(() => result.current.onEditorMarkdown("mine"));
    act(() => void updateDoc(doc.id, { markdown: "agent" }, "agent"));
    act(() => void vi.advanceTimersByTime(300));
    expect(getDoc(doc.id)?.markdown).toBe("agent");
    expect(result.current.markdown).toBe("agent");
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(CONFLICT);
  });

  it("applies the document carried by a message although the storage read is stale", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const { result } = mount(doc.id);
    remoteWrite({ ...doc, markdown: "from message", rev: doc.rev + 1 });
    expect(result.current.markdown).toBe("from message");
    expect(getDoc(doc.id)?.markdown).toBe("a");
  });

  it("does not overwrite a remote write it saw only through a message", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const { result } = mount(doc.id);
    act(() => result.current.onEditorMarkdown("mine"));
    remoteWrite({ ...doc, markdown: "agent", rev: doc.rev + 1 });
    act(() => void vi.advanceTimersByTime(300));
    // The cache still says "a", so a read-only compare-and-set would have saved "mine".
    expect(getDoc(doc.id)?.markdown).toBe("a");
    expect(result.current.markdown).toBe("agent");
    expect(toast).toHaveBeenCalledWith(CONFLICT);
  });

  it("keeps the edit and warns once per failure streak when storage rejects the write", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const { result } = mount(doc.id);
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    act(() => result.current.onEditorMarkdown("one"));
    act(() => void vi.advanceTimersByTime(300));
    act(() => result.current.onEditorMarkdown("two"));
    act(() => void vi.advanceTimersByTime(300));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(STORAGE);
    setItem.mockRestore();
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(getDoc(doc.id)?.markdown).toBe("two");
  });

  it("reports a deleted body and falls back, removing only the index entry", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    localStorage.removeItem(`pen.docs.doc.${doc.id}`);
    const { result } = mount(doc.id);
    act(() => result.current.onEditorMarkdown("typed"));
    act(() => void vi.advanceTimersByTime(300));
    expect(toast).toHaveBeenCalledWith(DELETED);
    expect(listDocs()).toEqual([]);
  });

  it("keeps an unreadable body and its index entry, with an error toast", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    localStorage.setItem(`pen.docs.doc.${doc.id}`, "{not json");
    const { result } = mount(doc.id);
    act(() => result.current.onEditorMarkdown("typed"));
    act(() => void vi.advanceTimersByTime(300));
    expect(toast.error).toHaveBeenCalledWith(UNREADABLE);
    expect(localStorage.getItem(`pen.docs.doc.${doc.id}`)).toBe("{not json");
    expect(listDocs()).toHaveLength(1);
  });

  it("adopts a newer remote write and ignores duplicate or stale copies", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const { result } = mount(doc.id);
    const agent = { ...doc, markdown: "agent", rev: 2 };
    remoteWrite(agent);
    expect(result.current.markdown).toBe("agent");
    const adopted = result.current.revision;
    remoteWrite(agent);
    remoteWrite({ ...doc, rev: 1 });
    expect(result.current.revision).toBe(adopted);
  });

  it("does not let a duplicate delivery undo the user's newer save", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const { result } = mount(doc.id);
    const agent = { ...doc, markdown: "agent", rev: 2 };
    act(() => void updateDoc(doc.id, { markdown: "agent" }, "agent"));
    act(() => result.current.onEditorMarkdown("mine"));
    act(() => void vi.advanceTimersByTime(300));
    expect(getDoc(doc.id)).toMatchObject({ markdown: "mine", rev: 3 });
    const before = result.current.revision;
    remoteWrite(agent);
    expect(result.current.revision).toBe(before);
    expect(toast).not.toHaveBeenCalled();
    act(() => result.current.onEditorMarkdown("mine 2"));
    act(() => void vi.advanceTimersByTime(300));
    expect(getDoc(doc.id)).toMatchObject({ markdown: "mine 2", rev: 4 });
  });

  it("adopts the stored rev without a toast when the conflicting content is equal", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const { result } = mount(doc.id);
    act(() => result.current.onEditorMarkdown("same"));
    act(() => void updateDoc(doc.id, { markdown: "same" }, "agent"));
    act(() => void vi.advanceTimersByTime(300));
    expect(toast).not.toHaveBeenCalled();
    act(() => result.current.onEditorMarkdown("next"));
    act(() => void vi.advanceTimersByTime(300));
    expect(getDoc(doc.id)).toMatchObject({ markdown: "next", rev: 3 });
  });

  it("drops a pending edit after a failed flush on a doc switch", () => {
    const first = createDoc({ title: "A", markdown: "a" }, "editor");
    const second = createDoc({ title: "B", markdown: "b" }, "editor");
    const { result } = mount(first.id);
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    act(() => result.current.onEditorMarkdown("lost"));
    act(() => result.current.select(second.id));
    setItem.mockRestore();
    expect(toast.error).toHaveBeenCalledWith(STORAGE);
    expect(result.current.id).toBe(second.id);
    act(() => void window.dispatchEvent(new Event("pagehide")));
    act(() => void vi.advanceTimersByTime(1000));
    expect(getDoc(first.id)?.markdown).toBe("a");
    expect(getDoc(second.id)?.markdown).toBe("b");
  });

  it("does not re-read the body of an unlisted id on every render when the repair fails", () => {
    const doc = createDoc({ title: "Orphan", markdown: "a" }, "editor");
    localStorage.setItem("pen.docs.index", "[]");
    const original = localStorage.setItem.bind(localStorage);
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => {
      if (key === "pen.docs.index") throw new DOMException("full", "QuotaExceededError");
      original(key, value);
    });
    const getItem = vi.spyOn(localStorage, "getItem");
    const { result, rerender } = mount(doc.id);
    expect(result.current.id).toBe(doc.id);
    const reads = () => getItem.mock.calls.filter(([key]) => key === `pen.docs.doc.${doc.id}`).length;
    const before = reads();
    for (let i = 0; i < 5; i++) rerender();
    expect(reads()).toBe(before);
    setItem.mockRestore();
    getItem.mockRestore();
  });

  it("repairs the index entry of a body the index does not list", () => {
    const doc = createDoc({ title: "Orphan", markdown: "a" }, "editor");
    createDoc({ title: "Newer", markdown: "b" }, "editor");
    localStorage.setItem("pen.docs.index", "[]");
    const { result } = mount(doc.id);
    expect(result.current.id).toBe(doc.id);
    expect(listDocs().map((m) => m.id)).toEqual([doc.id]);
    expect(result.current.docs.map((m) => m.id)).toEqual([doc.id]);
  });

  it("does not rebuild the document list on its own autosave of an existing document", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const { result } = mount(doc.id);
    const before = result.current.docs;
    act(() => result.current.onEditorMarkdown("b"));
    act(() => void vi.advanceTimersByTime(300));
    expect(getDoc(doc.id)?.markdown).toBe("b");
    expect(result.current.docs).toBe(before);
  });
});

describe("useDocSync with a document that arrives later (desktop disk import)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows a ?id= document that was missing at mount once importDoc delivers it", () => {
    const { result } = mount("doc_late");
    expect(result.current.id).toBeNull();
    act(() => void importDoc({ id: "doc_late", title: "Late", markdown: "from disk", updatedAt: 5, rev: 4 }));
    expect(result.current.id).toBe("doc_late");
    expect(result.current.title).toBe("Late");
    expect(result.current.markdown).toBe("from disk");
    expect(result.current.docs.map((m) => m.id)).toEqual(["doc_late"]);
  });

  it("picks up a newer imported rev of the open document", () => {
    const doc = createDoc({ title: "T", markdown: "a" }, "editor");
    const { result } = mount(doc.id);
    act(() => void importDoc({ ...doc, markdown: "disk newer", rev: doc.rev + 3 }));
    expect(result.current.markdown).toBe("disk newer");
  });
});

describe("useDocSync while the desktop mirror is still reconciling", () => {
  afterEach(() => {
    cleanup();
    resetDesktopDocMirrorForTests();
    delete (window as unknown as { penDesktop?: unknown }).penDesktop;
  });

  function startMirror(list: () => Promise<{ docs: Doc[] }>) {
    (window as unknown as { penDesktop?: unknown }).penDesktop = {
      docs: { list, save: vi.fn(async (d: Doc) => ({ ok: true, rev: d.rev })), remove: vi.fn(async () => ({ ok: true })) },
    };
    return startDesktopDocMirror();
  }

  it("holds an id that exists locally and the no-id initial pick until the reconcile ends", async () => {
    localStorage.clear();
    const a = createDoc({ title: "A" }, "editor");
    const b = createDoc({ title: "B" }, "editor");
    let release: (v: { docs: Doc[] }) => void = () => {};
    const started = startMirror(() => new Promise((r) => (release = r)));
    const withId = mount(a.id);
    const noId = mount(null);
    expect(withId.result.current.id).toBeNull();
    expect(noId.result.current.id).toBeNull();
    await act(async () => {
      release({ docs: [] });
      await started;
    });
    expect(withId.result.current.id).toBe(a.id);
    expect(noId.result.current.id).toBe(b.id);
  });

  it.each([
    { name: "shows the id once the import lands", wanted: "doc_late", disk: [{ id: "doc_late", title: "Late", markdown: "disk", updatedAt: 5, rev: 4 }], lands: true },
    { name: "falls back to the newest doc when the id is still missing after the reconcile", wanted: "doc_nowhere", disk: [], lands: false },
  ])("holds a missing ?id= without falling back while reconciling, then $name", async ({ wanted, disk, lands }) => {
    localStorage.clear();
    const other = createDoc({ title: "Other" }, "editor");
    let release: (v: { docs: Doc[] }) => void = () => {};
    const started = startMirror(() => new Promise((r) => (release = r)));
    const { result } = mount(wanted);
    expect(result.current.id).toBeNull();
    expect(result.current.docs.map((m) => m.id)).toEqual([other.id]);
    await act(async () => {
      release({ docs: disk });
      await started;
    });
    expect(result.current.id).toBe(lands ? wanted : other.id);
    expect(result.current.markdown).toBe(lands ? "disk" : "");
  });
});

describe("useDocSync back/forward", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("walks back and forward after switching documents", () => {
    const a = createDoc({ title: "A" }, "editor");
    const b = createDoc({ title: "B" }, "editor");
    const { result } = mount(a.id);
    expect(result.current.canGoBack).toBe(false);
    act(() => result.current.select(b.id));
    expect(result.current.id).toBe(b.id);
    expect(result.current.canGoBack).toBe(true);
    act(() => result.current.goBack());
    expect(result.current.id).toBe(a.id);
    expect(result.current.canGoForward).toBe(true);
    act(() => result.current.goForward());
    expect(result.current.id).toBe(b.id);
  });

  it("does not keep a deleted document reachable", () => {
    const a = createDoc({ title: "A" }, "editor");
    const b = createDoc({ title: "B" }, "editor");
    const { result } = mount(a.id);
    act(() => result.current.select(b.id));
    act(() => void deleteDoc(a.id, "editor"));
    expect(result.current.canGoBack).toBe(false);
  });
});
