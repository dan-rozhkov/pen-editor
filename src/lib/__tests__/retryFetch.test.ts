import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRetryingFetch, type RetryState } from "@/lib/retryFetch";
import { OFFLINE_MESSAGE } from "@/lib/apiBase";

// isOffline reads navigator.onLine; toggle it per-test via the mock below.
let offlineFlag = false;
vi.mock("@/lib/apiBase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apiBase")>();
  return { ...actual, isOffline: () => offlineFlag };
});

function networkError(): TypeError {
  return new TypeError("Failed to fetch");
}

function httpResponse(status: number, headers?: Record<string, string>): Response {
  return new Response("boom", { status, headers });
}

describe("createRetryingFetch", () => {
  const states: Array<RetryState | null> = [];
  const onRetryStateChange = (s: RetryState | null) => states.push(s);

  beforeEach(() => {
    offlineFlag = false;
    states.length = 0;
    vi.useFakeTimers();
    // Deterministic backoff: jitter factor becomes 1 - 0 * 0.25 = 1, so the
    // delay for attempt N is exactly base * 2**(N-1).
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries network TypeErrors and succeeds, reporting attempt states", async () => {
    const ok = new Response("ok");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(ok);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat", { method: "POST" });
    await vi.advanceTimersByTimeAsync(1000); // pause before retry 1 (1000 * 2**0)
    await vi.advanceTimersByTimeAsync(2000); // pause before retry 2 (1000 * 2**1)

    await expect(promise).resolves.toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(states).toEqual([
      { attempt: 1, maxAttempts: 3, reason: "network", delayMs: 1000 },
      { attempt: 2, maxAttempts: 3, reason: "network", delayMs: 2000 },
      null,
    ]);
  });

  it("backs off exponentially before each network retry (no early retry)", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(new Response("ok"));
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBeInstanceOf(Response);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns success responses immediately without retrying", async () => {
    const ok = new Response("ok", { status: 200 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    await expect(retryingFetch("/api/chat")).resolves.toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(states).toEqual([null]);
  });

  it("does not retry non-retryable 4xx statuses", async () => {
    const badRequest = httpResponse(400);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(badRequest);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    await expect(retryingFetch("/api/chat")).resolves.toBe(badRequest);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(states).toEqual([null]);
  });

  it("retries a 503 and succeeds on the second attempt", async () => {
    const serverError = httpResponse(503);
    const ok = new Response("ok", { status: 200 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(serverError)
      .mockResolvedValueOnce(ok);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(1000); // backoff before retry 1

    await expect(promise).resolves.toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(states).toEqual([
      { attempt: 1, maxAttempts: 3, reason: "http-status", delayMs: 1000 },
      null,
    ]);
  });

  it("rejects with the last network error after exhausting retries", async () => {
    const lastError = new TypeError("Load failed");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(lastError);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    promise.catch(() => {}); // avoid unhandled-rejection noise while advancing
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000); // 3 pauses

    await expect(promise).rejects.toBe(lastError);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(states).toEqual([
      { attempt: 1, maxAttempts: 3, reason: "network", delayMs: 1000 },
      { attempt: 2, maxAttempts: 3, reason: "network", delayMs: 2000 },
      { attempt: 3, maxAttempts: 3, reason: "network", delayMs: 4000 },
      null,
    ]);
  });

  it("gives up on a retryable status once retries are exhausted", async () => {
    const serverError = httpResponse(503);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(serverError);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000); // 3 pauses

    await expect(promise).resolves.toBe(serverError);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it("does not retry non-TypeError rejections", async () => {
    const err = new Error("programming error");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(err);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    await expect(retryingFetch("/api/chat")).rejects.toBe(err);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(states).toEqual([null]);
    expect(vi.getTimerCount()).toBe(0); // no pause was scheduled
  });

  it("does not retry when the signal is already aborted", async () => {
    const controller = new AbortController();
    const err = networkError();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort(); // user hits Stop while the request is in flight
      throw err;
    });
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    await expect(
      retryingFetch("/api/chat", { signal: controller.signal }),
    ).rejects.toBe(err);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(states).toEqual([null]);
  });

  it("aborting during the network-retry pause rejects promptly with the abort reason", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(networkError());
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat", { signal: controller.signal });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(500); // mid-pause (backoff is 1000ms)
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry fired
    expect(states).toEqual([
      { attempt: 1, maxAttempts: 3, reason: "network", delayMs: 1000 },
      null,
    ]);
  });

  it("aborting during an HTTP-status backoff pause rejects promptly", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(httpResponse(503));
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat", { signal: controller.signal });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(500); // mid-pause (backoff is 1000ms)
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry fired
    expect(states).toEqual([
      { attempt: 1, maxAttempts: 3, reason: "http-status", delayMs: 1000 },
      null,
    ]);
  });

  it("does not retry while offline", async () => {
    offlineFlag = true;
    const err = networkError();
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(err);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    await expect(retryingFetch("/api/chat")).rejects.toMatchObject({
      message: OFFLINE_MESSAGE,
      cause: err,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(states).toEqual([null]);
  });

  it("gives each invocation a fresh retry budget", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(new Response("a"))
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(new Response("b"));
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const first = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(first).resolves.toBeInstanceOf(Response);

    const second = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(second).resolves.toBeInstanceOf(Response);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("respects x-should-retry: false and does not retry a normally-retryable status", async () => {
    const response = httpResponse(503, { "x-should-retry": "false" });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    await expect(retryingFetch("/api/chat")).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(states).toEqual([null]);
  });

  it("respects x-should-retry: true and retries a normally-non-retryable status", async () => {
    const first = httpResponse(400, { "x-should-retry": "true" });
    const ok = new Response("ok", { status: 200 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(ok);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("respects Retry-After given as a number of seconds", async () => {
    const response = httpResponse(429, { "retry-after": "2" });
    const ok = new Response("ok", { status: 200 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(ok);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("respects retry-after-ms over Retry-After when both are present", async () => {
    const response = httpResponse(429, {
      "retry-after-ms": "500",
      "retry-after": "30",
    });
    const ok = new Response("ok", { status: 200 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(ok);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("respects Retry-After given as an HTTP-date", async () => {
    const now = new Date("2026-08-21T12:00:00Z");
    vi.setSystemTime(now);
    const httpDate = new Date(now.getTime() + 3000).toUTCString();
    const response = httpResponse(503, { "retry-after": httpDate });
    const ok = new Response("ok", { status: 200 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(ok);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up without retrying when the server-requested delay exceeds the cap", async () => {
    const response = httpResponse(429, { "retry-after": "31" }); // > 30_000ms cap
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    await expect(retryingFetch("/api/chat")).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(states).toEqual([null]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the failed response body before retrying", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const body = { cancel } as unknown as ReadableStream<Uint8Array>;
    const response = httpResponse(503);
    Object.defineProperty(response, "body", { value: body });
    const ok = new Response("ok", { status: 200 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(ok);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe(ok);

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 500/502/504 — the server may have already run the turn", async () => {
    for (const status of [500, 502, 504]) {
      states.length = 0;
      const failed = httpResponse(status);
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(failed);
      const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

      await expect(retryingFetch("/api/chat")).resolves.toBe(failed);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(states).toEqual([null]);
    }
  });

  it("retries a 500 when the server opts in with x-should-retry: true", async () => {
    const ok = new Response("ok", { status: 200 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(httpResponse(500, { "x-should-retry": "true" }))
      .mockResolvedValueOnce(ok);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a blank Retry-After as absent and still backs off", async () => {
    const ok = new Response("ok", { status: 200 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(httpResponse(503, { "retry-after": "  " }))
      .mockResolvedValueOnce(ok);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    // A blank header must not collapse the wait to 0ms.
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(promise).resolves.toBe(ok);
    expect(states).toEqual([
      { attempt: 1, maxAttempts: 3, reason: "http-status", delayMs: 1000 },
      null,
    ]);
  });
});
