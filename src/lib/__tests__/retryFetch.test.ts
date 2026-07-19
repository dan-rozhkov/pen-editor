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

describe("createRetryingFetch", () => {
  const states: Array<RetryState | null> = [];
  const onRetryStateChange = (s: RetryState | null) => states.push(s);

  beforeEach(() => {
    offlineFlag = false;
    states.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    await vi.advanceTimersByTimeAsync(5000); // pause before retry 1
    await vi.advanceTimersByTimeAsync(5000); // pause before retry 2

    await expect(promise).resolves.toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(states).toEqual([
      { attempt: 1, maxAttempts: 3 },
      { attempt: 2, maxAttempts: 3 },
      null,
    ]);
  });

  it("waits 5 seconds before each retry (no early retry)", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(new Response("ok"));
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBeInstanceOf(Response);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns non-ok HTTP responses as-is without retrying", async () => {
    const serverError = new Response("boom", { status: 500 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(serverError);
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    await expect(retryingFetch("/api/chat")).resolves.toBe(serverError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(states).toEqual([null]);
  });

  it("rejects with the last error after exhausting retries", async () => {
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
    await vi.advanceTimersByTimeAsync(15_000); // 3 pauses

    await expect(promise).rejects.toBe(lastError);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(states).toEqual([
      { attempt: 1, maxAttempts: 3 },
      { attempt: 2, maxAttempts: 3 },
      { attempt: 3, maxAttempts: 3 },
      null,
    ]);
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

  it("aborting during the pause rejects promptly with the abort reason", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(networkError());
    const retryingFetch = createRetryingFetch({ onRetryStateChange, fetchImpl });

    const promise = retryingFetch("/api/chat", { signal: controller.signal });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000); // mid-pause
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry fired
    expect(states).toEqual([{ attempt: 1, maxAttempts: 3 }, null]);
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
    await vi.advanceTimersByTimeAsync(5000);
    await expect(first).resolves.toBeInstanceOf(Response);

    const second = retryingFetch("/api/chat");
    await vi.advanceTimersByTimeAsync(5000);
    await expect(second).resolves.toBeInstanceOf(Response);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
