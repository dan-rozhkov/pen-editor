import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authClientMock,
  CONFIG_ALL,
  CONFIG_OFF,
  resetAuthMocks,
  setMockSession,
  stubAuthConfig,
  USER,
} from "@/test/authMocks";

vi.mock("@/lib/auth/authClient", async () => (await import("@/test/authMocks")).authClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/test/authMocks")).sessionModule());

import { AuthBootstrap } from "../AuthBootstrap";
import { AuthMenu } from "../AuthMenu";
import { useAuthStore } from "@/lib/auth/authState";

// Warm the lazy chunk so a loaded CI machine cannot time out the first findBy*.
beforeAll(async () => {
  await import("../AuthMenuInner");
  await import("@/lib/auth/SessionSync");
});
beforeEach(resetAuthMocks);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<AuthMenu />", () => {
  it("renders nothing when accounts are disabled", async () => {
    stubAuthConfig(CONFIG_OFF);
    const { container } = render(<AuthMenu variant="showcase" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when /api/auth-config fails", async () => {
    stubAuthConfig("fail");
    const { container } = render(<AuthMenu variant="toolbar" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("shows a Sign in link for a signed-out visitor (showcase: same tab, back to the page)", async () => {
    stubAuthConfig(CONFIG_ALL);
    render(<AuthMenu variant="showcase" />);
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
    expect(link.getAttribute("target")).toBeNull();
  });

  it("strips the deploy base from ?next= and keeps the link base-aware", async () => {
    vi.stubEnv("BASE_URL", "/pen/");
    window.history.replaceState(null, "", "/pen/gallery");
    try {
      stubAuthConfig(CONFIG_ALL);
      render(<AuthMenu variant="showcase" />);
      const link = await screen.findByRole("link", { name: "Sign in" });
      expect(link.getAttribute("href")).toBe("/pen/sign-in?next=%2Fgallery");
    } finally {
      vi.unstubAllEnvs();
      window.history.replaceState(null, "", "/");
    }
  });

  it("opens the sign-in page in a new tab from the editor so the document is not lost", async () => {
    stubAuthConfig(CONFIG_ALL);
    render(<AuthMenu variant="toolbar" />);
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener");
  });

  it("shows an avatar menu with Account and Sign out when signed in", async () => {
    stubAuthConfig(CONFIG_ALL);
    setMockSession(USER);
    render(<AuthMenu variant="toolbar" />);

    const trigger = await screen.findByRole("button", { name: `Account menu for ${USER.name}` });
    fireEvent.click(trigger);
    expect(await screen.findByText("Account")).toBeTruthy();
    fireEvent.click(screen.getByText("Sign out"));
    await waitFor(() => expect(authClientMock.signOut).toHaveBeenCalled());
  });

  it("renders nothing while the session is loading", async () => {
    stubAuthConfig(CONFIG_ALL);
    setMockSession(null, true);
    const { container } = render(<AuthMenu variant="showcase" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
  });
});

describe("<AuthBootstrap />", () => {
  it("does not touch the session when accounts are disabled", async () => {
    stubAuthConfig(CONFIG_OFF);
    render(<AuthBootstrap />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(useAuthStore.getState().status).toBe("unknown");
  });

  it("mirrors the session when accounts are enabled", async () => {
    stubAuthConfig(CONFIG_ALL);
    setMockSession(USER);
    render(<AuthBootstrap />);
    await waitFor(() => expect(useAuthStore.getState().status).toBe("signed-in"));
  });
});
