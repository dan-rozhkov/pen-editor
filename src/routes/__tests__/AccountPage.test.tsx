import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentLocation, renderAuthPage } from "@/test/renderAuthPage";
import { setCredentialsEnabled } from "@/lib/apiBase";
import { authClientMock, resetAuthMocks, setMockSession, USER } from "@/test/authMocks";

vi.mock("@/lib/auth/authClient", async () => (await import("@/test/authMocks")).authClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/test/authMocks")).sessionModule());

import AccountPage from "../AccountPage";

const open = () => renderAuthPage(AccountPage, "/account", "/account");
const ok = (data: unknown) => ({ data, error: null });
const KEY = { id: "k1", name: "Cursor", start: "sf_ab", createdAt: new Date() };
const CONSENT = { id: "c1", clientId: "cid-1", scopes: ["mcp:tools"] };

beforeEach(() => {
  resetAuthMocks();
  setMockSession(USER);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<AccountPage />", () => {
  it("redirects to sign-in without a session", async () => {
    setMockSession(null);
    open();
    await waitFor(() => expect(currentLocation()).toBe("/sign-in?next=%2Faccount"));
  });

  it("shows the email and linked providers", async () => {
    authClientMock.listAccounts.mockResolvedValue(ok([{ providerId: "google" }, { providerId: "credential" }]));
    open();
    expect(screen.getByText(USER.email)).toBeTruthy();
    expect(await screen.findByText(/Google, Email and password/)).toBeTruthy();
  });

  it("creates an API key and shows the secret once", async () => {
    open();
    fireEvent.change(await screen.findByLabelText("Key name"), { target: { value: "Cursor" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(await screen.findByText("sf_secret")).toBeTruthy();
    expect(authClientMock.apiKey.create).toHaveBeenCalledWith({ name: "Cursor" });
    // the list is reloaded; the full key is never part of a listing
    await waitFor(() => expect(authClientMock.apiKey.list).toHaveBeenCalledTimes(2));
  });

  it("lists keys and revokes one after confirmation", async () => {
    authClientMock.apiKey.list.mockResolvedValue(ok({ apiKeys: [KEY] }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Cursor" }));
    expect(authClientMock.apiKey.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));

    await waitFor(() => expect(authClientMock.apiKey.delete).toHaveBeenCalledWith({ keyId: "k1" }));
  });

  it("clears the revealed secret once a key is revoked", async () => {
    authClientMock.apiKey.create.mockResolvedValue(ok({ key: "sf_secret", id: "k1" }));
    authClientMock.apiKey.list.mockResolvedValue(ok({ apiKeys: [KEY] }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    expect(await screen.findByText("sf_secret")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Cursor" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));

    await waitFor(() => expect(screen.queryByText("sf_secret")).toBeNull());
    expect(screen.queryByText(/shown only once/)).toBeNull();
  });

  it("keeps the revealed secret when a different key is revoked", async () => {
    authClientMock.apiKey.create.mockResolvedValue(ok({ key: "sf_secret", id: "k2" }));
    authClientMock.apiKey.list.mockResolvedValue(ok({ apiKeys: [KEY] }));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    expect(await screen.findByText("sf_secret")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Cursor" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));

    await waitFor(() => expect(authClientMock.apiKey.delete).toHaveBeenCalledWith({ keyId: "k1" }));
    expect(screen.getByText("sf_secret")).toBeTruthy();
  });

  it("reports an API key list failure", async () => {
    authClientMock.apiKey.list.mockResolvedValue({ data: null, error: { status: 500 } });
    open();
    expect((await screen.findAllByRole("alert"))[0].textContent).toMatch(/Could not load API keys/);
  });

  it("lists connected agents by name and revokes consent", async () => {
    authClientMock.oauth2.getConsents.mockResolvedValue(ok([CONSENT]));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setCredentialsEnabled(true);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke access for Codex" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/account/connected-agents/revoke");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(String(init.body))).toEqual({ clientId: "cid-1" });
    expect(authClientMock.oauth2.deleteConsent).not.toHaveBeenCalled();
    expect(await screen.findByText(/must sign in again/)).toBeTruthy();
    await waitFor(() => expect(authClientMock.oauth2.getConsents).toHaveBeenCalledTimes(2));
  });

  it("reports a failed revoke", async () => {
    authClientMock.oauth2.getConsents.mockResolvedValue(ok([CONSENT]));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke access for Codex" }));
    expect((await screen.findAllByRole("alert"))[0].textContent).toMatch(/Could not revoke access/);
  });

  it("signs out and returns to the showcase", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(authClientMock.signOut).toHaveBeenCalled());
    await waitFor(() => expect(currentLocation()).toBe("/"));
  });
});
