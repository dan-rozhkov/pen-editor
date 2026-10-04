import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setCredentialsEnabled } from "@/lib/apiBase";
import { buildCanvasContext } from "@/hooks/useDesignChat";
import { getActorId, getRequestUserId, peekActorId, requestUserIdParam, useAuthStore } from "@/lib/auth/authState";
import { claimAnonymousData } from "@/lib/auth/claimAnon";
import { createUserSkill, deleteUserSkill, listUserSkills } from "@/lib/userSkills";
import { getUserId } from "@/lib/userId";
import { useUserSkillStore } from "@/store/userSkillStore";
import { resetAuthMocks, setMockSession, USER } from "@/test/authMocks";

vi.mock("@/lib/auth/authClient", async () => (await import("@/test/authMocks")).authClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/test/authMocks")).sessionModule());

import SessionSync from "@/lib/auth/SessionSync";

const respond = (status: number) => vi.fn().mockResolvedValue(new Response("{}", { status }));
const claimCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("claim-anon"));

beforeEach(() => {
  localStorage.clear();
  resetAuthMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("claimAnonymousData", () => {
  it("does nothing when there is no anonymous id", async () => {
    vi.stubGlobal("fetch", respond(200));
    expect(await claimAnonymousData()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem("pen.userId")).toBeNull();
  });

  it.each([200, 409])("posts the anon id and forgets it on %i", async (status) => {
    setCredentialsEnabled(true);
    localStorage.setItem("pen.userId", "anon-1");
    vi.stubGlobal("fetch", respond(status));

    expect(await claimAnonymousData()).toBe(true);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/account/claim-anon");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(String(init?.body))).toEqual({ anonId: "anon-1" });
    expect(localStorage.getItem("pen.userId")).toBeNull();
  });

  it.each([401, 500])("keeps the anon id on %i so a later load retries", async (status) => {
    localStorage.setItem("pen.userId", "anon-1");
    vi.stubGlobal("fetch", respond(status));
    expect(await claimAnonymousData()).toBe(false);
    expect(localStorage.getItem("pen.userId")).toBe("anon-1");
  });

  it("keeps the anon id when offline", async () => {
    localStorage.setItem("pen.userId", "anon-1");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await claimAnonymousData()).toBe(false);
    expect(localStorage.getItem("pen.userId")).toBe("anon-1");
  });
});

describe("request bodies while signed in", () => {
  const signIn = () => useAuthStore.getState().setSession(USER.id);

  it("uses the anon id while signed out and nothing while signed in", () => {
    useAuthStore.getState().setSession(null);
    expect(getRequestUserId()).toBe(getUserId());
    expect(requestUserIdParam()).toBe(`userId=${getUserId()}`);
    expect(getActorId()).toBe(getUserId());

    signIn();
    expect(getRequestUserId()).toBeUndefined();
    expect(requestUserIdParam()).toBe("");
    expect(getActorId()).toBe(USER.id);
  });

  it("does not mint an anonymous id while signed in", () => {
    signIn();
    getRequestUserId();
    requestUserIdParam();
    expect(localStorage.getItem("pen.userId")).toBeNull();
  });

  it("chat request body omits userId when signed in and carries it when signed out", () => {
    const serialized = () => JSON.parse(JSON.stringify(buildCanvasContext())) as Record<string, unknown>;
    useAuthStore.getState().setSession(null);
    expect(serialized().userId).toBe(getUserId());
    signIn();
    expect(serialized()).not.toHaveProperty("userId");
  });

  it("user-skill requests omit userId when signed in and carry it when signed out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ skills: [], skill: {}, deleted: true }))),
    );
    signIn();
    await listUserSkills();
    await deleteUserSkill("s");
    await createUserSkill({ name: "s", description: "d", body: "b" } as Parameters<typeof createUserSkill>[0]);
    const calls = vi.mocked(fetch).mock.calls;
    expect(String(calls[0][0])).not.toContain("userId");
    expect(String(calls[1][0])).not.toContain("userId");
    expect(JSON.parse(String(calls[2][1]?.body))).not.toHaveProperty("userId");

    vi.mocked(fetch).mockClear();
    useAuthStore.getState().setSession(null);
    await listUserSkills();
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(`userId=${getUserId()}`);
  });
});

describe("anonymous id is never minted while accounts are on and the session is unresolved", () => {
  const accountsOn = () => useAuthStore.setState({ accountsEnabled: true, status: "unknown" });

  it("peeks instead of minting for request bodies, queries and the actor id", () => {
    accountsOn();
    expect(getRequestUserId()).toBeUndefined();
    expect(requestUserIdParam()).toBe("");
    expect(getActorId()).toBe("");
    expect(peekActorId()).toBeUndefined();
    expect(localStorage.getItem("pen.userId")).toBeNull();

    localStorage.setItem("pen.userId", "anon-1");
    expect(getRequestUserId()).toBe("anon-1");
  });

  it("still mints when signed out or when accounts are disabled", () => {
    useAuthStore.setState({ accountsEnabled: true, status: "signed-out" });
    const id = getRequestUserId();
    expect(id).toBeTruthy();
    expect(localStorage.getItem("pen.userId")).toBe(id);

    localStorage.clear();
    useAuthStore.setState({ accountsEnabled: false, status: "unknown" });
    expect(peekActorId()).toBe(getUserId());
  });

  it("a signed-in reload creates no pen.userId and never calls claim-anon", async () => {
    vi.stubGlobal("fetch", respond(200));
    useAuthStore.setState({ accountsEnabled: true });
    setMockSession(USER);
    render(<SessionSync />);
    await waitFor(() => expect(useAuthStore.getState().status).toBe("signed-in"));

    getRequestUserId();
    getActorId();
    peekActorId();
    expect(peekActorId()).toBe(USER.id);
    expect(localStorage.getItem("pen.userId")).toBeNull();
    expect(claimCalls()).toHaveLength(0);
  });
});

describe("SessionSync", () => {
  it("claims anon data on sign-in, mirrors the session and reloads skills", async () => {
    localStorage.setItem("pen.userId", "anon-1");
    vi.stubGlobal("fetch", respond(200));
    const refresh = vi.fn().mockResolvedValue(undefined);
    useUserSkillStore.setState({ status: "ready", refresh });

    setMockSession(USER);
    render(<SessionSync />);

    await waitFor(() => expect(localStorage.getItem("pen.userId")).toBeNull());
    expect(useAuthStore.getState()).toMatchObject({ status: "signed-in", userId: USER.id });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("marks the store signed out and does not claim without a session", async () => {
    localStorage.setItem("pen.userId", "anon-1");
    vi.stubGlobal("fetch", respond(200));
    setMockSession(null);
    render(<SessionSync />);

    await waitFor(() => expect(useAuthStore.getState().status).toBe("signed-out"));
    expect(claimCalls()).toHaveLength(0);
    expect(localStorage.getItem("pen.userId")).toBe("anon-1");
  });

  it("waits while the session is pending", () => {
    setMockSession(null, true);
    render(<SessionSync />);
    expect(useAuthStore.getState().status).toBe("unknown");
  });

  it("follows a later sign-out", async () => {
    vi.stubGlobal("fetch", respond(200));
    setMockSession(USER);
    render(<SessionSync />);
    await waitFor(() => expect(useAuthStore.getState().status).toBe("signed-in"));
    act(() => setMockSession(null));
    await waitFor(() => expect(useAuthStore.getState().status).toBe("signed-out"));
  });
});
