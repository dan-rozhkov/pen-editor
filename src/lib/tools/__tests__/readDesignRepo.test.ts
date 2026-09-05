import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readDesignRepo } from "@/lib/tools/readDesignRepo";
import { useRepoContextStore } from "@/store/repoContextStore";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Mirrors the backend's DesignBrief shape
// (pen-editor-backend/src/services/repoDesignSystem.ts) — the handler passes
// the response through verbatim, so a fixture that invented its own shape
// would let a real backend/frontend drift go unnoticed here.
const BRIEF = {
  repo: {
    owner: "acme",
    name: "app",
    ref: "main",
    htmlUrl: "https://github.com/acme/app",
  },
  framework: ["next"],
  styling: ["tailwindcss"],
  componentLibraries: [],
  tokens: {
    source: ["tailwind-config"],
    colors: { "brand.500": "#5b21b6" },
    fontFamily: { sans: "Inter, sans-serif" },
    spacing: {},
    borderRadius: { lg: "12px" },
    boxShadow: {},
  },
  components: [{ name: "Button", path: "components/ui/button.tsx" }],
  keyFiles: ["package.json", "tailwind.config.ts"],
  notes: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("read_design_repo", () => {
  it("posts the repo (and ref) to the backend and returns the brief", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(BRIEF));
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(
      await readDesignRepo({ repo: "acme/app", ref: "develop" })
    );

    expect(result).toEqual(BRIEF);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/repo\/brief$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      repo: "acme/app",
      ref: "develop",
    });
  });

  it("omits ref from the request body when not provided", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(BRIEF));
    vi.stubGlobal("fetch", fetchMock);

    await readDesignRepo({ repo: "acme/app" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ repo: "acme/app" });
  });

  it("surfaces the backend's error message and status on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "rate limited, set GITHUB_TOKEN" }, 502))
    );

    const result = JSON.parse(await readDesignRepo({ repo: "acme/app" }));
    expect(result.error).toContain("502");
    expect(result.error).toContain("rate limited, set GITHUB_TOKEN");
  });

  it("surfaces a 404 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "repository not found" }, 404))
    );

    const result = JSON.parse(await readDesignRepo({ repo: "acme/missing" }));
    expect(result.error).toContain("404");
    expect(result.error).toContain("repository not found");
  });

  it("rejects a missing repo without making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(await readDesignRepo({}));
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a blank repo without making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(await readDesignRepo({ repo: "   " }));
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a readable error on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const result = JSON.parse(await readDesignRepo({ repo: "acme/app" }));
    expect(result.error).toContain("network error");
    expect(result.error).toContain("Failed to fetch");
  });

  it("fails locally without a network request when offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = vi.fn(async () => jsonResponse(BRIEF));
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(await readDesignRepo({ repo: "acme/app" }));
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The SPA rewrite answers 200 with an HTML shell when no backend is
  // configured; calling that a network error sends the model looking in the
  // wrong place.
  it("reports a non-JSON 200 as a backend misconfiguration, not a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html><html></html>", { status: 200 }))
    );

    const result = JSON.parse(await readDesignRepo({ repo: "acme/app" }));
    expect(result.error).toContain("non-JSON response");
    expect(result.error).not.toContain("network error");
  });

  it("says a 404 may also mean the backend does not serve the repo routes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Repository not found" }, 404))
    );

    const result = JSON.parse(await readDesignRepo({ repo: "acme/app" }));
    expect(result.error).toContain("does not serve the repo routes");
    expect(result.error).toContain("Repository not found");
  });
});

describe("read_design_repo with a local repo attached", () => {
  beforeEach(() => {
    useRepoContextStore.setState({ name: null, tree: [], filesByPath: new Map(), attachedAt: null });
  });

  it("ignores the repo/ref args and posts brief-local with only analyzer-relevant files", async () => {
    useRepoContextStore.getState().attach({
      name: "acme-app",
      tree: ["package.json", "src/App.tsx", "tailwind.config.ts", "src/index.css", "README.md"],
      files: [
        { path: "package.json", content: '{"name":"acme-app"}' },
        { path: "src/App.tsx", content: "export const App = () => null;" },
        { path: "tailwind.config.ts", content: "export default {};" },
        { path: "src/index.css", content: ":root { --brand: #000; }" },
        { path: "README.md", content: "# acme-app" },
      ],
    });
    const fetchMock = vi.fn(async () => jsonResponse({ ...BRIEF, source: "local" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(await readDesignRepo({ repo: "should-be-ignored" }));

    expect(result.source).toBe("local");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/repo\/brief-local$/);
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe("acme-app");
    expect(body.tree).toEqual([
      "package.json",
      "src/App.tsx",
      "tailwind.config.ts",
      "src/index.css",
      "README.md",
    ]);
    const sentPaths = body.files.map((f: { path: string }) => f.path).sort();
    expect(sentPaths).toEqual(["package.json", "src/index.css", "tailwind.config.ts"]);
    // README.md and src/App.tsx are not analyzer-relevant and must not be sent.
    expect(sentPaths).not.toContain("README.md");
    expect(sentPaths).not.toContain("src/App.tsx");
  });

  it("works with no repo/ref args at all when a local repo is attached", async () => {
    useRepoContextStore
      .getState()
      .attach({ name: "acme-app", files: [{ path: "package.json", content: "{}" }] });
    const fetchMock = vi.fn(async () => jsonResponse({ ...BRIEF, source: "local" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = JSON.parse(await readDesignRepo({}));
    expect(result.source).toBe("local");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an ignored repo argument alongside source: local instead of silently dropping it", async () => {
    useRepoContextStore
      .getState()
      .attach({ name: "acme-app", files: [{ path: "package.json", content: "{}" }] });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...BRIEF, source: "local" })));

    const result = JSON.parse(await readDesignRepo({ repo: "vercel/next.js" }));

    expect(result.source).toBe("local");
    expect(result.ignoredRepoArg).toBe("vercel/next.js");
  });

  it("omits ignoredRepoArg when no repo argument was sent", async () => {
    useRepoContextStore
      .getState()
      .attach({ name: "acme-app", files: [{ path: "package.json", content: "{}" }] });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...BRIEF, source: "local" })));

    const result = JSON.parse(await readDesignRepo({}));
    expect(result).not.toHaveProperty("ignoredRepoArg");
  });

  // buildDesignBriefFromSource (pen-editor-backend/src/services/
  // repoDesignSystem.ts) pushes tsconfig.json onto `keyFiles` for display
  // but never calls readFile("tsconfig.json") — sending its content here
  // buys the analyzer nothing.
  it("does not send tsconfig.json even when attached and analyzer-relevant-looking", async () => {
    useRepoContextStore.getState().attach({
      name: "acme-app",
      tree: ["package.json", "tsconfig.json"],
      files: [
        { path: "package.json", content: "{}" },
        { path: "tsconfig.json", content: '{"compilerOptions":{}}' },
      ],
    });
    const fetchMock = vi.fn(async () => jsonResponse({ ...BRIEF, source: "local" }));
    vi.stubGlobal("fetch", fetchMock);

    await readDesignRepo({});

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const sentPaths = body.files.map((f: { path: string }) => f.path);
    expect(sentPaths).not.toContain("tsconfig.json");
  });

  // The analyzer (findGlobalCssPath) reads exactly one global stylesheet —
  // sending every *.css file on every call re-POSTs files it will never
  // look at. This pins the cap plus the conventional-path preference.
  it("caps CSS files sent, preferring a conventional global-stylesheet path", async () => {
    useRepoContextStore.getState().attach({
      name: "acme-app",
      tree: [
        "package.json",
        "src/index.css",
        "src/components/Button.module.css",
        "src/other.css",
      ],
      files: [
        { path: "package.json", content: "{}" },
        { path: "src/index.css", content: ":root { --brand: #000; }" },
        { path: "src/components/Button.module.css", content: ".btn {}" },
        { path: "src/other.css", content: ".x {}" },
      ],
    });
    const fetchMock = vi.fn(async () => jsonResponse({ ...BRIEF, source: "local" }));
    vi.stubGlobal("fetch", fetchMock);

    await readDesignRepo({});

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const sentCssPaths = body.files
      .map((f: { path: string }) => f.path as string)
      .filter((p: string) => p.endsWith(".css"));
    // Only the conventional global stylesheet, not every CSS file attached.
    expect(sentCssPaths).toEqual(["src/index.css"]);
  });

  it("still sends package.json and a tailwind config unconditionally even with no CSS present", async () => {
    useRepoContextStore.getState().attach({
      name: "acme-app",
      tree: ["package.json", "tailwind.config.js"],
      files: [
        { path: "package.json", content: "{}" },
        { path: "tailwind.config.js", content: "module.exports = {};" },
      ],
    });
    const fetchMock = vi.fn(async () => jsonResponse({ ...BRIEF, source: "local" }));
    vi.stubGlobal("fetch", fetchMock);

    await readDesignRepo({});

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const sentPaths = body.files.map((f: { path: string }) => f.path).sort();
    expect(sentPaths).toEqual(["package.json", "tailwind.config.js"]);
  });
});
