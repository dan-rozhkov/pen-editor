import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readRepoFiles } from "@/lib/tools/readRepoFiles";
import { useRepoContextStore } from "@/store/repoContextStore";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const FILES_RESULT = {
  repo: { owner: "acme", name: "app", ref: "main" },
  files: [
    { path: "src/Button.tsx", content: "export const Button = () => null;", truncated: false, bytes: 34 },
  ],
  missing: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("read_repo_files", () => {
  it("posts repo, ref and paths to the backend and returns the files", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(FILES_RESULT));
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(
      await readRepoFiles({
        repo: "acme/app",
        ref: "develop",
        paths: ["src/Button.tsx"],
      })
    );

    expect(result).toEqual(FILES_RESULT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/repo\/files$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      repo: "acme/app",
      paths: ["src/Button.tsx"],
      ref: "develop",
    });
  });

  it("omits ref when not provided and drops blank path entries", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(FILES_RESULT));
    vi.stubGlobal("fetch", fetchMock);

    await readRepoFiles({ repo: "acme/app", paths: ["src/Button.tsx", "  ", ""] });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      repo: "acme/app",
      paths: ["src/Button.tsx"],
    });
  });

  it("mentions missing/truncated files by passing the backend response through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          repo: { owner: "acme", name: "app", ref: "main" },
          files: [{ path: "a.ts", content: "x".repeat(10), truncated: true, bytes: 100000 }],
          missing: ["b.ts"],
        })
      )
    );

    const result = JSON.parse(
      await readRepoFiles({ repo: "acme/app", paths: ["a.ts", "b.ts"] })
    );
    expect(result.missing).toEqual(["b.ts"]);
    expect(result.files[0].truncated).toBe(true);
  });

  it("surfaces the backend's error message and status on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "rate limited, set GITHUB_TOKEN" }, 502))
    );

    const result = JSON.parse(
      await readRepoFiles({ repo: "acme/app", paths: ["a.ts"] })
    );
    expect(result.error).toContain("502");
    expect(result.error).toContain("rate limited, set GITHUB_TOKEN");
  });

  it("surfaces a 404 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "repository not found" }, 404))
    );

    const result = JSON.parse(
      await readRepoFiles({ repo: "acme/missing", paths: ["a.ts"] })
    );
    expect(result.error).toContain("404");
    expect(result.error).toContain("repository not found");
  });

  it("rejects a missing repo without making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(await readRepoFiles({ paths: ["a.ts"] }));
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects paths that are not an array", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(
      await readRepoFiles({ repo: "acme/app", paths: "a.ts" })
    );
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty paths array", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(await readRepoFiles({ repo: "acme/app", paths: [] }));
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects more than 20 paths without making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const paths = Array.from({ length: 21 }, (_, i) => `src/file${i}.ts`);
    const result = JSON.parse(await readRepoFiles({ repo: "acme/app", paths }));
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("21");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a readable error on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const result = JSON.parse(
      await readRepoFiles({ repo: "acme/app", paths: ["a.ts"] })
    );
    expect(result.error).toContain("network error");
    expect(result.error).toContain("Failed to fetch");
  });

  it("fails locally without a network request when offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = vi.fn(async () => jsonResponse(FILES_RESULT));
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(
      await readRepoFiles({ repo: "acme/app", paths: ["a.ts"] })
    );
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts paths sent as a JSON string, the way a model often emits them", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ repo: {}, files: [], missing: [] })
    );
    vi.stubGlobal("fetch", fetchMock);

    await readRepoFiles({ repo: "acme/app", paths: '["a.tsx","b.tsx"]' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.paths).toEqual(["a.tsx", "b.tsx"]);
  });

  it("rejects a paths string that is not JSON", async () => {
    const result = JSON.parse(
      await readRepoFiles({ repo: "acme/app", paths: "a.tsx, b.tsx" })
    );
    expect(result.error).toContain("could not be parsed as JSON");
  });

  // A trailing newline 404s on GitHub, and the file then comes back in
  // `missing` — telling the model a file that exists does not.
  it("trims whitespace off the paths it sends, not just the ones it checks", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ repo: {}, files: [], missing: [] })
    );
    vi.stubGlobal("fetch", fetchMock);

    await readRepoFiles({ repo: "acme/app", paths: ["  components/ui/button.tsx\n"] });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.paths).toEqual(["components/ui/button.tsx"]);
  });
});

describe("read_repo_files with a local repo attached", () => {
  beforeEach(() => {
    useRepoContextStore.setState({ name: null, tree: [], filesByPath: new Map(), attachedAt: null });
  });

  it("serves requested files from the store with no network call", async () => {
    useRepoContextStore.getState().attach({
      name: "acme-app",
      tree: ["a.ts"],
      files: [{ path: "a.ts", content: "export const a = 1;" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(await readRepoFiles({ paths: ["a.ts"] }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.source).toBe("local");
    expect(result.repo).toEqual({ name: "acme-app" });
    expect(result.files).toEqual([
      { path: "a.ts", content: "export const a = 1;", truncated: false, bytes: 19 },
    ]);
    expect(result.missing).toEqual([]);
    // Always present (even empty) — matching the backend's response shape
    // exactly, so a model can't tell which source answered from the shape.
    expect(result.notRead).toEqual([]);
  });

  it("reports a requested path not in the snapshot as missing, not an error", async () => {
    useRepoContextStore
      .getState()
      .attach({ name: "acme-app", files: [{ path: "a.ts", content: "a" }] });
    vi.stubGlobal("fetch", vi.fn());

    const result = JSON.parse(await readRepoFiles({ paths: ["a.ts", "missing.ts"] }));

    expect(result.files.map((f: { path: string }) => f.path)).toEqual(["a.ts"]);
    expect(result.missing).toEqual(["missing.ts"]);
  });

  it("truncates a file over 64KB on a UTF-8 boundary and marks it truncated", async () => {
    const big = "a".repeat(70 * 1024);
    useRepoContextStore
      .getState()
      .attach({ name: "acme-app", files: [{ path: "big.txt", content: big }] });
    vi.stubGlobal("fetch", vi.fn());

    const result = JSON.parse(await readRepoFiles({ paths: ["big.txt"] }));

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file.truncated).toBe(true);
    expect(file.content).toContain("truncated");
    expect(file.content.length).toBeLessThan(big.length);
    // `bytes` is the byte length of `content` as returned, truncation marker
    // included (matching the backend's fetchFilesWithBudget, which measures
    // the post-marker string) — so it sits a little OVER the 64KB per-file
    // cap by the marker's own length, not under it.
    const markerBytes = new TextEncoder().encode("\n/* ... truncated ... */").length;
    expect(file.bytes).toBe(new TextEncoder().encode(file.content).length);
    expect(file.bytes).toBeGreaterThan(64 * 1024);
    expect(file.bytes).toBeLessThanOrEqual(64 * 1024 + markerBytes);
  });

  it("does not require a repo argument when a local repo is attached", async () => {
    useRepoContextStore
      .getState()
      .attach({ name: "acme-app", files: [{ path: "a.ts", content: "a" }] });
    vi.stubGlobal("fetch", vi.fn());

    const result = JSON.parse(await readRepoFiles({ paths: ["a.ts"] }));
    expect(result.error).toBeUndefined();
  });

  it("reports an ignored repo argument alongside source: local instead of silently dropping it", async () => {
    useRepoContextStore
      .getState()
      .attach({ name: "acme-app", files: [{ path: "a.ts", content: "a" }] });
    vi.stubGlobal("fetch", vi.fn());

    const result = JSON.parse(
      await readRepoFiles({ repo: "vercel/next.js", paths: ["a.ts"] })
    );

    expect(result.source).toBe("local");
    expect(result.ignoredRepoArg).toBe("vercel/next.js");
  });

  it("omits ignoredRepoArg when no repo argument was sent", async () => {
    useRepoContextStore
      .getState()
      .attach({ name: "acme-app", files: [{ path: "a.ts", content: "a" }] });
    vi.stubGlobal("fetch", vi.fn());

    const result = JSON.parse(await readRepoFiles({ paths: ["a.ts"] }));
    expect(result).not.toHaveProperty("ignoredRepoArg");
  });

  // Prototype pollution: filesByPath used to be a plain object, so
  // read_repo_files({paths:["constructor"]}) resolved to
  // Object.prototype.constructor (a function) instead of reporting the path
  // missing, and a file attached at "__proto__" was retrievable here even
  // though the store lookup silently dropped it.
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "reports an unattached dangerous path (%s) as missing, not as prototype content",
    async (path) => {
      useRepoContextStore
        .getState()
        .attach({ name: "acme-app", files: [{ path: "a.ts", content: "a" }] });
      vi.stubGlobal("fetch", vi.fn());

      const result = JSON.parse(await readRepoFiles({ paths: [path] }));

      expect(result.files).toEqual([]);
      expect(result.missing).toEqual([path]);
    }
  );

  it("serves a file actually attached at a dangerous path like any other file", async () => {
    useRepoContextStore
      .getState()
      .attach({ name: "acme-app", files: [{ path: "__proto__", content: "payload" }] });
    vi.stubGlobal("fetch", vi.fn());

    const result = JSON.parse(await readRepoFiles({ paths: ["__proto__"] }));

    expect(result.missing).toEqual([]);
    expect(result.files).toEqual([
      { path: "__proto__", content: "payload", truncated: false, bytes: 7 },
    ]);
  });

  it("applies a whole-response byte budget across multiple paths, reporting the rest as notRead", async () => {
    // Each file is ~100KB, well over the per-file 64KB cap on its own, so
    // each one gets truncated to ~64KB individually — but six of those
    // still add up to ~384KB, well past the 256KB whole-response budget.
    // Mirrors the backend's fetchFilesWithBudget, which this local path did
    // not apply before this fix (it only mirrored the per-file cap).
    const content = "x".repeat(100 * 1024);
    const paths = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt"];
    useRepoContextStore.getState().attach({
      name: "acme-app",
      files: paths.map((path) => ({ path, content })),
    });
    vi.stubGlobal("fetch", vi.fn());

    const result = JSON.parse(await readRepoFiles({ paths }));

    const totalBytes = (result.files as { bytes: number }[]).reduce((sum, f) => sum + f.bytes, 0);
    expect(totalBytes).toBeLessThanOrEqual(256 * 1024 + 1024); // + generous marker slack
    expect(result.notRead.length).toBeGreaterThan(0);
    expect(result.missing).toEqual([]);
    // Every notRead path really was skipped, not returned empty/truncated.
    const readPaths = new Set((result.files as { path: string }[]).map((f) => f.path));
    for (const path of result.notRead) {
      expect(readPaths.has(path)).toBe(false);
    }
  });
});
