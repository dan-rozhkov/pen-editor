// The single point that reads, writes and clears Mobbin OAuth credentials —
// modeled on `src/lib/userId.ts`'s "one function owns this localStorage key"
// shape, extended to four related keys that must always change together.
// This repo has been burned before by credentials cleared from several
// places independently (see MEMORY: "split-commit-in-shared-tree" and the
// backend-config lesson) — `disconnect()` is the only place any of these
// four keys is ever removed.
//
// Mobbin requires OAuth 2.1 with Dynamic Client Registration and PKCE
// (S256); there is no API-key alternative and no per-user credential lives
// on the backend. The backend performs the OAuth calls (discovery, DCR,
// token exchange, refresh) on the browser's behalf — seepen-editor-backend's
// `src/routes/mobbinAuth.ts` and
// `docs/superpowers/specs/2026-09-18-mobbin-mcp-design.md` — and this module
// stores only what the *browser* ends up holding: a DCR client id, an access
// token, an optional refresh token, and the access token's expiry.
//
// The refresh token is NOT guaranteed. Mobbin's docs say to request only the
// `openid` scope, but its authorization server is Supabase Auth, which
// generally will not hand out a refresh token unless `offline_access` is
// also requested — so this module (and the authorize URL below) asks for
// both, and still treats `refreshToken` as optional everywhere. A token
// response with no refresh token is a valid, storable state; a token that
// later expires with no refresh token is a dead end, not a retry — see
// `getValidAccessToken()`.
import { resolveApiUrl } from "@/lib/apiBase";

const CLIENT_ID_KEY = "pen.mobbin.clientId";
const ACCESS_TOKEN_KEY = "pen.mobbin.accessToken";
const REFRESH_TOKEN_KEY = "pen.mobbin.refreshToken";
const EXPIRES_AT_KEY = "pen.mobbin.expiresAt";

const ALL_STORAGE_KEYS = [
  CLIENT_ID_KEY,
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  EXPIRES_AT_KEY,
];

// Must match the route added in AppRouter.tsx / MobbinCallback.tsx.
export const MOBBIN_OAUTH_CALLBACK_PATH = "/oauth/mobbin/callback";

// The `type` field on the postMessage the callback page sends its opener.
// Namespaced so this listener never mistakes an unrelated postMessage
// (browser extensions, other app code, analytics beacons) for an OAuth
// callback just because it happens to carry a `code`/`state` pair.
export const MOBBIN_OAUTH_MESSAGE_TYPE = "pen-editor:mobbin-oauth-callback";

// Refresh a bit before actual expiry so a token handed to a chat request
// doesn't die mid-flight racing Mobbin's own clock.
const EXPIRY_SAFETY_MARGIN_MS = 30_000;

// How long `awaitOAuthCallback` waits for the popup to report back at all
// before giving up — a popup the user abandons (never closes, never
// completes) would otherwise leave the store stuck in "connecting" forever.
const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60_000;

// When the "is the popup closed" poll (below) fires, give a same-tick,
// already-queued postMessage a short grace period to actually arrive before
// concluding the user closed the popup without completing. Both run on the
// main thread, so a heavy synchronous stretch (e.g. this poll's own callback,
// or unrelated app work) can let `popup.closed` flip true before a message
// queued moments earlier is delivered — without this, a successful sign-in
// can be reported as "closed before completing" and its one-time code lost.
const POPUP_CLOSE_GRACE_MS = 300;

// Used only when a token/refresh response omits `expires_in` — Mobbin's
// Supabase-Auth authorization server doesn't guarantee it, and `expiresIn`
// is genuinely `number | null` on the backend's `TokenResult`. Treating a
// missing value as "already expired" (the old `null * 1000` bug) discarded a
// freshly issued token before it was ever used. There's no cheaper correct
// signal available here — a real 401 only surfaces later, at MCP tool-call
// time on the backend, never as a fetch-level status this module can see —
// so we fall back to Supabase Auth's own default JWT access-token lifetime
// (3600s) and let the normal expiry/refresh cycle correct itself from there.
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

// One listener set, notified only on `disconnect()` — the single case where
// this module changes connection state somewhere the store isn't already
// updating itself synchronously (`getValidAccessToken()`/`withMobbinAuthHeader`
// can disconnect deep inside a fetch wrapper, with nothing else watching).
// `mobbinAuthStore.ts` is the sole subscriber, keeping "what does the UI
// show" backed by exactly one source of truth.
type MobbinAuthChangeListener = () => void;
const changeListeners = new Set<MobbinAuthChangeListener>();

export function subscribeToMobbinAuthChanges(
  listener: MobbinAuthChangeListener,
): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function notifyChangeListeners(): void {
  for (const listener of changeListeners) listener();
}

export interface MobbinTokens {
  clientId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export interface MobbinOAuthCallbackMessage {
  type: typeof MOBBIN_OAUTH_MESSAGE_TYPE;
  code?: string;
  state?: string;
  error?: string;
}

export function isMobbinOAuthCallbackMessage(
  data: unknown,
): data is MobbinOAuthCallbackMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === MOBBIN_OAUTH_MESSAGE_TYPE
  );
}

// Private-mode Safari and locked-down embeddings throw on localStorage
// access. Every read/write/remove below goes through one of these three so a
// thrown exception degrades to "not connected" instead of crashing the
// caller (matches userId.ts's rationale).
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Connecting to Mobbin just won't persist across reloads here.
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clean up if the store never accepted a write.
  }
}

/** The one place Mobbin credentials are cleared — never remove a subset of
 *  these keys anywhere else. */
export function disconnect(): void {
  for (const key of ALL_STORAGE_KEYS) safeRemove(key);
  notifyChangeListeners();
}

export function getStoredTokens(): MobbinTokens | null {
  const clientId = safeGet(CLIENT_ID_KEY);
  const accessToken = safeGet(ACCESS_TOKEN_KEY);
  const expiresAtRaw = safeGet(EXPIRES_AT_KEY);
  if (!clientId || !accessToken || !expiresAtRaw) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) return null;

  return {
    clientId,
    accessToken,
    refreshToken: safeGet(REFRESH_TOKEN_KEY),
    expiresAt,
  };
}

/** Cheap, synchronous "is there something stored" check — does not validate
 *  expiry or attempt a refresh. Used for optimistic UI state; correctness
 *  (including the free-refresh-token hazard) lives in `getValidAccessToken`. */
export function hasStoredCredentials(): boolean {
  return getStoredTokens() !== null;
}

/** Synchronous, best-effort read of whatever access token is currently
 *  stored, without checking expiry or refreshing. No production caller needs
 *  this today — `withMobbinAuthHeader` is the sole place a request header is
 *  ever set, and it uses the async, expiry-aware `getValidAccessToken()`
 *  instead (see its doc comment: a synchronous peek used to also be read in
 *  `prepareSendMessagesRequest`, but that header was redundant — always
 *  overwritten by `withMobbinAuthHeader` before the network call went out —
 *  and, worse, replaced rather than merged into the transport's base
 *  headers). Kept as a cheap, non-committal "is there a token at all" read
 *  for any future synchronous-only call site. */
export function peekAccessToken(): string | null {
  return getStoredTokens()?.accessToken ?? null;
}

function storeTokens(tokens: MobbinTokens): void {
  safeSet(CLIENT_ID_KEY, tokens.clientId);
  safeSet(ACCESS_TOKEN_KEY, tokens.accessToken);
  safeSet(EXPIRES_AT_KEY, String(tokens.expiresAt));
  if (tokens.refreshToken) {
    safeSet(REFRESH_TOKEN_KEY, tokens.refreshToken);
  } else {
    safeRemove(REFRESH_TOKEN_KEY);
  }
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636)
// ---------------------------------------------------------------------------

const PKCE_UNRESERVED_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** 43-128 chars from the unreserved alphabet, per RFC 7636 §4.1. Exported for
 *  tests; callers should otherwise treat this as an implementation detail of
 *  `connect()`. */
export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(96));
  let verifier = "";
  for (const byte of bytes) {
    verifier += PKCE_UNRESERVED_CHARS[byte % PKCE_UNRESERVED_CHARS.length];
  }
  return verifier;
}

function base64UrlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `code_challenge` = BASE64URL(SHA-256(verifier)), per RFC 7636 §4.2. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

// Exported for tests. NOTE (see the "questionable" section of the
// accompanying review report): the router mounts on `BASE_URL` as its
// `basename` (AppRouter.tsx), so the callback route only actually lives at
// `${BASE_URL}${MOBBIN_OAUTH_CALLBACK_PATH}` once `VITE_BASE` is anything
// other than "/". This function follows the router and builds that path —
// but the backend's `isAllowedRedirectUri` (pen-editor-backend/src/routes/
// mobbinAuth.ts) currently requires the redirect URI's path to be EXACTLY
// `/oauth/mobbin/callback`, so a non-default `VITE_BASE` deployment would
// still fail at `/api/mobbin/register` today. That mismatch belongs to the
// backend to resolve (e.g. matching by suffix instead of exact equality) and
// is deliberately not "fixed" here by ignoring BASE_URL, which would just
// swap a 400 from the backend for a route that never loads in the browser.
export function getRedirectUri(): string {
  const base = import.meta.env.BASE_URL;
  // Avoid a doubled slash at the seam: BASE_URL is "/" by default (and
  // otherwise conventionally has a trailing slash, e.g. "/pen-editor/"),
  // while MOBBIN_OAUTH_CALLBACK_PATH already starts with one.
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${window.location.origin}${normalizedBase}${MOBBIN_OAUTH_CALLBACK_PATH}`;
}

// ---------------------------------------------------------------------------
// Popup + postMessage handshake
// ---------------------------------------------------------------------------

/** Waits for the popup's callback page to postMessage the auth code back.
 *  Two things here are load-bearing for security, not just correctness:
 *  the `event.origin` check (a message from any other origin — including
 *  Mobbin's own domain, which the popup transits through before redirecting
 *  back to us — is ignored outright) and the `state` comparison (rejects a
 *  code that doesn't match the request that opened this popup, e.g. a stale
 *  message from a previous attempt or a forged one). */
function awaitOAuthCallback(
  popup: Window,
  expectedState: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let closeGraceTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(pollClosed);
      clearTimeout(overallTimeout);
      if (closeGraceTimer !== undefined) clearTimeout(closeGraceTimer);
    };

    const settle = (run: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      run();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isMobbinOAuthCallbackMessage(event.data)) return;

      const { code, state, error } = event.data;
      if (error) {
        settle(() => reject(new Error(error)));
        return;
      }
      if (state !== expectedState) {
        settle(() =>
          reject(new Error("Mobbin sign-in state mismatch — please try again.")),
        );
        return;
      }
      if (!code) {
        settle(() => reject(new Error("Mobbin sign-in did not return a code.")));
        return;
      }
      settle(() => resolve(code));
    };

    window.addEventListener("message", onMessage);

    // The user closing the popup manually is the only way this promise can
    // otherwise hang forever — there is no "onclose" event on a cross-origin
    // popup, so this has to poll.
    const pollClosed = setInterval(() => {
      if (popup.closed && closeGraceTimer === undefined) {
        // Don't reject immediately: a legitimate success message may already
        // be queued on the main thread's message loop (see
        // POPUP_CLOSE_GRACE_MS above). Let `onMessage` win the race if it
        // fires within the grace window; only reject once it doesn't.
        closeGraceTimer = setTimeout(() => {
          settle(() =>
            reject(new Error("Mobbin sign-in was closed before completing.")),
          );
        }, POPUP_CLOSE_GRACE_MS);
      }
    }, 500);

    const overallTimeout = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            "Mobbin sign-in timed out — please try connecting again.",
          ),
        ),
      );
    }, OAUTH_CALLBACK_TIMEOUT_MS);
  });
}

// ---------------------------------------------------------------------------
// Backend calls
// ---------------------------------------------------------------------------

interface RegisterResponse {
  clientId: string;
  authorizeEndpoint: string;
}

interface TokenResponse {
  accessToken: string;
  // The backend may legitimately return null — Mobbin's Supabase-Auth
  // authorization server does not reliably issue a refresh token even when
  // `offline_access` is requested.
  refreshToken: string | null;
  // Also not guaranteed — matches the backend's `TokenResult.expiresIn:
  // number | null`. See DEFAULT_EXPIRES_IN_SECONDS above for what happens
  // when this is null.
  expiresIn: number | null;
}

/** Thrown by `postJson` for a non-OK HTTP response from OUR OWN backend
 *  (never Mobbin's servers directly — the backend proxies those). `refresh()`
 *  uses `status` to tell a genuine authorization rejection apart from an
 *  infrastructure hiccup; see its doc comment. A network-level failure
 *  (offline, DNS, timeout) throws whatever `fetch` itself throws instead —
 *  there is no `status` to attach — which `refresh()` also treats as
 *  temporary. */
class MobbinHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MobbinHttpError";
    this.status = status;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new MobbinHttpError(
      response.status,
      `Mobbin ${path} request failed (${response.status}).`,
    );
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Public flow
// ---------------------------------------------------------------------------

/** Runs the full OAuth dance: register a DCR client with the backend, open a
 *  popup on Mobbin's own authorize endpoint, wait for the callback page to
 *  hand back a code, exchange it (again via the backend) and persist the
 *  resulting tokens. Throws with a user-presentable message on any failure
 *  (popup blocked, user closed the popup, state mismatch, non-OK backend
 *  response). */
export async function connect(): Promise<void> {
  // The desktop shell (pen-editor-desktop) denies ALL popups from its
  // editor WebContentsView — including same-origin ones — via
  // `setWindowOpenHandler` (see navigation.ts there: "Same-origin popups are
  // also denied: the editor is single-window; tabs are created only via the
  // shell UI/menu"). `window.open()` below would therefore always return
  // `null`, and without this check the user would see the generic "check
  // your browser's popup blocker" message — which is not just unhelpful but
  // actively wrong: there is no popup blocker to disable, and it would never
  // work no matter what they do. `window.penDesktop` (declared globally by
  // desktopBridge.ts) is only present in that shell, never on the web.
  if (window.penDesktop) {
    throw new Error(
      "Connecting Mobbin isn't available in the desktop app yet — open Pen Editor in a browser to connect it.",
    );
  }

  // window.open() MUST run synchronously inside the click handler that
  // triggered `connect()` — Safari (and, less reliably, Chromium) revokes
  // "opened from a user gesture" the moment an `await` intervenes, and every
  // step below this point is async. Opening a blank popup now, then
  // redirecting it once the authorize URL is known, keeps the gesture intact
  // instead of calling `window.open` with a URL after the first `await`
  // (which is silently swallowed as a popup-blocker hit on Safari).
  const popup = window.open(
    "about:blank",
    "mobbin-oauth",
    "width=480,height=720",
  );
  if (!popup) {
    throw new Error(
      "Couldn't open the Mobbin sign-in window — check your browser's popup blocker.",
    );
  }

  let redirectUri: string;
  let clientId: string;
  let codeVerifier: string;
  let state: string;
  try {
    redirectUri = getRedirectUri();
    const registered = await postJson<RegisterResponse>(
      "/api/mobbin/register",
      { redirectUri },
    );
    clientId = registered.clientId;

    codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    state = generateState();

    const authorizeUrl = new URL(registered.authorizeEndpoint);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    // See the module comment: requesting `offline_access` alongside `openid`
    // is what actually gets a refresh token out of Supabase Auth, matching
    // what the backend requests during DCR. Not guaranteed either way.
    authorizeUrl.searchParams.set("scope", "openid offline_access");
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);

    popup.location.href = authorizeUrl.toString();
  } catch (err) {
    if (!popup.closed) popup.close();
    throw err;
  }

  let code: string;
  try {
    code = await awaitOAuthCallback(popup, state);
  } finally {
    if (!popup.closed) popup.close();
  }

  const tokenResponse = await postJson<TokenResponse>("/api/mobbin/token", {
    code,
    codeVerifier,
    clientId,
    redirectUri,
  });

  storeTokens({
    clientId,
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken ?? null,
    expiresAt: Date.now() + (tokenResponse.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS) * 1000,
  });

  // `storeTokens`/`safeSet` swallow a thrown `localStorage.setItem` (private
  // browsing, a full storage quota, a locked-down embedding) so a write
  // failure never crashes the caller — but that means `connect()` must
  // verify the write actually landed before reporting success. Without this
  // read-back, the promise above resolved cleanly, the store flipped to
  // "connected", and every subsequent chat request silently went out with no
  // `X-Mobbin-Token` header — a state the user has no way to notice or fix.
  const persisted = getStoredTokens();
  if (!persisted || persisted.accessToken !== tokenResponse.accessToken) {
    throw new Error(
      "Mobbin connected, but the credentials couldn't be saved in this browser — check that storage isn't blocked (private browsing or a full storage quota can cause this) and try again.",
    );
  }
}

interface RefreshOutcome {
  accessToken: string | null;
  /** True only for a definitive authorization rejection (HTTP 401 from our
   *  own `/api/mobbin/refresh`) — see the doc comment below for why 401
   *  specifically, and why everything else is treated as temporary. */
  permanent: boolean;
}

// Single-flight: without this, two chat requests (or a request racing
// `refreshStatus()`) firing while the token is expired each start their own
// refresh call against the same, possibly-rotating refresh token. Whichever
// one the server processes second gets rejected — and would otherwise call
// disconnect() on a refresh token that had *just* been rotated by the winner
// (see `getValidAccessToken`'s own extra guard for the remaining cross-tab
// case this can't cover). One promise, shared by every concurrent caller in
// this process, removes the intra-process race entirely.
let inFlightRefresh: Promise<RefreshOutcome> | null = null;

async function performRefresh(tokens: MobbinTokens): Promise<RefreshOutcome> {
  try {
    // tokens.refreshToken is narrowed non-null by refresh()'s guard below.
    const response = await postJson<TokenResponse>("/api/mobbin/refresh", {
      refreshToken: tokens.refreshToken as string,
      clientId: tokens.clientId,
    });
    storeTokens({
      clientId: tokens.clientId,
      accessToken: response.accessToken,
      // A rotating-refresh-token server issues a new one every time and an
      // absent value here would be unusual; a non-rotating one may simply
      // never send one back. Either way, losing a still-good refresh token
      // because the response happened not to repeat it would force a full
      // re-authorization on the next expiry for no reason — keep the one we
      // already have unless the server explicitly replaced it.
      refreshToken: response.refreshToken ?? tokens.refreshToken,
      expiresAt: Date.now() + (response.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS) * 1000,
    });
    return { accessToken: response.accessToken, permanent: false };
  } catch (err) {
    // A `MobbinHttpError` with `status === 401` is the only signal we
    // currently treat as "Mobbin definitively rejected this refresh token,
    // stop retrying it" (matches `/api/mobbin/refresh`'s intended contract).
    // As of 2026-09-18 the route folds every failure — a genuine upstream
    // rejection AND its own discovery/network problems — into a flat 502, so
    // in practice nothing reaches this branch yet; that's a backend gap, not
    // something to paper over here. A network-level failure (fetch itself
    // throwing: offline, DNS, timeout/abort) has no HTTP status at all and
    // falls into the same "temporary" bucket by construction. Being
    // conservative here is deliberate: wrongly treating a transient failure
    // as permanent destroys a still-good refresh token and forces the user
    // through a full reauthorization; wrongly treating a dead one as
    // temporary just means the next request tries again and fails the same
    // way, for free.
    const permanent = err instanceof MobbinHttpError && err.status === 401;
    return { accessToken: null, permanent };
  }
}

/** Returns the refreshed access token on success, or an outcome describing
 *  why not. Never throws. */
async function refresh(tokens: MobbinTokens): Promise<RefreshOutcome> {
  if (!tokens.refreshToken) return { accessToken: null, permanent: false };
  if (!inFlightRefresh) {
    inFlightRefresh = performRefresh(tokens).finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

/** The one function every caller that needs a Mobbin token should use.
 *  Returns a currently-valid access token, refreshing it first if it's
 *  expired (or about to be) and a refresh token is available. Returns `null`
 *  when not connected, when the token is expired with no way to renew it, or
 *  when a refresh attempt failed. Credentials are cleared via `disconnect()`
 *  — the one function that clears them — only when there is truly nothing
 *  left to retry: no refresh token at all, or a refresh call that came back
 *  with a definitive rejection (see `performRefresh`). A transient refresh
 *  failure (offline, backend hiccup) deliberately leaves credentials in
 *  place so the next call can simply try again. */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = getStoredTokens();
  if (!tokens) return null;

  if (Date.now() < tokens.expiresAt - EXPIRY_SAFETY_MARGIN_MS) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) {
    disconnect();
    return null;
  }

  const outcome = await refresh(tokens);
  if (outcome.accessToken) return outcome.accessToken;

  if (outcome.permanent) {
    // Re-read from storage rather than disconnecting unconditionally: while
    // this call's refresh attempt was failing, another caller (this
    // process's single-flight winner already covers the common in-tab case,
    // but a *different* tab racing the same rotating refresh token is still
    // possible) may have already stored fresh credentials. Only clear if
    // what's stored is still the exact credentials this attempt started
    // with — otherwise disconnecting now would destroy someone else's
    // just-won, perfectly good tokens instead of the dead ones we tried.
    const current = getStoredTokens();
    if (
      current &&
      current.refreshToken === tokens.refreshToken &&
      current.accessToken === tokens.accessToken
    ) {
      disconnect();
    }
  }
  return null;
}

/** Wraps a `fetch` implementation so every request it sends carries a
 *  currently-valid `X-Mobbin-Token` header (refreshing first if needed), or
 *  no such header at all when not connected — never a stale one. This is the
 *  ONE place that header is ever set — see `prepareSendMessagesRequest` in
 *  `useDesignChat.ts`, which deliberately does not duplicate it. */
export function withMobbinAuthHeader(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const token = await getValidAccessToken();
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("X-Mobbin-Token", token);
    } else {
      headers.delete("X-Mobbin-Token");
    }
    return fetchImpl(input, { ...init, headers });
  };
}
