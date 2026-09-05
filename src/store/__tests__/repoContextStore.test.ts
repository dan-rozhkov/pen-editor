import { describe, it, expect, beforeEach } from "vitest";
import {
  useRepoContextStore,
  MAX_CALL_BYTES,
  MAX_CALL_FILES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_TREE_PATHS,
} from "@/store/repoContextStore";
import { assertOk, assertErr } from "@/test/assertions";

function reset() {
  useRepoContextStore.setState({
    name: null,
    tree: [],
    filesByPath: new Map(),
    attachedAt: null,
  });
}

describe("repoContextStore", () => {
  beforeEach(() => {
    reset();
  });

  it("starts with no repo attached", () => {
    const state = useRepoContextStore.getState();
    expect(state.isAttached()).toBe(false);
    expect(state.getFile("package.json")).toBeUndefined();
  });

  it("attach() populates name/tree/files and reports usage", () => {
    const result = useRepoContextStore.getState().attach({
      name: "acme-app",
      tree: ["package.json", "src/index.ts"],
      files: [{ path: "package.json", content: '{"name":"acme-app"}' }],
    });

    assertOk(result);
    expect(result.name).toBe("acme-app");
    expect(result.fileCount).toBe(1);
    expect(result.treeSize).toBe(2);
    expect(result.bytesUsed).toBeGreaterThan(0);

    const state = useRepoContextStore.getState();
    expect(state.isAttached()).toBe(true);
    expect(state.getFile("package.json")).toBe('{"name":"acme-app"}');
    expect(state.attachedAt).not.toBeNull();
  });

  it("attach() replaces any current attachment", () => {
    const store = useRepoContextStore.getState();
    store.attach({ name: "first", tree: ["a.ts"], files: [{ path: "a.ts", content: "a" }] });
    store.attach({ name: "second", tree: ["b.ts"], files: [{ path: "b.ts", content: "b" }] });

    const state = useRepoContextStore.getState();
    expect(state.name).toBe("second");
    expect(state.getFile("a.ts")).toBeUndefined();
    expect(state.getFile("b.ts")).toBe("b");
  });

  it("appendFiles() adds to an existing attachment without dropping prior files", () => {
    const store = useRepoContextStore.getState();
    store.attach({ name: "acme-app", tree: ["a.ts"], files: [{ path: "a.ts", content: "a" }] });
    const result = store.appendFiles([{ path: "b.ts", content: "b" }], ["b.ts"]);

    assertOk(result);
    expect(result.fileCount).toBe(2);
    expect(result.treeSize).toBe(2);

    const state = useRepoContextStore.getState();
    expect(state.getFile("a.ts")).toBe("a");
    expect(state.getFile("b.ts")).toBe("b");
  });

  it("appendFiles() errors, without mutating state, when nothing is attached yet", () => {
    const result = useRepoContextStore
      .getState()
      .appendFiles([{ path: "a.ts", content: "a" }]);

    assertErr(result);
    expect(result.reason).toMatch(/no repo is currently attached/i);
    expect(useRepoContextStore.getState().isAttached()).toBe(false);
  });

  it("detach() clears the attachment and reports what was dropped", () => {
    const store = useRepoContextStore.getState();
    store.attach({
      name: "acme-app",
      tree: ["a.ts"],
      files: [{ path: "a.ts", content: "a" }],
    });

    const dropped = store.detach();
    expect(dropped).toEqual({ name: "acme-app", fileCount: 1 });

    const state = useRepoContextStore.getState();
    expect(state.isAttached()).toBe(false);
    expect(state.name).toBeNull();
    expect(state.tree).toEqual([]);
    expect(state.getFile("a.ts")).toBeUndefined();
  });

  it("detach() is a safe no-op (returns null) when nothing is attached", () => {
    expect(useRepoContextStore.getState().detach()).toBeNull();
  });

  it("rejects a single call over the per-call file-count cap", () => {
    const files = Array.from({ length: MAX_CALL_FILES + 1 }, (_, i) => ({
      path: `f${i}.ts`,
      content: "x",
    }));
    const result = useRepoContextStore.getState().attach({ name: "big", files });

    assertErr(result);
    expect(result.reason).toContain(String(MAX_CALL_FILES));
    expect(useRepoContextStore.getState().isAttached()).toBe(false);
  });

  it("rejects a single call over the per-call byte cap", () => {
    const result = useRepoContextStore.getState().attach({
      name: "big",
      files: [{ path: "big.txt", content: "x".repeat(MAX_CALL_BYTES + 1) }],
    });

    assertErr(result);
    expect(result.reason).toContain("byte");
    expect(useRepoContextStore.getState().isAttached()).toBe(false);
  });

  it("rejects attach() over the attachment-wide file-count cap", () => {
    // Stay under the per-call cap by chunking, but exceed the attachment cap
    // in total via a single attach() call carrying MAX_ATTACHMENT_FILES + 1
    // files is itself over the per-call cap, so assert the attachment cap
    // is enforced through append instead, one call at a time.
    const store = useRepoContextStore.getState();
    const first = Array.from({ length: MAX_CALL_FILES }, (_, i) => ({
      path: `f${i}.ts`,
      content: "x",
    }));
    expect(store.attach({ name: "big", files: first }).ok).toBe(true);

    let lastResult = store.appendFiles([]);
    const chunks = Math.ceil((MAX_ATTACHMENT_FILES - MAX_CALL_FILES + 1) / MAX_CALL_FILES);
    for (let c = 0; c < chunks; c++) {
      const chunk = Array.from({ length: MAX_CALL_FILES }, (_, i) => ({
        path: `g${c}_${i}.ts`,
        content: "x",
      }));
      lastResult = store.appendFiles(chunk);
    }

    assertErr(lastResult);
    expect(lastResult.reason).toContain(String(MAX_ATTACHMENT_FILES));
  });

  it("rejects attach() over the attachment-wide tree-path cap", () => {
    const tree = Array.from({ length: MAX_ATTACHMENT_TREE_PATHS + 1 }, (_, i) => `p${i}.ts`);
    const result = useRepoContextStore.getState().attach({ name: "big", tree });

    assertErr(result);
    expect(result.reason).toContain(String(MAX_ATTACHMENT_TREE_PATHS));
  });

  it("rejects attach() over the attachment-wide byte cap", () => {
    // One file under the per-call byte cap but designed so several appended
    // chunks cross the attachment-wide cap.
    const store = useRepoContextStore.getState();
    const chunkContent = "x".repeat(MAX_CALL_BYTES);
    expect(
      store.attach({ name: "big", files: [{ path: "f0.txt", content: chunkContent }] }).ok
    ).toBe(true);

    let lastResult = store.appendFiles([]);
    const chunksNeeded = Math.ceil(MAX_ATTACHMENT_BYTES / MAX_CALL_BYTES) + 1;
    for (let c = 1; c <= chunksNeeded; c++) {
      lastResult = store.appendFiles([{ path: `f${c}.txt`, content: chunkContent }]);
      if (!lastResult.ok) break;
    }

    assertErr(lastResult);
    expect(lastResult.reason).toContain("byte");
  });

  it("deduplicates tree paths", () => {
    const result = useRepoContextStore
      .getState()
      .attach({ name: "acme-app", tree: ["a.ts", "a.ts", "b.ts"] });

    assertOk(result);
    expect(result.treeSize).toBe(2);
    expect(useRepoContextStore.getState().tree).toEqual(["a.ts", "b.ts"]);
  });

  it("bytesUsed() sums UTF-8 byte length across attached files", () => {
    const store = useRepoContextStore.getState();
    store.attach({ name: "acme-app", files: [{ path: "a.txt", content: "héllo" }] });
    // "héllo" is 6 bytes in UTF-8 (é is 2 bytes), not 5 JS chars.
    expect(store.bytesUsed()).toBe(6);
  });

  // Prototype pollution: filesByPath used to be a plain object, so a path
  // matching an Object.prototype member either resolved to that member
  // instead of `undefined` on read, or (for `__proto__`) wrote through the
  // prototype instead of the object on write. A Map has no prototype chain
  // to collide with either way.
  describe("prototype-pollution-shaped paths", () => {
    const dangerousPaths = ["constructor", "__proto__", "toString", "hasOwnProperty"];

    it.each(dangerousPaths)("getFile(%s) returns undefined for an unattached dangerous path", (path) => {
      const store = useRepoContextStore.getState();
      store.attach({ name: "acme-app", files: [{ path: "a.ts", content: "a" }] });
      expect(store.getFile(path)).toBeUndefined();
    });

    it.each(dangerousPaths)("attaching a file at %s is retrievable by exact path, not lost", (path) => {
      const store = useRepoContextStore.getState();
      const result = store.attach({ name: "acme-app", files: [{ path, content: "payload" }] });

      assertOk(result);
      expect(result.fileCount).toBe(1);
      expect(store.getFile(path)).toBe("payload");
      // Object.prototype itself must be untouched.
      expect(({} as Record<string, unknown>).constructor).toBe(Object);
    });
  });

  describe("rejects unsafe paths at attach time", () => {
    it("rejects an absolute file path, naming it in the reason", () => {
      const result = useRepoContextStore
        .getState()
        .attach({ name: "acme-app", files: [{ path: "/etc/passwd", content: "x" }] });

      assertErr(result);
      expect(result.reason).toContain("/etc/passwd");
      expect(useRepoContextStore.getState().isAttached()).toBe(false);
    });

    it("rejects a file path with a '..' traversal segment", () => {
      const result = useRepoContextStore
        .getState()
        .attach({ name: "acme-app", files: [{ path: "../../etc/passwd", content: "x" }] });

      assertErr(result);
      expect(result.reason).toContain("../../etc/passwd");
      expect(useRepoContextStore.getState().isAttached()).toBe(false);
    });

    it("rejects an unsafe tree path even when no files are sent", () => {
      const result = useRepoContextStore
        .getState()
        .attach({ name: "acme-app", tree: ["src/index.ts", "../outside.ts"] });

      assertErr(result);
      expect(result.reason).toContain("../outside.ts");
      expect(useRepoContextStore.getState().isAttached()).toBe(false);
    });

    it("rejects an unsafe path on appendFiles without touching the existing attachment", () => {
      const store = useRepoContextStore.getState();
      store.attach({ name: "acme-app", files: [{ path: "a.ts", content: "a" }] });

      const result = store.appendFiles([{ path: "/etc/passwd", content: "x" }]);

      assertErr(result);
      expect(result.reason).toContain("/etc/passwd");
      expect(useRepoContextStore.getState().getFile("a.ts")).toBe("a");
      expect(useRepoContextStore.getState().filesByPath.size).toBe(1);
    });
  });

  it("attach() counts bytes once for a duplicate path, agreeing with fileCount", () => {
    const result = useRepoContextStore.getState().attach({
      name: "acme-app",
      files: [
        { path: "a.ts", content: "aaaa" },
        { path: "a.ts", content: "bb" },
      ],
    });

    assertOk(result);
    expect(result.fileCount).toBe(1);
    // Only the second (last-write-wins) copy's bytes should count — summing
    // over the raw input array would double count and report 6.
    expect(result.bytesUsed).toBe(2);
    expect(useRepoContextStore.getState().bytesUsed()).toBe(result.bytesUsed);
    expect(useRepoContextStore.getState().getFile("a.ts")).toBe("bb");
  });
});
