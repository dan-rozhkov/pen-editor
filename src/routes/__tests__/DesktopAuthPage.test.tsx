import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentLocation, renderAuthPage } from "@/test/renderAuthPage";
import { authClientMock, CONFIG_ALL, CONFIG_OFF, resetAuthMocks, setMockSession, stubAuthConfig, USER } from "@/test/authMocks";

vi.mock("@/lib/auth/authClient", async () => (await import("@/test/authMocks")).authClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/test/authMocks")).sessionModule());

import DesktopAuthPage, { PENDING_KEY } from "../DesktopAuthPage";

const STATE = "s".repeat(43);
const CHALLENGE = "c".repeat(43);
const QUERY = `?state=${STATE}&challenge=${CHALLENGE}`;
const tokenReply = (status = 200) => () => new Response(JSON.stringify({ token: "tok/1+2" }), { status });

const open = async (url = `/auth/desktop${QUERY}`, config = CONFIG_ALL, reply = tokenReply()) => {
  const fetchMock = stubAuthConfig(config, reply);
  renderAuthPage(DesktopAuthPage, "/auth/desktop", url);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  return fetchMock;
};
const tokenCalls = (fetchMock: ReturnType<typeof stubAuthConfig>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/account/desktop-token"));

beforeEach(() => {
  resetAuthMocks();
  localStorage.clear();
  // A plain object keeps the custom-scheme assignment from navigating happy-dom.
  vi.stubGlobal("location", { origin: window.location.origin, pathname: "/auth/desktop", search: "", href: "" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<DesktopAuthPage />", () => {
  it.each([
    ["no query and nothing stored", "/auth/desktop"],
    ["a malformed state", `/auth/desktop?state=short&challenge=${CHALLENGE}`],
    ["a malformed challenge", `/auth/desktop?state=${STATE}&challenge=${"!".repeat(43)}`],
  ])("shows an error for %s", async (_label, url) => {
    setMockSession(USER);
    const fetchMock = await open(url);
    expect(screen.getByText(/invalid or has expired/)).toBeTruthy();
    expect(tokenCalls(fetchMock)).toHaveLength(0);
  });

  it("says sign-in is unavailable when accounts are off", async () => {
    await open(undefined, CONFIG_OFF);
    expect(screen.getByText(/not available/)).toBeTruthy();
  });

  it("remembers the query and sends a signed-out visitor to sign-in, next keeping the query", async () => {
    await open();
    await waitFor(() => expect(currentLocation()).toMatch(/^\/sign-in\?next=/));
    const next = new URLSearchParams(currentLocation()!.split("?")[1]).get("next");
    expect(next).toBe(`/auth/desktop${QUERY}`);
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toMatchObject({ state: STATE, challenge: CHALLENGE });
  });

  it("uses the pair remembered under 10 minutes ago when the query is gone", async () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ state: STATE, challenge: CHALLENGE, at: Date.now() - 60_000 }));
    setMockSession(USER);
    const fetchMock = await open("/auth/desktop");
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Sideform Desktop" }));
    await waitFor(() => expect(tokenCalls(fetchMock)).toHaveLength(1));
  });

  it("ignores a remembered pair older than 10 minutes", async () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ state: STATE, challenge: CHALLENGE, at: Date.now() - 11 * 60_000 }));
    setMockSession(USER);
    await open("/auth/desktop");
    expect(screen.getByText(/invalid or has expired/)).toBeTruthy();
  });

  it("signed in: asks for confirmation and posts nothing until the click", async () => {
    setMockSession(USER);
    const fetchMock = await open();
    expect(screen.getByText(USER.email)).toBeTruthy();
    expect(screen.getByText(/Continue only if you started sign-in from Sideform Desktop just now/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(tokenCalls(fetchMock)).toHaveLength(0);
    expect(window.location.href).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Sign in to Sideform Desktop" }));
    await waitFor(() => expect(window.location.href).toBe(`sideform://auth?token=tok%2F1%2B2&state=${STATE}`));
    const [url, init] = tokenCalls(fetchMock)[0];
    expect(String(url)).toMatch(/\/api\/account\/desktop-token$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ challenge: CHALLENGE });
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();
    expect(screen.getByText(/Return to Sideform Desktop/)).toBeTruthy();
  });

  it("after the hand-off, Try again mints a fresh token and redirects again", async () => {
    setMockSession(USER);
    const fetchMock = await open();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Sideform Desktop" }));
    await screen.findByText(/Return to Sideform Desktop/);
    window.location.href = "";
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(window.location.href).toBe(`sideform://auth?token=tok%2F1%2B2&state=${STATE}`));
    expect(tokenCalls(fetchMock)).toHaveLength(2);
  });

  it("a 401 signs out and sends the visitor to sign-in, next keeping the query", async () => {
    setMockSession(USER);
    await open(undefined, CONFIG_ALL, tokenReply(401));
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Sideform Desktop" }));
    await waitFor(() => expect(currentLocation()).toMatch(/^\/sign-in\?next=/));
    expect(authClientMock.signOut).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(currentLocation()!.split("?")[1]).get("next")).toBe(`/auth/desktop${QUERY}`);
    expect(window.location.href).toBe("");
  });

  it("cancel clears the pending pair and posts nothing", async () => {
    setMockSession(USER);
    const fetchMock = await open();
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Sign-in cancelled. You can close this tab.")).toBeTruthy();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(tokenCalls(fetchMock)).toHaveLength(0);
  });

  it("shows the error in text when the backend refuses", async () => {
    setMockSession(USER);
    await open(undefined, CONFIG_ALL, tokenReply(500));
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Sideform Desktop" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not start sign-in. Try again.");
    expect(window.location.href).toBe("");
  });
});
