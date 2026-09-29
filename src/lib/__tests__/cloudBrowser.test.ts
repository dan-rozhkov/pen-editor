import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCloudBrowserBridge,
  releaseCloudBrowser,
  setCloudBrowserChat,
  cloudBrowserBridge,
} from "@/lib/cloudBrowser";
import { rehydrateCloudBrowserSessions, useCloudBrowserStore } from "@/store/cloudBrowserStore";
import { getUserId } from "@/lib/userId";
import { resolveApiUrl } from "@/lib/apiBase";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function stubFetch(...responses: Array<ReturnType<typeof jsonResponse> | Error>) {
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof stubFetch>, call = 0) {
  return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);
}

const OK = {
  result: { url: "https://example.com", title: "Example" },
  handle: "sess1.sig",
  liveViewUrl: "https://live.example/v/1",
  expiresAt: 1_900_000_000_000,
  idleMs: 60_000,
};

beforeEach(() => {
  sessionStorage.clear();
  useCloudBrowserStore.setState({ sessions: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cloudBrowserBridge", () => {
  it("posts userId, chatId and args to /api/browser/cmd/:name and returns the result", async () => {
    const fetchMock = stubFetch(jsonResponse(OK));
    const result = await getCloudBrowserBridge("chat-1").open({ url: "https://example.com" });

    expect(result).toEqual(OK.result);
    expect(fetchMock.mock.calls[0][0]).toBe(resolveApiUrl("/api/browser/cmd/open"));
    expect(bodyOf(fetchMock)).toEqual({
      userId: getUserId(),
      chatId: "chat-1",
      args: { url: "https://example.com" },
    });
  });

  it("maps every bridge method onto its command name", async () => {
    const fetchMock = stubFetch(jsonResponse({ result: {} }));
    const bridge = getCloudBrowserBridge("chat-names");
    await bridge.act({});
    await bridge.findImages({});
    await bridge.read({});
    await bridge.snapshot();
    await bridge.perform({ snapshotId: "s", operation: "CLICK" });
    await bridge.screenshot?.({ annotate: true });
    await bridge.tabs?.({ action: "list" });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      resolveApiUrl("/api/browser/cmd/act"),
      resolveApiUrl("/api/browser/cmd/findImages"),
      resolveApiUrl("/api/browser/cmd/read"),
      resolveApiUrl("/api/browser/cmd/snapshot"),
      resolveApiUrl("/api/browser/cmd/perform"),
      resolveApiUrl("/api/browser/cmd/screenshot"),
      resolveApiUrl("/api/browser/cmd/tabs"),
    ]);
  });

  it("persists the handle per chat in memory and sessionStorage and sends it next time", async () => {
    const fetchMock = stubFetch(jsonResponse(OK));
    const bridge = getCloudBrowserBridge("chat-2");
    await bridge.open({ url: "https://example.com" });
    expect(sessionStorage.getItem("pen.cloudBrowser.chat-2")).toBe("sess1.sig");

    await bridge.snapshot();
    expect(bodyOf(fetchMock, 1).handle).toBe("sess1.sig");

    // Another chat does not inherit it.
    await getCloudBrowserBridge("chat-other").snapshot();
    expect(bodyOf(fetchMock, 2).handle).toBeUndefined();
  });

  it("reuses a handle mirrored in sessionStorage after a reload", async () => {
    sessionStorage.setItem("pen.cloudBrowser.chat-reload", "old.sig");
    const fetchMock = stubFetch(jsonResponse({ result: {} }));
    await getCloudBrowserBridge("chat-reload").snapshot();
    expect(bodyOf(fetchMock).handle).toBe("old.sig");
  });

  it("survives sessionStorage throwing", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const fetchMock = stubFetch(jsonResponse(OK));
    const bridge = getCloudBrowserBridge("chat-blocked");
    await expect(bridge.open({ url: "https://example.com" })).resolves.toEqual(OK.result);
    await bridge.snapshot();
    expect(bodyOf(fetchMock, 1).handle).toBe("sess1.sig");
  });

  it("fills the live-view store from the response", async () => {
    stubFetch(jsonResponse(OK));
    await getCloudBrowserBridge("chat-3").open({ url: "https://example.com" });
    expect(useCloudBrowserStore.getState().sessions["chat-3"]).toEqual({
      liveViewUrl: OK.liveViewUrl,
      expiresAt: OK.expiresAt,
      lastUsedAt: expect.any(Number),
      idleMs: 60_000,
    });
    // Persisted so a reload can rehydrate it.
    rehydrateCloudBrowserSessions();
    expect(useCloudBrowserStore.getState().sessions["chat-3"]?.liveViewUrl).toBe(OK.liveViewUrl);
  });

  it("passes controller {error} results through as data", async () => {
    stubFetch(jsonResponse({ result: { error: "stale snapshotId" }, handle: "sess1.sig" }));
    await expect(getCloudBrowserBridge("chat-4").snapshot()).resolves.toEqual({
      error: "stale snapshotId",
    });
  });

  it("clears the handle and live view when the session expired", async () => {
    sessionStorage.setItem("pen.cloudBrowser.chat-5", "old.sig");
    useCloudBrowserStore.getState().setSession("chat-5", { liveViewUrl: "u", expiresAt: null });
    stubFetch(
      jsonResponse({
        result: { error: "Cloud browser session expired — call browse_open again.", sessionExpired: true },
      })
    );
    const result = await getCloudBrowserBridge("chat-5").snapshot();
    expect(result).toMatchObject({ sessionExpired: true });
    expect(sessionStorage.getItem("pen.cloudBrowser.chat-5")).toBeNull();
    expect(useCloudBrowserStore.getState().sessions["chat-5"]).toBeUndefined();
  });

  it("resolves 429/503 with the server's message and never rejects", async () => {
    stubFetch(jsonResponse({ error: "All cloud browsers are busy — try again in a few minutes." }, 503));
    await expect(getCloudBrowserBridge("chat-6").open({ url: "https://x.io" })).resolves.toEqual({
      error: "All cloud browsers are busy — try again in a few minutes.",
    });
    stubFetch(jsonResponse({ error: "Daily limit reached." }, 429));
    await expect(getCloudBrowserBridge("chat-6").open({ url: "https://x.io" })).resolves.toEqual({
      error: "Daily limit reached.",
    });
  });

  it("falls back to a generic message on an unreadable error body", async () => {
    stubFetch({ ok: false, status: 500, json: async () => { throw new Error("bad json"); } } as never);
    const result = (await getCloudBrowserBridge("chat-7").snapshot()) as { error: string };
    expect(result.error).toContain("HTTP 500");
  });

  it("forgets the handle on 403", async () => {
    sessionStorage.setItem("pen.cloudBrowser.chat-8", "bad.sig");
    stubFetch(jsonResponse({ error: "Invalid browser handle." }, 403));
    await expect(getCloudBrowserBridge("chat-8").snapshot()).resolves.toEqual({
      error: "Invalid browser handle.",
    });
    expect(sessionStorage.getItem("pen.cloudBrowser.chat-8")).toBeNull();
  });

  it("maps a network failure to {error} instead of rejecting", async () => {
    stubFetch(new Error("network down"));
    const result = (await getCloudBrowserBridge("chat-9").snapshot()) as { error: string };
    expect(result.error).toContain("network down");
  });

  it("follows setCloudBrowserChat when no chat is bound", async () => {
    const fetchMock = stubFetch(jsonResponse({ result: {} }));
    setCloudBrowserChat("chat-fallback");
    await cloudBrowserBridge.snapshot();
    expect(bodyOf(fetchMock).chatId).toBe("chat-fallback");
  });
});

describe("per-chat serialization", () => {
  it("sends 3 concurrent opens one at a time, later ones carrying the first's handle", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const bodies: Array<{ handle?: string }> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return jsonResponse(OK);
    });
    vi.stubGlobal("fetch", fetchMock);
    const bridge = getCloudBrowserBridge("chat-mutex");
    await Promise.all([
      bridge.open({ url: "https://a.io" }),
      bridge.open({ url: "https://b.io" }),
      bridge.open({ url: "https://c.io" }),
    ]);
    expect(maxInFlight).toBe(1);
    expect(bodies.map((b) => b.handle)).toEqual([undefined, "sess1.sig", "sess1.sig"]);
  });

  it("does not serialize different chats", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return jsonResponse({ result: {} });
      })
    );
    await Promise.all([
      getCloudBrowserBridge("chat-x").snapshot(),
      getCloudBrowserBridge("chat-y").snapshot(),
    ]);
    expect(maxInFlight).toBe(2);
  });
});

describe("fetch timeout", () => {
  it("resolves {error} when the request hangs past the command budget", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise((_res, rej) => {
              init!.signal!.addEventListener("abort", () =>
                rej(new DOMException("aborted", "AbortError"))
              );
            })
        )
      );
      const p = getCloudBrowserBridge("chat-to").open({ url: "https://x.io" });
      await vi.advanceTimersByTimeAsync(145_000);
      await expect(p).resolves.toEqual({ error: "Cloud browser timed out — try again." });
      // A following command still works (queue not poisoned).
      stubFetch(jsonResponse({ result: { ok: 1 } }));
      await expect(getCloudBrowserBridge("chat-to").snapshot()).resolves.toEqual({ ok: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("queued command budget", () => {
  it("counts queue wait against the budget and skips the request once expired", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_res, rej) => {
            init!.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
          })
      );
      vi.stubGlobal("fetch", fetchMock);
      const bridge = getCloudBrowserBridge("chat-queued");
      const first = bridge.open({ url: "https://x.io" }); // budget 145s
      const second = bridge.snapshot(); // default budget 85s, queued behind
      await vi.advanceTimersByTimeAsync(145_000);
      await expect(first).resolves.toEqual({ error: "Cloud browser timed out — try again." });
      await expect(second).resolves.toEqual({ error: "Cloud browser timed out — try again." });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("release ordering", () => {
  it("does not adopt a handle from an open in flight during release, and releases it", async () => {
    let resolveOpen!: (r: unknown) => void;
    const calls: Array<{ url: string; body: { handle?: string } }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, body: JSON.parse(init!.body as string) });
        if (url.endsWith("/cmd/open")) return new Promise((r) => { resolveOpen = r; });
        return Promise.resolve(jsonResponse({ released: true }));
      })
    );
    const bridge = getCloudBrowserBridge("chat-rel-open");
    const opening = bridge.open({ url: "https://x.io" });
    const released = releaseCloudBrowser("chat-rel-open");
    await vi.waitFor(() => expect(resolveOpen).toBeTypeOf("function"));
    resolveOpen(jsonResponse(OK));
    await opening;
    await released;
    expect(sessionStorage.getItem("pen.cloudBrowser.chat-rel-open")).toBeNull();
    expect(useCloudBrowserStore.getState().sessions["chat-rel-open"]).toBeUndefined();
    const rel = calls.filter((c) => c.url.endsWith("/api/browser/release"));
    expect(rel.map((c) => c.body.handle)).toEqual(["sess1.sig"]);
  });

  it("runs the release after in-flight commands, and later commands start fresh", async () => {
    sessionStorage.setItem("pen.cloudBrowser.chat-rel-order", "h.sig");
    const order: string[] = [];
    let finishSnapshot!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        order.push(url.split("/").pop()!);
        if (url.endsWith("/cmd/snapshot")) {
          return new Promise((r) => { finishSnapshot = () => r(jsonResponse({ result: {}, handle: "h.sig" })); });
        }
        return Promise.resolve(jsonResponse(url.endsWith("/release") ? { released: true } : OK));
      })
    );
    const bridge = getCloudBrowserBridge("chat-rel-order");
    const snap = bridge.snapshot();
    const released = releaseCloudBrowser("chat-rel-order");
    await Promise.resolve();
    expect(order).toEqual(["snapshot"]);
    finishSnapshot();
    await snap;
    await expect(released).resolves.toBe(true);
    expect(order).toEqual(["snapshot", "release"]);
    expect(sessionStorage.getItem("pen.cloudBrowser.chat-rel-order")).toBeNull();

    await bridge.open({ url: "https://x.io" });
    expect(sessionStorage.getItem("pen.cloudBrowser.chat-rel-order")).toBe("sess1.sig");
  });
});

describe("releaseCloudBrowser", () => {
  it("posts the handle to /api/browser/release and clears local state", async () => {
    sessionStorage.setItem("pen.cloudBrowser.chat-r", "h.sig");
    useCloudBrowserStore.getState().setSession("chat-r", { liveViewUrl: "u", expiresAt: null });
    const fetchMock = stubFetch(jsonResponse({ released: true }));

    await expect(releaseCloudBrowser("chat-r")).resolves.toBe(true);

    expect(fetchMock.mock.calls[0][0]).toBe(resolveApiUrl("/api/browser/release"));
    expect(bodyOf(fetchMock)).toEqual({ userId: getUserId(), chatId: "chat-r", handle: "h.sig" });
    expect(sessionStorage.getItem("pen.cloudBrowser.chat-r")).toBeNull();
    expect(useCloudBrowserStore.getState().sessions["chat-r"]).toBeUndefined();
  });

  it("does nothing on the network without a handle", async () => {
    const fetchMock = stubFetch(jsonResponse({ released: true }));
    await expect(releaseCloudBrowser("chat-none")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never rejects when the release request fails", async () => {
    sessionStorage.setItem("pen.cloudBrowser.chat-f", "h.sig");
    stubFetch(new Error("offline"));
    await expect(releaseCloudBrowser("chat-f")).resolves.toBe(false);
    expect(sessionStorage.getItem("pen.cloudBrowser.chat-f")).toBeNull();
  });
});
