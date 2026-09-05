import { describe, it, expect, beforeEach } from "vitest";
import { attachLocalRepo } from "@/lib/tools/attachLocalRepo";
import { useRepoContextStore, MAX_CALL_FILES } from "@/store/repoContextStore";

function reset() {
  useRepoContextStore.setState({ name: null, tree: [], filesByPath: new Map(), attachedAt: null });
}

describe("attach_local_repo", () => {
  beforeEach(() => {
    reset();
  });

  it("attaches a repo with tree and files, reporting usage", async () => {
    const result = JSON.parse(
      await attachLocalRepo({
        name: "acme-app",
        tree: ["package.json", "src/index.ts"],
        files: [{ path: "package.json", content: '{"name":"acme-app"}' }],
      })
    );

    expect(result.ok).toBe(true);
    expect(result.name).toBe("acme-app");
    expect(result.fileCount).toBe(1);
    expect(result.treeSize).toBe(2);
    expect(typeof result.bytesUsed).toBe("number");
    expect(typeof result.remainingBytes).toBe("number");

    const state = useRepoContextStore.getState();
    expect(state.isAttached()).toBe(true);
    expect(state.getFile("package.json")).toBe('{"name":"acme-app"}');
  });

  it("accepts files/tree sent as JSON strings", async () => {
    const result = JSON.parse(
      await attachLocalRepo({
        name: "acme-app",
        tree: JSON.stringify(["a.ts"]),
        files: JSON.stringify([{ path: "a.ts", content: "export {}" }]),
      })
    );

    expect(result.ok).toBe(true);
    expect(useRepoContextStore.getState().getFile("a.ts")).toBe("export {}");
  });

  it("rejects a missing name on a replace/attach call", async () => {
    const result = JSON.parse(await attachLocalRepo({ files: [] }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/name/i);
    expect(useRepoContextStore.getState().isAttached()).toBe(false);
  });

  it("rejects malformed file entries", async () => {
    const result = JSON.parse(
      await attachLocalRepo({ name: "acme-app", files: [{ path: "a.ts" }] })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/path.*content/i);
  });

  it("rejects a files string that isn't valid JSON", async () => {
    const result = JSON.parse(
      await attachLocalRepo({ name: "acme-app", files: "not json" })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("could not be parsed as JSON");
  });

  it("chunks additional files in via mode: append", async () => {
    await attachLocalRepo({
      name: "acme-app",
      tree: ["a.ts"],
      files: [{ path: "a.ts", content: "a" }],
    });

    const result = JSON.parse(
      await attachLocalRepo({
        mode: "append",
        tree: ["b.ts"],
        files: [{ path: "b.ts", content: "b" }],
      })
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("append");
    expect(result.fileCount).toBe(2);
    expect(result.treeSize).toBe(2);

    const state = useRepoContextStore.getState();
    expect(state.getFile("a.ts")).toBe("a");
    expect(state.getFile("b.ts")).toBe("b");
  });

  it("gives an actionable error for mode: append with nothing attached", async () => {
    const result = JSON.parse(
      await attachLocalRepo({ mode: "append", files: [{ path: "a.ts", content: "a" }] })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/append.*requires a repo already attached/i);
    expect(useRepoContextStore.getState().isAttached()).toBe(false);
  });

  it("reports the store's over-cap reason instead of applying it silently", async () => {
    const files = Array.from({ length: MAX_CALL_FILES + 1 }, (_, i) => ({
      path: `f${i}.ts`,
      content: "x",
    }));
    const result = JSON.parse(await attachLocalRepo({ name: "big", files }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain(String(MAX_CALL_FILES));
    expect(useRepoContextStore.getState().isAttached()).toBe(false);
  });

  it("detach: true clears the attachment and reports what was dropped", async () => {
    await attachLocalRepo({ name: "acme-app", files: [{ path: "a.ts", content: "a" }] });

    const result = JSON.parse(await attachLocalRepo({ detach: true }));
    expect(result.ok).toBe(true);
    expect(result.detached).toBe(true);
    expect(result.name).toBe("acme-app");
    expect(result.fileCountDropped).toBe(1);

    expect(useRepoContextStore.getState().isAttached()).toBe(false);
  });

  it("detach: true is a safe no-op when nothing is attached", async () => {
    const result = JSON.parse(await attachLocalRepo({ detach: true }));
    expect(result.ok).toBe(true);
    expect(result.detached).toBe(false);
  });

  it("rejects an absolute path from the WebMCP tool call, naming it", async () => {
    const result = JSON.parse(
      await attachLocalRepo({ name: "acme-app", files: [{ path: "/etc/passwd", content: "x" }] })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("/etc/passwd");
    expect(useRepoContextStore.getState().isAttached()).toBe(false);
  });

  it("rejects a '..' traversal path from the WebMCP tool call, naming it", async () => {
    const result = JSON.parse(
      await attachLocalRepo({
        name: "acme-app",
        files: [{ path: "../outside.ts", content: "x" }],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("../outside.ts");
    expect(useRepoContextStore.getState().isAttached()).toBe(false);
  });

  it("attaching a file at a prototype-pollution-shaped path is retrievable, not silently dropped", async () => {
    const result = JSON.parse(
      await attachLocalRepo({
        name: "acme-app",
        files: [{ path: "__proto__", content: "payload" }],
      })
    );

    expect(result.ok).toBe(true);
    expect(result.fileCount).toBe(1);
    expect(useRepoContextStore.getState().getFile("__proto__")).toBe("payload");
  });

  it("replacing an existing attachment (mode omitted/replace) drops the prior one", async () => {
    await attachLocalRepo({ name: "first", files: [{ path: "a.ts", content: "a" }] });
    const result = JSON.parse(
      await attachLocalRepo({ name: "second", files: [{ path: "b.ts", content: "b" }] })
    );

    expect(result.ok).toBe(true);
    expect(result.name).toBe("second");
    const state = useRepoContextStore.getState();
    expect(state.getFile("a.ts")).toBeUndefined();
    expect(state.getFile("b.ts")).toBe("b");
  });
});
