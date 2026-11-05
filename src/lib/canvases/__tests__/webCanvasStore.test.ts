import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OTHER_WINDOW_MESSAGE, releaseWebCanvasLock, resetWebCanvasStoreForTests, subscribeWebCanvases, webCanvasStore } from "../webCanvasStore";
import type { StoredCanvas } from "@/lib/desktopBridge";

function canvas(over: Partial<StoredCanvas> = {}): StoredCanvas {
  return { id: "cv_a", title: "A", updatedAt: 1, rev: 1, document: '{"x":1}', ...over };
}

beforeEach(async () => {
  resetWebCanvasStoreForTests();
  localStorage.clear();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase("pen-canvases");
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
});
afterEach(() => {
  resetWebCanvasStoreForTests();
  vi.unstubAllGlobals();
});

describe("webCanvasStore", () => {
  it("reads null for a missing canvas, then what was saved", async () => {
    expect(await webCanvasStore.read("cv_a")).toEqual({ canvas: null });
    expect(await webCanvasStore.save(canvas())).toEqual({ ok: true, rev: 1 });
    expect(await webCanvasStore.read("cv_a")).toEqual({ canvas: canvas() });
  });

  it("answers stale when the stored rev is >= the incoming rev and writes nothing", async () => {
    await webCanvasStore.save(canvas({ rev: 3, document: "new" }));
    expect(await webCanvasStore.save(canvas({ rev: 3, document: "same" }))).toEqual({ ok: true, stale: true, rev: 3 });
    expect(await webCanvasStore.save(canvas({ rev: 2, document: "older" }))).toEqual({ ok: true, stale: true, rev: 3 });
    expect(await webCanvasStore.save(canvas({ rev: 4, document: "newer" }))).toEqual({ ok: true, rev: 4 });
    const res = await webCanvasStore.read("cv_a");
    expect("canvas" in res && res.canvas?.document).toBe("newer");
  });

  it("list returns metas without the document", async () => {
    await webCanvasStore.save(canvas());
    await webCanvasStore.save(canvas({ id: "cv_b", title: "B" }));
    const res = await webCanvasStore.list();
    expect("canvases" in res).toBe(true);
    const list = "canvases" in res ? res.canvases : [];
    expect(list.map((c) => c.id).sort()).toEqual(["cv_a", "cv_b"]);
    for (const c of list) expect(c).not.toHaveProperty("document");
  });

  it("remove deletes both records", async () => {
    await webCanvasStore.save(canvas());
    expect(await webCanvasStore.remove("cv_a")).toEqual({ ok: true });
    expect(await webCanvasStore.read("cv_a")).toEqual({ canvas: null });
    expect(await webCanvasStore.list()).toEqual({ canvases: [] });
  });

  it("notifies subscribers on save and remove, not on stale", async () => {
    const seen: unknown[] = [];
    const off = subscribeWebCanvases((c) => seen.push(c));
    await webCanvasStore.save(canvas());
    await webCanvasStore.save(canvas());
    await webCanvasStore.remove("cv_a");
    off();
    await webCanvasStore.save(canvas({ rev: 9 }));
    expect(seen).toEqual([
      { id: "cv_a", title: "A", updatedAt: 1 },
      { id: "cv_a", deleted: true },
    ]);
  });

  it("returns { error } and never rejects when IndexedDB is missing", async () => {
    vi.stubGlobal("indexedDB", undefined);
    for (const res of [
      await webCanvasStore.list(),
      await webCanvasStore.read("cv_a"),
      await webCanvasStore.save(canvas()),
      await webCanvasStore.remove("cv_a"),
    ]) {
      expect(res).toHaveProperty("error");
    }
  });
});

/** Minimal Web Locks: exclusive, FIFO, `signal` and `ifAvailable`. Held locks end with `release`. */
function installFakeLocks() {
  const held = new Map<string, () => void>();
  const waiting = new Map<string, Array<() => void>>();
  const requests: string[] = [];
  const grant = (name: string, cb: (lock: unknown) => unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      let done: () => void = () => {};
      const finished = new Promise<void>((r) => (done = r));
      held.set(name, done);
      Promise.resolve(cb({ name })).then(resolve, reject).finally(() => done());
      void finished.then(() => {
        held.delete(name);
        waiting.get(name)?.shift()?.();
      });
    });
  const request = (name: string, a: unknown, b?: unknown): Promise<unknown> => {
    const options = (typeof a === "function" ? {} : a) as { signal?: AbortSignal; ifAvailable?: boolean };
    const cb = (typeof a === "function" ? a : b) as (lock: unknown) => unknown;
    requests.push(name);
    if (!held.has(name)) return grant(name, cb);
    if (options.ifAvailable) return Promise.resolve(cb(null));
    return new Promise((resolve, reject) => {
      const start = () => grant(name, cb).then(resolve, reject);
      const q = waiting.get(name) ?? [];
      waiting.set(name, q);
      q.push(start);
      options.signal?.addEventListener("abort", () => {
        const i = q.indexOf(start);
        if (i >= 0) q.splice(i, 1);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  };
  vi.stubGlobal("navigator", { ...navigator, locks: { request } });
  return {
    requests,
    /** Another window holds the lock. */
    holdElsewhere: (name: string) => void request(name, () => new Promise(() => {})),
  };
}

describe("webCanvasStore single writer", () => {
  it("read takes the canvas lock once; a second read of the same id does not lock again", async () => {
    const locks = installFakeLocks();
    await webCanvasStore.read("cv_a");
    await webCanvasStore.read("cv_a");
    expect(locks.requests).toEqual(["pen.canvas.cv_a"]);
  });

  it("read answers an error when another window holds the lock, after 1500 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const locks = installFakeLocks();
      locks.holdElsewhere("pen.canvas.cv_a");
      const pending = webCanvasStore.read("cv_a");
      await vi.advanceTimersByTimeAsync(1499);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ error: OTHER_WINDOW_MESSAGE });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a held canvas saves without a revision check", async () => {
    installFakeLocks();
    await webCanvasStore.read("cv_a");
    expect(await webCanvasStore.save(canvas({ rev: 5, document: "five" }))).toEqual({ ok: true, rev: 5 });
    expect(await webCanvasStore.save(canvas({ rev: 2, document: "two" }))).toEqual({ ok: true, rev: 2 });
    const res = await webCanvasStore.read("cv_a");
    expect("canvas" in res && res.canvas?.document).toBe("two");
  });

  it("places both puts in the same tick when the connection is open", async () => {
    installFakeLocks();
    await webCanvasStore.read("cv_a");
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    const pending = webCanvasStore.save(canvas({ rev: 1 }));
    expect(put).toHaveBeenCalledTimes(2);
    await pending;
    put.mockRestore();
  });

  it("a canvas that was never read (a fork) takes its lock on the first save, then saves unchecked", async () => {
    const locks = installFakeLocks();
    await webCanvasStore.save(canvas({ id: "cv_fork", rev: 3 }));
    expect(locks.requests).toEqual(["pen.canvas.cv_fork"]);
    expect(await webCanvasStore.save(canvas({ id: "cv_fork", rev: 1, document: "x" }))).toEqual({ ok: true, rev: 1 });
  });

  it("an unheld canvas keeps the checked path (stale answer)", async () => {
    const locks = installFakeLocks();
    locks.holdElsewhere("pen.canvas.cv_a");
    await webCanvasStore.save(canvas({ rev: 3 }));
    expect(await webCanvasStore.save(canvas({ rev: 3 }))).toEqual({ ok: true, stale: true, rev: 3 });
  });

  it("remove deletes directly when this page holds the lock", async () => {
    const locks = installFakeLocks();
    await webCanvasStore.read("cv_a");
    await webCanvasStore.save(canvas());
    expect(await webCanvasStore.remove("cv_a")).toEqual({ ok: true });
    expect(locks.requests).toEqual(["pen.canvas.cv_a"]);
  });

  it("releaseWebCanvasLock frees the lock so the canvas can be removed again", async () => {
    const locks = installFakeLocks();
    await webCanvasStore.read("cv_a");
    await webCanvasStore.save(canvas());
    releaseWebCanvasLock("cv_a");
    releaseWebCanvasLock("cv_never"); // no-op
    await Promise.resolve();
    // Not held any more: remove has to take the lock itself (a second request), and gets it.
    expect(await webCanvasStore.remove("cv_a")).toEqual({ ok: true });
    expect(locks.requests).toEqual(["pen.canvas.cv_a", "pen.canvas.cv_a"]);
  });

  it("remove takes the lock for a canvas it does not hold, releases it, and fails after 2000 ms when blocked", async () => {
    await webCanvasStore.save(canvas({ id: "cv_b" })); // no Web Locks yet: nothing is held
    const locks = installFakeLocks();
    // The lock is free: remove gets it, deletes, and frees it again for the next call.
    expect(await webCanvasStore.remove("cv_b")).toEqual({ ok: true });
    expect(await webCanvasStore.remove("cv_b")).toEqual({ ok: true });
    expect(locks.requests).toEqual(["pen.canvas.cv_b", "pen.canvas.cv_b"]);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      locks.holdElsewhere("pen.canvas.cv_c");
      const pending = webCanvasStore.remove("cv_c");
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toEqual({ error: OTHER_WINDOW_MESSAGE });
    } finally {
      vi.useRealTimers();
    }
  });
});

const JOURNAL = "pen.canvas.journal.";

function firePagehide(): void {
  window.dispatchEvent(new Event("pagehide"));
}

async function readIdb(id: string): Promise<{ meta: unknown; document: unknown }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("pen-canvases", 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const tx = db.transaction(["metas", "documents"], "readonly");
  const get = (store: string) =>
    new Promise<unknown>((resolve) => {
      const r = tx.objectStore(store).get(id);
      r.onsuccess = () => resolve(r.result);
    });
  const out = { meta: await get("metas"), document: await get("documents") };
  db.close();
  return out;
}

describe("webCanvasStore journal", () => {
  it("save after pagehide writes the journal; without pagehide it does not; pageshow clears the flag", async () => {
    await webCanvasStore.save(canvas({ id: "cv_n" }));
    expect(localStorage.getItem(JOURNAL + "cv_n")).toBeNull();

    firePagehide();
    const p = webCanvasStore.save(canvas({ rev: 2, document: "late" }));
    expect(JSON.parse(localStorage.getItem(JOURNAL + "cv_a") ?? "null")).toEqual(canvas({ rev: 2, document: "late" }));
    await p;

    window.dispatchEvent(new Event("pageshow"));
    await webCanvasStore.save(canvas({ id: "cv_s" }));
    expect(localStorage.getItem(JOURNAL + "cv_s")).toBeNull();
  });

  it("read prefers a journal with a higher rev, writes it to IndexedDB and removes the key", async () => {
    await webCanvasStore.save(canvas({ rev: 1, document: "old" }));
    localStorage.setItem(JOURNAL + "cv_a", JSON.stringify(canvas({ rev: 2, document: "journal" })));
    expect(await webCanvasStore.read("cv_a")).toEqual({ canvas: canvas({ rev: 2, document: "journal" }) });
    expect(localStorage.getItem(JOURNAL + "cv_a")).toBeNull();
    const idb = await readIdb("cv_a");
    expect(idb.document).toBe("journal");
    expect(idb.meta).toMatchObject({ rev: 2 });
  });

  it("read returns a journal for a canvas missing from IndexedDB", async () => {
    localStorage.setItem(JOURNAL + "cv_a", JSON.stringify(canvas({ rev: 1 })));
    expect(await webCanvasStore.read("cv_a")).toEqual({ canvas: canvas() });
  });

  it.each([1, 2])("read ignores a journal with rev %i <= IndexedDB rev 2 and removes it", async (rev) => {
    await webCanvasStore.save(canvas({ rev: 2, document: "idb" }));
    localStorage.setItem(JOURNAL + "cv_a", JSON.stringify(canvas({ rev, document: "journal" })));
    expect(await webCanvasStore.read("cv_a")).toEqual({ canvas: canvas({ rev: 2, document: "idb" }) });
    expect(localStorage.getItem(JOURNAL + "cv_a")).toBeNull();
  });

  it("read ignores and removes a journal that does not parse", async () => {
    await webCanvasStore.save(canvas());
    localStorage.setItem(JOURNAL + "cv_a", "{not json");
    expect(await webCanvasStore.read("cv_a")).toEqual({ canvas: canvas() });
    expect(localStorage.getItem(JOURNAL + "cv_a")).toBeNull();
  });

  it("list shows a journal-only canvas and a newer journal title, skipping bad journals", async () => {
    await webCanvasStore.save(canvas({ id: "cv_a", title: "Old", rev: 1 }));
    localStorage.setItem(JOURNAL + "cv_a", JSON.stringify(canvas({ title: "New", rev: 2, updatedAt: 9 })));
    localStorage.setItem(JOURNAL + "cv_j", JSON.stringify(canvas({ id: "cv_j", title: "J" })));
    localStorage.setItem(JOURNAL + "cv_bad", "oops");
    const res = await webCanvasStore.list();
    const list = "canvases" in res ? res.canvases : [];
    expect(list.sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      { id: "cv_a", title: "New", updatedAt: 9, rev: 2 },
      { id: "cv_j", title: "J", updatedAt: 1, rev: 1 },
    ]);
    // list writes nothing
    expect(localStorage.getItem(JOURNAL + "cv_j")).not.toBeNull();
  });

  it("list removes a journal that is not newer than the stored meta, and keeps a newer one", async () => {
    await webCanvasStore.save(canvas({ id: "cv_a", rev: 3 }));
    await webCanvasStore.save(canvas({ id: "cv_b", rev: 1 }));
    localStorage.setItem(JOURNAL + "cv_a", JSON.stringify(canvas({ id: "cv_a", rev: 3 })));
    localStorage.setItem(JOURNAL + "cv_b", JSON.stringify(canvas({ id: "cv_b", rev: 2 })));
    await webCanvasStore.list();
    expect(localStorage.getItem(JOURNAL + "cv_a")).toBeNull();
    expect(localStorage.getItem(JOURNAL + "cv_b")).not.toBeNull();
  });

  it("remove clears the journal and list no longer shows the canvas", async () => {
    await webCanvasStore.save(canvas());
    localStorage.setItem(JOURNAL + "cv_a", JSON.stringify(canvas({ rev: 5 })));
    expect(await webCanvasStore.remove("cv_a")).toEqual({ ok: true });
    expect(localStorage.getItem(JOURNAL + "cv_a")).toBeNull();
    expect(await webCanvasStore.list()).toEqual({ canvases: [] });
  });

  it("a localStorage.setItem that throws during unloading does not fail the save", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      firePagehide();
      expect(await webCanvasStore.save(canvas())).toEqual({ ok: true, rev: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(await webCanvasStore.read("cv_a")).toEqual({ canvas: canvas() });
  });
});
