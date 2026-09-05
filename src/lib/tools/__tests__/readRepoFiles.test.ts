import { describe, it, expect, afterEach, vi } from "vitest";
import { readRepoFiles } from "@/lib/tools/readRepoFiles";

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
