import { describe, it, expect, afterEach, vi } from "vitest";
import { readDesignRepo } from "@/lib/tools/readDesignRepo";

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
