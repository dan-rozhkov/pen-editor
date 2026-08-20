import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchShowcase,
  fetchShowcaseCategories,
  fetchShowcaseModels,
  likeShowcaseApp,
  resolveShowcaseApiUrl,
} from "@/lib/showcase";
import { assertErr, assertField, assertOk } from "@/test/assertions";

afterEach(() => vi.restoreAllMocks());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const validApp = {
  runId: "run-1",
  theme: "fitness",
  model: "gemini",
  createdAt: "2026-07-01T00:00:00Z",
  likes: 3,
  screens: [
    {
      id: "screen-1",
      title: "Home",
      imageUrl: "https://example.com/a.png",
      htmlUrl: "https://example.com/a.html",
      width: 390,
      height: 844,
      createdAt: "2026-07-01T00:00:00Z",
    },
  ],
};

describe("fetchShowcase", () => {
  it("passes through a well-formed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ apps: [validApp], nextCursor: "cursor-2" })),
    );

    const result = await fetchShowcase();
    assertOk(result);
    expect(result.data.apps).toHaveLength(1);
    expect(result.data.apps[0].runId).toBe("run-1");
    expect(result.data.nextCursor).toBe("cursor-2");
  });

  it("tolerates unknown extra fields and missing optional fields (no false positive on API growth)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          apps: [{ ...validApp, somethingNew: { nested: true } }],
          nextCursor: null,
          anotherNewTopLevelField: 42,
        }),
      ),
    );

    const result = await fetchShowcase();
    assertOk(result);
    expect(result.data.apps).toHaveLength(1);
    expect(result.data.apps[0].platform).toBeUndefined();
  });

  it("rejects the old {screens: [...]} shape instead of crashing, with a reload hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ screens: [{ id: "a" }], nextCursor: null })),
    );

    const result = await fetchShowcase();
    assertErr(result);
    assertField(result, "notConfigured", false);
    expect(result.error).toMatch(/reload/i);
  });

  it("treats apps: null the same as a malformed envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ apps: null, nextCursor: null })));

    const result = await fetchShowcase();
    expect(result.ok).toBe(false);
  });

  it("drops an app missing runId but keeps the rest of the page", async () => {
    const { runId: _runId, ...appWithoutRunId } = validApp;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          apps: [appWithoutRunId, { ...validApp, runId: "run-2" }],
          nextCursor: null,
        }),
      ),
    );

    const result = await fetchShowcase();
    assertOk(result);
    expect(result.data.apps).toHaveLength(1);
    expect(result.data.apps[0].runId).toBe("run-2");
  });

  it("drops an app whose screens is not an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ apps: [{ ...validApp, screens: "nope" }], nextCursor: null }),
      ),
    );

    const result = await fetchShowcase();
    assertOk(result);
    expect(result.data.apps).toHaveLength(0);
  });

  it("drops an app whose screens array is empty (app.screens[0] is read unconditionally)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ apps: [{ ...validApp, screens: [] }], nextCursor: null })),
    );

    const result = await fetchShowcase();
    assertOk(result);
    expect(result.data.apps).toHaveLength(0);
  });

  it("returns a stale-client error instead of throwing on a non-JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>not json</html>", { status: 200 })),
    );

    const result = await fetchShowcase();
    assertErr(result);
    assertField(result, "notConfigured", false);
    expect(result.error).toMatch(/reload/i);
  });
});

describe("resolveShowcaseApiUrl", () => {
  it("omits model when unset", () => {
    const url = resolveShowcaseApiUrl(null, undefined, { sort: "popular" });
    expect(url).not.toContain("model=");
  });

  it("includes model when set", () => {
    const url = resolveShowcaseApiUrl(null, undefined, { model: "deepseek/deepseek-v4-pro" });
    expect(url).toContain(`model=${encodeURIComponent("deepseek/deepseek-v4-pro")}`);
  });
});

describe("fetchShowcaseModels", () => {
  it("passes through a well-formed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ models: [{ model: "deepseek/deepseek-v4-pro", apps: 12 }] }),
      ),
    );

    const result = await fetchShowcaseModels();
    expect(result).toEqual({
      ok: true,
      models: [{ model: "deepseek/deepseek-v4-pro", apps: 12 }],
    });
  });

  it("skips malformed entries rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          models: [{ model: "deepseek/deepseek-v4-pro", apps: 12 }, { apps: 3 }, "nope"],
        }),
      ),
    );

    const result = await fetchShowcaseModels();
    expect(result).toEqual({
      ok: true,
      models: [{ model: "deepseek/deepseek-v4-pro", apps: 12 }],
    });
  });

  it("resolves to ok:false instead of throwing when models is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ notModels: [] })));

    const result = await fetchShowcaseModels();
    expect(result).toEqual({ ok: false });
  });

  it("resolves to ok:false on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 500)));

    const result = await fetchShowcaseModels();
    expect(result).toEqual({ ok: false });
  });

  it("resolves to ok:false on a non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 200 })));

    const result = await fetchShowcaseModels();
    expect(result).toEqual({ ok: false });
  });

  it("resolves to ok:false instead of throwing on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await fetchShowcaseModels();
    expect(result).toEqual({ ok: false });
  });
});

describe("fetchShowcaseCategories", () => {
  it("passes through a well-formed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ categories: [{ theme: "fitness", apps: 5 }] })),
    );

    const result = await fetchShowcaseCategories();
    expect(result).toEqual({ ok: true, categories: [{ theme: "fitness", apps: 5 }] });
  });

  it("resolves to ok:false instead of throwing when categories is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ notCategories: [] })));

    const result = await fetchShowcaseCategories();
    expect(result).toEqual({ ok: false });
  });

  it("resolves to ok:false on a non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 200 })));

    const result = await fetchShowcaseCategories();
    expect(result).toEqual({ ok: false });
  });
});

describe("likeShowcaseApp", () => {
  it("passes through a well-formed response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ likes: 7 })));

    const result = await likeShowcaseApp("run-1", 1);
    expect(result).toEqual({ ok: true, likes: 7 });
  });

  it("resolves to ok:false instead of throwing when likes is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ notLikes: 7 })));

    const result = await likeShowcaseApp("run-1", 1);
    expect(result).toEqual({ ok: false });
  });

  it("resolves to ok:false when likes has the wrong type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ likes: "7" })));

    const result = await likeShowcaseApp("run-1", 1);
    expect(result).toEqual({ ok: false });
  });

  it("resolves to ok:false on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 500)));

    const result = await likeShowcaseApp("run-1", 1);
    expect(result).toEqual({ ok: false });
  });

  it("resolves to ok:false on a non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 200 })));

    const result = await likeShowcaseApp("run-1", 1);
    expect(result).toEqual({ ok: false });
  });

  it("resolves to ok:false instead of throwing on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await likeShowcaseApp("run-1", 1);
    expect(result).toEqual({ ok: false });
  });
});
