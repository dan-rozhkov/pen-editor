import { useSyncExternalStore } from "react";
import { vi } from "vitest";

import { AUTH_DISABLED, resetAuthConfigCache, type AuthConfig } from "@/lib/auth/authConfig";
import { useAuthStore } from "@/lib/auth/authState";

// Shared doubles for the account UI tests. The real Better Auth client keeps a
// module-level session atom, so page tests swap `@/lib/auth/authClient` and
// `@/lib/auth/session` for these (via vi.mock factories that import this file)
// and drive the session with setMockSession().

export interface MockUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

export const USER: MockUser = { id: "user-1", email: "ada@example.com", name: "Ada" };

let session: { user: MockUser | null; pending: boolean } = { user: null, pending: false };
const listeners = new Set<() => void>();

export function setMockSession(user: MockUser | null, pending = false): void {
  session = { user, pending };
  listeners.forEach((l) => l());
}

function useMockSession() {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => session,
  );
  return { data: s.user ? { user: s.user } : null, isPending: s.pending };
}

const ok = (data: unknown = {}) => ({ data, error: null });

export const authClientMock = {
  $store: { notify: vi.fn() },
  signIn: { magicLink: vi.fn(), email: vi.fn(), social: vi.fn() },
  signUp: { email: vi.fn() },
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  signOut: vi.fn(),
  listAccounts: vi.fn(),
  oauth2: {
    consent: vi.fn(),
    publicClient: vi.fn(),
    getConsents: vi.fn(),
    deleteConsent: vi.fn(),
    continue: vi.fn(),
  },
  apiKey: { create: vi.fn(), list: vi.fn(), delete: vi.fn() },
};

/** Fresh call history + happy-path defaults; call from beforeEach. */
export function resetAuthMocks(): void {
  const { signIn, signUp, oauth2, apiKey } = authClientMock;
  for (const fn of [
    signIn.magicLink,
    signIn.email,
    signIn.social,
    signUp.email,
    authClientMock.requestPasswordReset,
    authClientMock.resetPassword,
    authClientMock.signOut,
    oauth2.deleteConsent,
    apiKey.delete,
  ]) {
    fn.mockReset().mockResolvedValue(ok());
  }
  authClientMock.$store.notify.mockReset();
  authClientMock.listAccounts.mockReset().mockResolvedValue(ok([]));
  oauth2.consent.mockReset().mockResolvedValue(ok({ url: "https://agent.example/cb?code=1" }));
  oauth2.publicClient.mockReset().mockResolvedValue(ok({ client_name: "Codex" }));
  oauth2.continue.mockReset().mockResolvedValue(ok({ url: "https://agent.example/cb?code=2" }));
  oauth2.getConsents.mockReset().mockResolvedValue(ok([]));
  apiKey.create.mockReset().mockResolvedValue(ok({ key: "sf_secret" }));
  apiKey.list.mockReset().mockResolvedValue(ok({ apiKeys: [] }));
  setMockSession(null);
  resetAuthConfigCache();
  useAuthStore.setState({ status: "unknown", userId: null });
}

export const authClientModule = () => ({
  authClient: authClientMock,
  AUTH_BASE_PATH: "/api/auth",
  resolveAuthBaseUrl: () => "http://localhost",
});

export const sessionModule = () => ({
  useSession: useMockSession,
  signOut: () => authClientMock.signOut(),
});

/** Stub GET /api/auth-config (and fail every other URL loudly unless `extra` answers it). */
// An enabled config gets this page's origin as `appOrigin` unless it names one.
export function stubAuthConfig(
  config: (AuthConfig & { appOrigin?: string }) | "fail",
  extra?: (url: string, init?: RequestInit) => Response | undefined,
) {
  const body = config !== "fail" && config.enabled && !("appOrigin" in config)
    ? { ...config, appOrigin: window.location.origin }
    : config;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).endsWith("/api/auth-config")) {
      const answer = extra?.(String(url), init);
      if (answer) return answer;
      throw new Error(`unexpected fetch ${url}`);
    }
    if (config === "fail") throw new Error("network");
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Install a fake desktop-shell sign-in bridge on `window.penDesktop`; returns its spies. */
export function stubDesktopAuth() {
  const handlers: Array<(p: { token: string; verifier: string }) => void> = [];
  const signIn = vi.fn();
  const unsubscribe = vi.fn();
  const onToken = vi.fn((cb: (p: { token: string; verifier: string }) => void) => {
    handlers.push(cb);
    return unsubscribe;
  });
  (window as unknown as { penDesktop?: unknown }).penDesktop = { auth: { signIn, onToken } };
  return { signIn, onToken, unsubscribe, deliver: (p: { token: string; verifier: string }) => handlers.forEach((h) => h(p)) };
}

export function clearDesktopAuth(): void {
  delete (window as unknown as { penDesktop?: unknown }).penDesktop;
  delete (window as unknown as { penAgentPanel?: unknown }).penAgentPanel;
}

export const CONFIG_ALL: AuthConfig = { enabled: true, google: true, emailEnabled: true };
export const CONFIG_OFF = AUTH_DISABLED;
