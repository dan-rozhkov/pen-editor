import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentLocation, renderAuthPage } from "@/test/renderAuthPage";
import { authClientMock, resetAuthMocks, setMockSession, USER } from "@/test/authMocks";

vi.mock("@/lib/auth/authClient", async () => (await import("@/test/authMocks")).authClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/test/authMocks")).sessionModule());

import ConsentPage from "../ConsentPage";

const URL_WITH_QUERY = "/consent?client_id=cid-1&scope=openid%20mcp%3Atools&exp=1&sig=abc";
const open = (url = URL_WITH_QUERY) => renderAuthPage(ConsentPage, "/consent", url);
const assign = vi.fn();

beforeEach(() => {
  resetAuthMocks();
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<ConsentPage />", () => {
  it("redirects to sign-in, keeping the whole consent URL as next, without a session", async () => {
    open();
    await waitFor(() =>
      expect(currentLocation()).toBe(`/sign-in?next=${encodeURIComponent(URL_WITH_QUERY)}`),
    );
  });

  it("waits while the session loads", () => {
    setMockSession(null, true);
    open();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the client name and the requested scopes", async () => {
    setMockSession(USER);
    open();
    expect(await screen.findByText("Codex")).toBeTruthy();
    expect(screen.getByText("Use Sideform design tools in your open editor")).toBeTruthy();
    expect(authClientMock.oauth2.publicClient).toHaveBeenCalledWith({ query: { client_id: "cid-1" } });
  });

  it("Allow calls the consent API and follows the returned redirect", async () => {
    setMockSession(USER);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://agent.example/cb?code=1"));
    expect(authClientMock.oauth2.consent).toHaveBeenCalledWith({
      accept: true,
      scope: "openid mcp:tools",
    });
  });

  it("Deny calls the consent API with accept:false", async () => {
    setMockSession(USER);
    authClientMock.oauth2.consent.mockResolvedValue({
      data: { redirect_uri: "https://agent.example/cb?error=access_denied" },
      error: null,
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://agent.example/cb?error=access_denied"),
    );
    expect(authClientMock.oauth2.consent).toHaveBeenCalledWith(expect.objectContaining({ accept: false }));
  });

  it("announces a failure and stays on the page", async () => {
    setMockSession(USER);
    authClientMock.oauth2.consent.mockResolvedValue({ data: null, error: { status: 400 } });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not complete/);
    expect(assign).not.toHaveBeenCalled();
  });

  it("explains an incomplete request", async () => {
    setMockSession(USER);
    open("/consent");
    expect((await screen.findByRole("alert")).textContent).toMatch(/incomplete/);
  });
});
