import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MOBBIN_OAUTH_MESSAGE_TYPE,
  connect,
  disconnect,
  generateCodeChallenge,
  generateCodeVerifier,
  getRedirectUri,
  getStoredTokens,
  getValidAccessToken,
  hasStoredCredentials,
  peekAccessToken,
  subscribeToMobbinAuthChanges,
  withMobbinAuthHeader,
} from "@/lib/mobbinAuth";

const STORAGE_KEYS = [
  "pen.mobbin.clientId",
  "pen.mobbin.accessToken",
  "pen.mobbin.refreshToken",
  "pen.mobbin.expiresAt",
];

function clearStorage() {
  for (const key of STORAGE_KEYS) localStorage.removeItem(key);
}

function storeConnectedTokens(overrides: Partial<{
  clientId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}> = {}) {
  const tokens = {
    clientId: "client-1",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 60 * 60 * 1000,
    ...overrides,
  };
  localStorage.setItem("pen.mobbin.clientId", tokens.clientId);
  localStorage.setItem("pen.mobbin.accessToken", tokens.accessToken);
  if (tokens.refreshToken !== null) {
    localStorage.setItem("pen.mobbin.refreshToken", tokens.refreshToken);
  }
  localStorage.setItem("pen.mobbin.expiresAt", String(tokens.expiresAt));
  return tokens;
}

beforeEach(() => {
  clearStorage();
  vi.unstubAllGlobals();
  // Each "connect" test spies on window.addEventListener/open again; without
  // restoring between tests, the second test's spy wraps the first test's
  // still-active spy instead of the real implementation, recursing forever.
  vi.restoreAllMocks();
});

describe("PKCE", () => {
  it("generates a verifier from the unreserved RFC 7636 alphabet within length bounds", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("computes code_challenge as base64url(SHA-256(verifier))", async () => {
    const verifier = "a".repeat(43);
    const challenge = await generateCodeChallenge(verifier);

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const expected = btoa(
      Array.from(new Uint8Array(digest), (b) => String.fromCharCode(b)).join(""),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(challenge).toBe(expected);
    // Never plain base64 (must be URL-safe, no padding).
    expect(challenge).not.toMatch(/[+/=]/);
  });
});

describe("disconnect", () => {
  it("clears all four credential keys at once", () => {
    storeConnectedTokens();
    expect(hasStoredCredentials()).toBe(true);

    disconnect();

    for (const key of STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(hasStoredCredentials()).toBe(false);
    expect(getStoredTokens()).toBeNull();
  });
});

describe("getValidAccessToken", () => {
  it("returns null when nothing is connected", async () => {
    expect(await getValidAccessToken()).toBeNull();
  });

  it("returns the stored token when it isn't near expiry", async () => {
    const tokens = storeConnectedTokens();
    expect(await getValidAccessToken()).toBe(tokens.accessToken);
  });

  it("refreshes an expired token when a refresh token is available", async () => {
    storeConnectedTokens({ expiresAt: Date.now() - 1000, refreshToken: "refresh-1" });

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          accessToken: "access-2",
          refreshToken: "refresh-2",
          expiresIn: 3600,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = await getValidAccessToken();
    expect(token).toBe("access-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobbin/refresh");

    const stored = getStoredTokens();
    expect(stored?.accessToken).toBe("access-2");
    expect(stored?.refreshToken).toBe("refresh-2");
  });

  // The coordinator's correction: Mobbin's authorization server (Supabase
  // Auth) does not reliably issue a refresh token even when requested, so an
  // expired token with none stored must not be silently handed back — it
  // would just 401 against Mobbin mid chat-turn. Credentials are cleared via
  // disconnect() (the one function that clears them) and null is returned so
  // the caller reads "not connected".
  it("clears credentials and returns null when expired with no refresh token", async () => {
    storeConnectedTokens({ expiresAt: Date.now() - 1000, refreshToken: null });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const token = await getValidAccessToken();

    expect(token).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hasStoredCredentials()).toBe(false);
  });

  it("clears credentials and returns null when the refresh call itself fails", async () => {
    storeConnectedTokens({ expiresAt: Date.now() - 1000, refreshToken: "refresh-1" });
    const fetchMock = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await getValidAccessToken();

    expect(token).toBeNull();
    expect(hasStoredCredentials()).toBe(false);
  });

  // Finding #2: a transient backend/network failure must not be treated the
  // same as Mobbin definitively rejecting the refresh token. Old behavior
  // called disconnect() unconditionally on ANY refresh failure, destroying a
  // still-good refresh token because of one offline blip or a 502.
  it("keeps credentials and returns null when the refresh call fails transiently (502)", async () => {
    const tokens = storeConnectedTokens({
      expiresAt: Date.now() - 1000,
      refreshToken: "refresh-1",
    });
    const fetchMock = vi.fn(async () => new Response("", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await getValidAccessToken();

    expect(token).toBeNull();
    // Credentials must survive — a later call can simply try refreshing again.
    expect(hasStoredCredentials()).toBe(true);
    expect(getStoredTokens()?.refreshToken).toBe(tokens.refreshToken);
  });

  it("keeps credentials and returns null when the refresh call fails at the network level", async () => {
    const tokens = storeConnectedTokens({
      expiresAt: Date.now() - 1000,
      refreshToken: "refresh-1",
    });
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const token = await getValidAccessToken();

    expect(token).toBeNull();
    expect(hasStoredCredentials()).toBe(true);
    expect(getStoredTokens()?.refreshToken).toBe(tokens.refreshToken);
  });

  // Finding #1: expiresIn is `number | null` on the backend — a token
  // response with no expiresIn used to compute `expiresAt = Date.now() +
  // null * 1000 = Date.now()`, so the "just refreshed" token read back as
  // already expired.
  it("does not treat a freshly refreshed token as already expired when expiresIn is null", async () => {
    storeConnectedTokens({ expiresAt: Date.now() - 1000, refreshToken: "refresh-1" });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: null }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = await getValidAccessToken();
    expect(token).toBe("access-2");

    // A second call, immediately after, must not trigger another refresh —
    // that would only happen if the stored expiresAt were already in the
    // past.
    const secondToken = await getValidAccessToken();
    expect(secondToken).toBe("access-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Finding #6: a non-rotating refresh server may simply not repeat the
  // refresh token in its response. Losing it anyway forced a full
  // reauthorization on the very next expiry for no reason.
  it("keeps the previous refresh token when the refresh response omits one", async () => {
    storeConnectedTokens({ expiresAt: Date.now() - 1000, refreshToken: "refresh-1" });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ accessToken: "access-2", refreshToken: null, expiresIn: 3600 }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = await getValidAccessToken();
    expect(token).toBe("access-2");
    expect(getStoredTokens()?.refreshToken).toBe("refresh-1");
  });

  // Finding #3: two callers racing an expired token must not each fire their
  // own refresh call against the same (possibly rotating) refresh token.
  it("single-flights concurrent refresh attempts into one backend call", async () => {
    storeConnectedTokens({ expiresAt: Date.now() - 1000, refreshToken: "refresh-1" });
    let resolveFetch: (value: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = getValidAccessToken();
    const second = getValidAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch!(
      new Response(
        JSON.stringify({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 3600 }),
        { status: 200 },
      ),
    );

    const [firstToken, secondToken] = await Promise.all([first, second]);
    expect(firstToken).toBe("access-2");
    expect(secondToken).toBe("access-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Finding #3 (the anti-clobber half): if a permanent rejection comes back
  // for a refresh token that has, in the meantime, already been replaced by
  // a fresher one (e.g. a winning single-flight call, or another tab), the
  // stale failure must not wipe out the fresh credentials.
  it("does not disconnect on a permanent refresh failure if credentials already changed", async () => {
    storeConnectedTokens({
      expiresAt: Date.now() - 1000,
      refreshToken: "refresh-1",
    });
    const fetchMock = vi.fn(async () => {
      // Simulate another actor (another tab, in practice) having already
      // stored fresh credentials while this refresh call was in flight and
      // about to fail.
      localStorage.setItem("pen.mobbin.accessToken", "access-from-winner");
      localStorage.setItem("pen.mobbin.refreshToken", "refresh-from-winner");
      localStorage.setItem(
        "pen.mobbin.expiresAt",
        String(Date.now() + 60 * 60 * 1000),
      );
      return new Response("", { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const token = await getValidAccessToken();

    expect(token).toBeNull();
    // The winner's fresh credentials must survive.
    expect(getStoredTokens()?.accessToken).toBe("access-from-winner");
    expect(getStoredTokens()?.refreshToken).toBe("refresh-from-winner");
  });
});

describe("subscribeToMobbinAuthChanges", () => {
  it("notifies subscribers when disconnect() runs", () => {
    storeConnectedTokens();
    const listener = vi.fn();
    const unsubscribe = subscribeToMobbinAuthChanges(listener);

    disconnect();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    storeConnectedTokens();
    const listener = vi.fn();
    const unsubscribe = subscribeToMobbinAuthChanges(listener);
    unsubscribe();

    disconnect();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("getRedirectUri", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds the callback URL under the default root base", () => {
    expect(getRedirectUri()).toBe(`${window.location.origin}/oauth/mobbin/callback`);
  });

  // Finding #10: the router mounts on BASE_URL as its `basename`
  // (AppRouter.tsx), so a non-root VITE_BASE deployment serves the callback
  // route at `${BASE_URL}/oauth/mobbin/callback`, not at the bare path.
  it("includes a non-root BASE_URL without doubling the slash at the seam", () => {
    vi.stubEnv("BASE_URL", "/pen-editor/");
    expect(getRedirectUri()).toBe(
      `${window.location.origin}/pen-editor/oauth/mobbin/callback`,
    );
  });
});

describe("peekAccessToken", () => {
  it("synchronously returns whatever is stored, without validating expiry", () => {
    storeConnectedTokens({ expiresAt: Date.now() - 1000 });
    expect(peekAccessToken()).toBe("access-1");
  });

  it("returns null when nothing is stored", () => {
    expect(peekAccessToken()).toBeNull();
  });
});

describe("withMobbinAuthHeader", () => {
  it("attaches a currently-valid token as X-Mobbin-Token", async () => {
    storeConnectedTokens({ accessToken: "access-fresh" });
    const inner = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"));
    const wrapped = withMobbinAuthHeader(inner as unknown as typeof fetch);

    await wrapped("https://example.test/api/chat", { method: "POST" });

    const init = inner.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Mobbin-Token")).toBe("access-fresh");
  });

  it("sends no X-Mobbin-Token header when not connected", async () => {
    const inner = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"));
    const wrapped = withMobbinAuthHeader(inner as unknown as typeof fetch);

    await wrapped("https://example.test/api/chat", { method: "POST" });

    const init = inner.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.has("X-Mobbin-Token")).toBe(false);
  });
});

describe("connect (OAuth popup handshake)", () => {
  function stubBackendRegisterAndToken() {
    return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/mobbin/register")) {
        return new Response(
          JSON.stringify({
            clientId: "client-1",
            authorizeEndpoint: "https://mobbin.test/authorize",
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/mobbin/token")) {
        return new Response(
          JSON.stringify({
            accessToken: "access-1",
            refreshToken: "refresh-1",
            expiresIn: 3600,
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
  }

  function stubPopup() {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const originalAddEventListener = window.addEventListener.bind(window);
    const originalRemoveEventListener = window.removeEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, opts) => {
      if (type === "message") listeners.push(listener as (event: MessageEvent) => void);
      return originalAddEventListener(type, listener as EventListener, opts);
    });
    vi.spyOn(window, "removeEventListener").mockImplementation((type, listener, opts) => {
      return originalRemoveEventListener(type, listener as EventListener, opts);
    });

    // `location.href` is a plain mutable field here rather than a real
    // Location object — `connect()` only ever writes to it, matching what
    // findings #5/#7/#8 below actually exercise.
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { href: "" },
    } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popup);

    return {
      popup,
      dispatch(data: unknown, origin: string) {
        for (const listener of listeners) {
          listener({ origin, data } as MessageEvent);
        }
      },
    };
  }

  function stateFromPopupUrl(popup: Window): string | null {
    const href = (popup as unknown as { location: { href: string } }).location.href;
    return new URL(href).searchParams.get("state");
  }

  // `vi.waitFor` polls on a real `setTimeout`, which hangs forever once fake
  // timers are active (nothing ever advances it). This drains the
  // microtask/fake-timer queue in small steps instead, so async work that
  // doesn't itself depend on a timer (our mocked fetch, crypto.subtle.digest)
  // still gets the chance to resolve between checks.
  async function flushUntilFakeTimers(
    check: () => boolean,
    maxIters = 50,
  ): Promise<void> {
    for (let i = 0; i < maxIters; i++) {
      if (check()) return;
      await vi.advanceTimersByTimeAsync(0);
    }
    throw new Error("condition never became true");
  }

  it("stores tokens after a valid, same-origin, state-matched callback", async () => {
    const fetchMock = stubBackendRegisterAndToken();
    vi.stubGlobal("fetch", fetchMock);
    const { popup, dispatch } = stubPopup();

    const connectPromise = connect();

    // Let register() resolve and the state get generated before dispatching.
    await vi.waitFor(() => {
      expect((popup as unknown as { location: { href: string } }).location.href).not.toBe("");
    });
    const state = stateFromPopupUrl(popup);

    dispatch(
      { type: MOBBIN_OAUTH_MESSAGE_TYPE, code: "auth-code", state },
      window.location.origin,
    );

    await connectPromise;

    expect(getStoredTokens()?.accessToken).toBe("access-1");
  });

  it("ignores a postMessage from a different origin", async () => {
    const fetchMock = stubBackendRegisterAndToken();
    vi.stubGlobal("fetch", fetchMock);
    const { popup, dispatch } = stubPopup();

    const connectPromise = connect();
    await vi.waitFor(() => {
      expect((popup as unknown as { location: { href: string } }).location.href).not.toBe("");
    });
    const state = stateFromPopupUrl(popup);

    // Forged/cross-origin message: must be ignored, not resolve the connect.
    dispatch(
      { type: MOBBIN_OAUTH_MESSAGE_TYPE, code: "attacker-code", state },
      "https://evil.test",
    );
    // The legitimate one follows and should be the one that actually resolves.
    dispatch(
      { type: MOBBIN_OAUTH_MESSAGE_TYPE, code: "real-code", state },
      window.location.origin,
    );

    await connectPromise;
    expect(getStoredTokens()).not.toBeNull();
    // The token exchange call must have used the legitimate code, not the
    // forged one.
    const tokenCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/api/mobbin/token"),
    );
    const body = JSON.parse(String(tokenCall?.[1]?.body));
    expect(body.code).toBe("real-code");
  });

  it("rejects when the callback state does not match", async () => {
    const fetchMock = stubBackendRegisterAndToken();
    vi.stubGlobal("fetch", fetchMock);
    const { popup, dispatch } = stubPopup();

    const connectPromise = connect();
    await vi.waitFor(() => {
      expect((popup as unknown as { location: { href: string } }).location.href).not.toBe("");
    });

    dispatch(
      { type: MOBBIN_OAUTH_MESSAGE_TYPE, code: "auth-code", state: "wrong-state" },
      window.location.origin,
    );

    await expect(connectPromise).rejects.toThrow(/state mismatch/i);
    expect(hasStoredCredentials()).toBe(false);
  });

  // Finding #5: window.open() must run synchronously, before any `await` —
  // Safari (and Chromium, less reliably) drops the "opened from a user
  // gesture" exemption the moment an await intervenes, silently turning the
  // popup into one the browser blocks. Opening blank and redirecting once
  // the authorize URL is known keeps that gesture intact.
  it("opens the popup synchronously, before the first await", async () => {
    const fetchMock = stubBackendRegisterAndToken();
    vi.stubGlobal("fetch", fetchMock);
    const { popup, dispatch } = stubPopup();

    // Deliberately checked before awaiting anything: `window.open` must
    // already have been called by the time `connect()` first suspends
    // (i.e. still within this synchronous stretch of the calling code, the
    // property a real click handler needs to preserve the "user gesture"
    // exemption). Calling it with a URL after any `await` — as the old code
    // did — would still pass a "was it ever called" check; this instead
    // asserts on the argument (about:blank, not the authorize URL, which
    // isn't known yet at this point) and the fact that it already happened.
    const connectPromise = connect();

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      "about:blank",
      "mobbin-oauth",
      "width=480,height=720",
    );

    // Let the flow finish so no dangling listeners/timers leak into later
    // tests in this file.
    await vi.waitFor(() => {
      const href = (popup as unknown as { location: { href: string } }).location.href;
      expect(href).not.toBe("");
    });
    const state = stateFromPopupUrl(popup);
    dispatch({ type: MOBBIN_OAUTH_MESSAGE_TYPE, code: "auth-code", state }, window.location.origin);
    await connectPromise;
  });

  it("shows a clear error when the popup is blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    await expect(connect()).rejects.toThrow(/popup blocker/i);
  });

  // Defect: pen-editor-desktop's WebContentsView denies ALL popups from the
  // editor, including same-origin ones (navigation.ts there:
  // `setWindowOpenHandler` always returns `{ action: "deny" }`), so
  // `window.open()` would always return null in that shell. Before this
  // fix, that surfaced as the generic "check your browser's popup blocker"
  // message — which is actively misleading there: there is no popup
  // blocker for the user to disable, and it will never succeed regardless.
  it("gives an honest 'not available in the desktop app' error instead of attempting a popup", async () => {
    const openSpy = vi.spyOn(window, "open");
    (window as unknown as { penDesktop?: unknown }).penDesktop = {
      onMenuCommand: () => () => {},
    };

    try {
      await expect(connect()).rejects.toThrow(/desktop app/i);
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      delete (window as unknown as { penDesktop?: unknown }).penDesktop;
    }
  });

  // Defect: `storeTokens()` goes through `safeSet`, which swallows a thrown
  // `localStorage.setItem` (private browsing, a full quota). Before this
  // fix, `connect()` resolved successfully even when nothing was actually
  // persisted, so the store flipped to "connected" while every subsequent
  // request silently went out with no token.
  it("throws when the tokens fail to persist to localStorage, instead of resolving successfully", async () => {
    const fetchMock = stubBackendRegisterAndToken();
    vi.stubGlobal("fetch", fetchMock);
    const { popup, dispatch } = stubPopup();
    // Replace `window.localStorage` itself (its own accessor property on
    // `window`, per happy-dom) rather than patching an instance/prototype
    // method — plain assignment on the instance is silently ignored here,
    // and `vi.spyOn(Storage.prototype, "setItem")` proved unreliable in this
    // suite: it sometimes didn't take effect and didn't always restore via
    // `vi.restoreAllMocks()`, leaking a throwing `setItem` into later tests.
    // Swapping the whole `localStorage` property is what's actually
    // verified to affect every subsequent access, including from inside
    // mobbinAuth.ts, and to restore cleanly afterward.
    const originalLocalStorage = window.localStorage;
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    const throwingStorage: Storage = {
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
      getItem: (key: string) => originalLocalStorage.getItem(key),
      removeItem: (key: string) => originalLocalStorage.removeItem(key),
      clear: () => originalLocalStorage.clear(),
      key: (index: number) => originalLocalStorage.key(index),
      get length() {
        return originalLocalStorage.length;
      },
    };
    Object.defineProperty(window, "localStorage", { value: throwingStorage, configurable: true });

    try {
      const connectPromise = connect();
      await vi.waitFor(() => {
        expect((popup as unknown as { location: { href: string } }).location.href).not.toBe("");
      });
      const state = stateFromPopupUrl(popup);
      dispatch({ type: MOBBIN_OAUTH_MESSAGE_TYPE, code: "auth-code", state }, window.location.origin);

      await expect(connectPromise).rejects.toThrow(/couldn't be saved/i);
    } finally {
      Object.defineProperty(window, "localStorage", originalDescriptor);
    }
    expect(hasStoredCredentials()).toBe(false);
  });

  // Finding #7: the popup-closed poll can observe `popup.closed === true`
  // before a same-tick, already-queued postMessage is actually delivered —
  // both share the main thread. A successful sign-in must not lose its
  // one-time code to that race.
  it("lets an already-queued success message win a same-tick race with popup.closed", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = stubBackendRegisterAndToken();
      vi.stubGlobal("fetch", fetchMock);
      const { popup, dispatch } = stubPopup();

      const connectPromise = connect();
      await flushUntilFakeTimers(
        () => (popup as unknown as { location: { href: string } }).location.href !== "",
      );
      const state = stateFromPopupUrl(popup);

      // The user closes the popup in the same tick the callback page's
      // message was already queued.
      (popup as unknown as { closed: boolean }).closed = true;
      dispatch({ type: MOBBIN_OAUTH_MESSAGE_TYPE, code: "auth-code", state }, window.location.origin);

      // Advance past the 500ms poll tick that observes popup.closed, but
      // stay inside the grace window that should let the message win.
      await vi.advanceTimersByTimeAsync(500);

      await connectPromise;
      expect(getStoredTokens()?.accessToken).toBe("access-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects once the grace period elapses with no message after the popup closes", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = stubBackendRegisterAndToken();
      vi.stubGlobal("fetch", fetchMock);
      const { popup } = stubPopup();

      const connectPromise = connect();
      // Attach a handler immediately: the promise rejects DURING the
      // advanceTimersByTimeAsync call below, before this test gets a chance
      // to `await expect(...).rejects...` — without a handler already
      // attached, that's an unhandled-rejection tick even though the test
      // does eventually observe it.
      const rejection = connectPromise.catch((err: unknown) => err);
      await flushUntilFakeTimers(
        () => (popup as unknown as { location: { href: string } }).location.href !== "",
      );

      (popup as unknown as { closed: boolean }).closed = true;
      // Past the 500ms poll tick AND the grace period, with no message ever
      // dispatched.
      await vi.advanceTimersByTimeAsync(1000);

      expect(await rejection).toEqual(
        expect.objectContaining({ message: expect.stringMatching(/closed before completing/i) }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // Finding #8: an abandoned popup (never closed, never completes) must not
  // hang the store in "connecting" forever.
  it("times out if the popup never reports back", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = stubBackendRegisterAndToken();
      vi.stubGlobal("fetch", fetchMock);
      const { popup } = stubPopup();

      const connectPromise = connect();
      // See the grace-period test above: attach a handler before advancing
      // timers, since the rejection happens during that call.
      const rejection = connectPromise.catch((err: unknown) => err);
      await flushUntilFakeTimers(
        () => (popup as unknown as { location: { href: string } }).location.href !== "",
      );

      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);

      expect(await rejection).toEqual(
        expect.objectContaining({ message: expect.stringMatching(/timed out/i) }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
