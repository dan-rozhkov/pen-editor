import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, apiFetchUrl, credentialsMode, setCredentialsEnabled, withCredentials } from "@/lib/apiBase";
import { AUTH_DISABLED, loadAuthConfig, resetAuthConfigCache } from "@/lib/auth/authConfig";
import { useAuthStore } from "@/lib/auth/authState";
import { describeActionError, describeRedirectError } from "@/lib/auth/errors";
import { safeNext } from "@/lib/auth/safeNext";
import { describeScope } from "@/lib/auth/scopes";
import { appHref, signInHref, signInPath } from "@/lib/auth/paths";
import { stubAuthConfig } from "@/test/authMocks";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetAuthConfigCache();
});

describe("credentials helper", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_AI_API_URL", "");
    vi.stubEnv("VITE_DESIGN_AGENT_BACKEND_URL", "https://api.example.com/");
    setCredentialsEnabled(true);
  });

  it("sends no credentials until accounts are known to be enabled", async () => {
    setCredentialsEnabled(false);
    expect(credentialsMode()).toBeUndefined();
    expect(withCredentials({ method: "POST" })).toEqual({ method: "POST" });
    await apiFetch("/api/models");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/models", {});
  });

  it("loadAuthConfig fetches /api/auth-config without credentials, then enables them", async () => {
    resetAuthConfigCache();
    stubAuthConfig({ enabled: true, google: false, emailEnabled: true });
    await loadAuthConfig();
    expect(vi.mocked(fetch).mock.calls[0][1]?.credentials).toBeUndefined();
    expect(credentialsMode()).toBe("include");
  });

  it.each([
    ["on another origin", "https://pen-editor.onrender.com"],
    ["missing (older backend)", undefined],
  ])("credentials stay off when appOrigin is %s", async (_label, appOrigin) => {
    resetAuthConfigCache();
    stubAuthConfig({ enabled: true, google: true, emailEnabled: true, appOrigin });
    expect(await loadAuthConfig()).toEqual(AUTH_DISABLED);
    expect(credentialsMode()).toBeUndefined();
    expect(useAuthStore.getState().accountsEnabled).toBe(false);
  });

  it("appOrigin matches this page's origin ignoring a trailing slash", async () => {
    resetAuthConfigCache();
    stubAuthConfig({ enabled: true, google: false, emailEnabled: false, appOrigin: `${window.location.origin}/` });
    expect((await loadAuthConfig()).enabled).toBe(true);
  });

  it.each(["fail", { enabled: false, google: false, emailEnabled: false }] as const)(
    "credentials stay off when the config is %j",
    async (config) => {
      resetAuthConfigCache();
      stubAuthConfig(config);
      await loadAuthConfig();
      expect(credentialsMode()).toBeUndefined();
    },
  );

  it("withCredentials adds credentials: include (once enabled) and keeps the rest of init", () => {
    const signal = new AbortController().signal;
    expect(withCredentials({ method: "POST", signal })).toEqual({
      method: "POST",
      signal,
      credentials: "include",
    });
  });

  it("apiFetch resolves the backend URL and always sends credentials", async () => {
    await apiFetch("/api/models");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/models", {
      credentials: "include",
    });
  });

  it("apiFetch cannot be talked out of credentials by the caller", async () => {
    await apiFetch("/api/x", { credentials: "omit", method: "PUT" });
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: "PUT", credentials: "include" });
  });

  it("apiFetchUrl leaves an already-resolved URL alone", async () => {
    await apiFetchUrl("https://api.example.com/api/showcase?x=1");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/showcase?x=1", {
      credentials: "include",
    });
  });

  it("no source file calls fetch(resolveApiUrl(...)) directly", () => {
    const sources = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/__tests__/**"], {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const offenders = Object.entries(sources)
      .filter(([, text]) => /\bfetch\(\s*resolveApiUrl\(/.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

describe("auth client wiring", () => {
  it("talks to <backend>/api/auth with the session cookie", async () => {
    vi.stubEnv("VITE_AI_API_URL", "");
    vi.stubEnv("VITE_DESIGN_AGENT_BACKEND_URL", "https://api.example.com");
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { authClient, resolveAuthBaseUrl } = await import("@/lib/auth/authClient");
    expect(resolveAuthBaseUrl()).toBe("https://api.example.com");
    await authClient.signOut();

    const [target, init] = fetchMock.mock.calls[0];
    const url = target instanceof Request ? target.url : String(target);
    expect(url).toBe("https://api.example.com/api/auth/sign-out");
    const credentials = init?.credentials ?? (target as Request).credentials;
    expect(credentials).toBe("include");
  });

  it("falls back to the page origin when the backend is same-origin", async () => {
    vi.stubEnv("VITE_AI_API_URL", "");
    vi.stubEnv("VITE_DESIGN_AGENT_BACKEND_URL", "");
    vi.resetModules();
    const { resolveAuthBaseUrl } = await import("@/lib/auth/authClient");
    expect(resolveAuthBaseUrl()).toBe(window.location.origin);
  });
});

describe("loadAuthConfig", () => {
  it("returns the config and caches the request", async () => {
    stubAuthConfig({ enabled: true, google: true, emailEnabled: false });
    expect(await loadAuthConfig()).toEqual({ enabled: true, google: true, emailEnabled: false });
    await loadAuthConfig();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("is disabled when the request fails", async () => {
    stubAuthConfig("fail");
    expect(await loadAuthConfig()).toEqual(AUTH_DISABLED);
  });

  it("is disabled on a non-OK answer and on enabled:false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })));
    expect(await loadAuthConfig()).toEqual(AUTH_DISABLED);
    resetAuthConfigCache();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false, google: true }))),
    );
    expect(await loadAuthConfig()).toEqual(AUTH_DISABLED);
  });
});

describe("safeNext", () => {
  it.each([
    ["/app", "/app"],
    ["/consent?client_id=abc&sig=1", "/consent?client_id=abc&sig=1"],
    [null, "/app"],
    ["", "/app"],
  ])("accepts %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    "https://evil.example/app",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "app",
    "/ok\nSet-Cookie: x",
  ])("rejects %j", (input) => {
    expect(safeNext(input)).toBe("/app");
  });

  it("uses a caller fallback", () => {
    expect(safeNext("//x", "/account")).toBe("/account");
  });
});

describe("error and scope copy", () => {
  it("describes redirect errors plainly and never echoes odd input", () => {
    expect(describeRedirectError("INVALID_TOKEN")).toMatch(/invalid or has expired/);
    expect(describeRedirectError("access_denied")).toMatch(/cancelled/);
    expect(describeRedirectError("oops_1")).toContain("(oops_1)");
    expect(describeRedirectError("<script>")).not.toContain("<script>");
  });

  it("keeps sign-in failures neutral", () => {
    expect(describeActionError({ status: 401 })).toBe("Incorrect email or password.");
    expect(describeActionError({ code: "EMAIL_NOT_VERIFIED" })).toMatch(/Verify your email/);
    expect(describeActionError({ status: 429 })).toMatch(/Too many/);
    expect(describeActionError({ code: "INVALID_TOKEN" })).toMatch(/reset link/);
    expect(describeActionError({ code: "PASSWORD_TOO_SHORT" })).toMatch(/too short/);
    expect(describeActionError({ code: "PASSWORD_TOO_LONG" })).toMatch(/too long/);
    expect(describeActionError({ status: 500 })).toMatch(/Something went wrong/);
    expect(describeActionError(null)).toMatch(/Something went wrong/);
  });

  it("describes known scopes and passes unknown ones through", () => {
    expect(describeScope("mcp:tools")).toMatch(/design tools/);
    expect(describeScope("custom")).toBe("custom");
  });

  it("builds app links", () => {
    expect(appHref("/account")).toBe("/account");
    expect(signInPath("/a b")).toBe("/sign-in?next=%2Fa%20b");
    expect(signInHref()).toBe("/sign-in");
  });
});

describe("stripBase", () => {
  it("removes the deploy base and leaves other paths alone", async () => {
    const { stripBase } = await import("@/lib/auth/paths");
    vi.stubEnv("BASE_URL", "/pen/");
    expect(stripBase("/pen/app")).toBe("/app");
    expect(stripBase("/pen")).toBe("/");
    expect(stripBase("/pencil")).toBe("/pencil");
    vi.stubEnv("BASE_URL", "/");
    expect(stripBase("/app")).toBe("/app");
  });
});
