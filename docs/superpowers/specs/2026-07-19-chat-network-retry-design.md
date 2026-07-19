# Chat network auto-retry — design

**Date:** 2026-07-19
**Status:** Approved

## Problem

The design agent occasionally stops with a network error: the `/api/chat` request
fails at the fetch level (connection refused, DNS blip, dropped connection before
the stream starts). Today this surfaces as a red `chat.error` and the user must
resend manually. This is especially painful mid-turn: the auto-continuation
requests of the tool loop (`sendAutomaticallyWhen`) go over the network too, and
one failed continuation kills the whole agent turn.

## Goal

Automatically retry failed chat requests: up to **3 retries** after the initial
failure (at most 4 requests total), with a **5-second** pause before each
retry, with a visible neutral status line while retrying. Only network-level
failures are retried.

## Non-goals

- Retrying HTTP error responses (4xx/5xx/529). Any `Response`, whatever its
  status, is returned as-is — repeating usually doesn't fix those, and a 5xx
  during a Render deploy would burn 15 s for nothing.
- Retrying a stream that dies **after** it started. The only AI SDK mechanism
  for that is `regenerate()`, which deletes the last assistant message and
  replays it — re-executing tool calls and mutating the scene a second time.
  Mid-stream drops keep the current behavior (error + manual retry).
- Retrying while the browser is offline. The existing offline path
  (`isOffline()` guard + queued launch payloads) already handles that.

## Design

### `src/lib/retryFetch.ts` — transport-level retrying fetch

```ts
export interface RetryState {
  attempt: number;      // the retry about to run (1-based)
  maxAttempts: number;  // max retries after the initial failure; 3
}

export function createRetryingFetch(options: {
  maxAttempts?: number;                                  // max retries, default 3
  delayMs?: number;                                      // default 5000
  onRetryStateChange: (state: RetryState | null) => void;
  fetchImpl?: typeof fetch;                              // for tests
}): typeof fetch;
```

Behavior of the returned `fetch`:

1. Call the underlying fetch. If it resolves (any status) → report `null` retry
   state, return the `Response`.
2. If it rejects, retry **only when all of**:
   - the error is a network failure: `err instanceof TypeError` (covers
     Chrome's `Failed to fetch`, Safari's `Load failed`, Firefox's
     `NetworkError`);
   - the request's `AbortSignal` is not aborted (user pressed Stop — never
     retry an intentional cancel);
   - the browser is not offline (`isOffline()` from `@/lib/apiBase`) — offline
     has its own path and retrying against no connection is noise;
   - retries remain (fewer than `maxAttempts` retries performed).
3. Before waiting, report `{ attempt, maxAttempts }` so the UI can show the
   countdown. Wait `delayMs` with a cancelable timer that listens to the same
   `AbortSignal`; an abort during the pause rejects immediately with the abort
   reason (`DOMException` `AbortError`), so Stop works mid-pause.
4. On the final failure (or a non-retryable rejection), report `null` and
   rethrow the original error — it flows into the existing `chat.error` path
   unchanged.

The wrapper is stateless across calls: each `fetch()` invocation gets its own
attempt counter, so the first message and every auto-continuation request each
get a fresh 3-retry budget.

### `useDesignChat` integration

- New hook state: `retryState: RetryState | null`.
- The memoized transport passes the wrapper via `DefaultChatTransport`'s
  `fetch` option: `createRetryingFetch({ onRetryStateChange: setRetryState })`.
  The transport memo keeps its current `[sessionId]` dependency; the callback
  is a stable `useState` setter.
- The hook returns `retryState` alongside the existing fields.

### Chat panel UI

Where the chat panel currently renders the error / loading indicator: when
`retryState != null`, show a neutral (non-red) status line —
«Сетевая ошибка, повтор через 5 с (попытка N/3)…» — instead of the error
block. The red error only appears after all attempts are exhausted (or for
non-retryable errors, immediately, as today). While retrying, `chat.status`
stays `submitted`/`streaming`, so the existing spinner/Stop affordances remain
correct.

## Error handling

- **User Stop during pause or between attempts:** the abort listener rejects
  the pause; the wrapper reports `null` and rethrows the abort — `useChat`
  treats it as a normal stop.
- **Non-TypeError rejections** (programming errors, aborts): rethrown
  immediately, no retry, state `null`.
- **Retry succeeds:** state resets to `null` before the `Response` is
  returned; streaming proceeds as if nothing happened.

## Testing

- **Unit — `src/lib/__tests__/retryFetch.test.ts`** (fake timers):
  - network `TypeError` twice → success on 3rd request (2nd retry): returns
    the response, state callback saw `{1,3}`, `{2,3}`, then `null`;
  - resolved `Response` with status 500 → returned as-is, no retry;
  - 4 consecutive `TypeError`s (initial + 3 retries) → rejects with the last
    error, final state `null`;
  - non-TypeError rejection → immediate rethrow, no timer scheduled;
  - abort during the 5 s pause → rejects promptly with `AbortError`;
  - offline (`isOffline()` mocked true) → immediate rethrow, no retry.
- **Hook — extend `src/hooks/__tests__/useDesignChat.test.ts`**: stubbed fetch
  rejects with `TypeError` twice, then returns a valid SSE stream → the
  assistant message arrives, `retryState` transitioned through attempts and
  ended `null`. Uses the existing SSE chunk-format fixtures and fake timers.
- **UI**: the status line is a small conditional render; covered by the hook
  test's `retryState` contract (no dedicated component test).
