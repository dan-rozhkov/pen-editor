import { vi } from "vitest";
import { toolHandlers, type ToolHandler } from "@/lib/toolRegistry";
import { useBrowseAgentPhaseStore } from "@/store/browseAgentPhaseStore";

// Shared arrange helpers for the browser-tool unit tests
// (browseTask.test.ts, browserTools.test.ts). Extracted to keep
// check:dup:tests under its ratchet baseline — see CLAUDE.md -> Testing.

export type PenDesktopBrowser = NonNullable<NonNullable<typeof window.penDesktop>["browser"]>;

/**
 * Builds a `window.penDesktop.browser` stub with every method defaulted to a
 * no-op resolved value. Pass `overrides` for the methods a test cares about,
 * and `defaultSnapshot` when the suite wants `snapshot()` to resolve to
 * something other than `{}` by default (most browseTask.test.ts scenarios
 * want a real single-button page so the loop has something to act on).
 */
export function stubBrowser(
  overrides: Partial<PenDesktopBrowser> = {},
  defaultSnapshot: unknown = {}
): PenDesktopBrowser {
  return {
    open: async () => ({}),
    act: async () => ({}),
    findImages: async () => ({}),
    read: async () => ({}),
    snapshot: async () => defaultSnapshot,
    perform: async () => ({}),
    ...overrides,
  };
}

/** Installs a browser stub as `window.penDesktop.browser` and returns it. */
export function setPenDesktop(browser: PenDesktopBrowser): PenDesktopBrowser {
  window.penDesktop = {
    onMenuCommand: () => () => {},
    browser,
  };
  return browser;
}

// Every /api/browse/step call in these tests returns one JSON payload from a
// fixed sequence — the Nth call gets payloads[N], and the last entry repeats
// once exhausted (so a two-item sequence models "act once, then done
// forever"). `onRequest` is only wired up by the tests that also need to
// inspect the request body the loop sent.
export function stubFetchSequence(
  payloads: Array<Record<string, unknown>>,
  onRequest?: (init: RequestInit) => void
) {
  let calls = 0;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    onRequest?.(init as RequestInit);
    const payload = payloads[Math.min(calls, payloads.length - 1)];
    calls++;
    return { ok: true, json: async () => payload };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Stubs a single, non-sequenced /api/browse/locate response (status 200 by
 * default). Element-targeting tests only ever make one locate call per case.
 */
export function stubLocateFetch(payload: Record<string, unknown>, status = 200) {
  const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => payload }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Shared arrange for the browse_agent fixture/checkpoint suites
// (browseAgentFixture.test.ts, browseAgentCheckpoint.test.ts).

/** applyFixture/releaseFixture mocks that succeed with token `tok` (default `tok-1`). */
export function fixtureBridgeMocks(token = "tok-1") {
  return {
    applyFixture: vi.fn(async () => ({ ok: true, summary: "1 step run", fixtureToken: token })),
    releaseFixture: vi.fn(async () => ({ ok: true })),
  };
}

/** Stubs browse_open / browse_snapshot; the returned function restores the originals. */
export function stubBrowseOpenSnapshot(): () => void {
  const names = ["browse_open", "browse_snapshot"];
  const saved: Record<string, ToolHandler | undefined> = Object.fromEntries(names.map((n) => [n, toolHandlers[n]]));
  toolHandlers.browse_open = vi.fn(async () => "{}");
  toolHandlers.browse_snapshot = vi.fn(async () => '{"snapshot":"SNAP"}');
  return () => {
    for (const n of names) {
      if (saved[n]) toolHandlers[n] = saved[n];
      else delete toolHandlers[n];
    }
  };
}

/** Undoes what the fixture/checkpoint suites install: bridge, fetch stubs, phase store. */
export function cleanupBrowseAgentTest(restoreHandlers: () => void): void {
  restoreHandlers();
  delete window.penDesktop;
  vi.unstubAllGlobals();
  useBrowseAgentPhaseStore.setState({ phases: {} });
}
