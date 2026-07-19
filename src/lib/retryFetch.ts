import { isOffline } from "@/lib/apiBase";

// Transport-level auto-retry for chat requests. Retries ONLY fetch-level
// network failures (TypeError: "Failed to fetch" / "Load failed" /
// "NetworkError"). HTTP responses of any status pass through untouched —
// repeating a 4xx/5xx usually doesn't fix it — and a stream that dies after
// it started is out of scope (retrying that would require regenerate(),
// which re-executes tool calls against the scene).
export interface RetryState {
  /** The retry about to run, 1-based. */
  attempt: number;
  /** Max retries after the initial failure. */
  maxAttempts: number;
}

export const RETRY_MAX_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 5000;

interface RetryingFetchOptions {
  maxAttempts?: number;
  delayMs?: number;
  onRetryStateChange: (state: RetryState | null) => void;
  fetchImpl?: typeof fetch;
}

export function createRetryingFetch(options: RetryingFetchOptions): typeof fetch {
  const {
    maxAttempts = RETRY_MAX_ATTEMPTS,
    delayMs = RETRY_DELAY_MS,
    onRetryStateChange,
    fetchImpl,
  } = options;

  return async function retryingFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    let retriesDone = 0;

    for (;;) {
      try {
        // Resolved per call so vi.stubGlobal("fetch", ...) in hook tests is
        // honored even when the wrapper was created earlier.
        const doFetch = fetchImpl ?? globalThis.fetch;
        const response = await doFetch(input, init);
        onRetryStateChange(null);
        return response;
      } catch (err) {
        const retryable =
          err instanceof TypeError &&
          signal?.aborted !== true &&
          !isOffline() &&
          retriesDone < maxAttempts;
        if (!retryable) {
          onRetryStateChange(null);
          throw err;
        }
        retriesDone += 1;
        onRetryStateChange({ attempt: retriesDone, maxAttempts });
        try {
          await abortableDelay(delayMs, signal);
        } catch (abortErr) {
          onRetryStateChange(null);
          throw abortErr;
        }
      }
    }
  };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("The operation was aborted.", "AbortError")
  );
}
