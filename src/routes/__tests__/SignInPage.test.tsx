import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentLocation, renderAuthPage } from "@/test/renderAuthPage";
import {
  authClientMock,
  CONFIG_ALL,
  resetAuthMocks,
  setMockSession,
  stubAuthConfig,
  USER,
} from "@/test/authMocks";

vi.mock("@/lib/auth/authClient", async () => (await import("@/test/authMocks")).authClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/test/authMocks")).sessionModule());

import SignInPage from "../SignInPage";

const open = async (url = "/sign-in", config = CONFIG_ALL) => {
  stubAuthConfig(config);
  renderAuthPage(SignInPage, "/sign-in", url);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(resetAuthMocks);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<SignInPage /> per /api/auth-config", () => {
  it("shows Google and the email form when both are on", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Email me a link" })).toBeTruthy();
  });

  it("hides Google when it is off", async () => {
    await open("/sign-in", { enabled: true, google: false, emailEnabled: true });
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
  });

  it("hides the whole email form when email is off (Google still works)", async () => {
    await open("/sign-in", { enabled: true, google: true, emailEnabled: false });
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

  it("says accounts are unavailable when disabled, with no form", async () => {
    await open("/sign-in", { enabled: false, google: false, emailEnabled: false });
    expect(screen.getByText(/Accounts are not available/)).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("says so when no method is available", async () => {
    await open("/sign-in", { enabled: true, google: false, emailEnabled: false });
    expect(screen.getByText(/No sign-in methods/)).toBeTruthy();
  });
});

describe("<SignInPage /> flows", () => {
  it("sends a magic link with an absolute same-origin callback and answers neutrally", async () => {
    await open("/sign-in?next=%2Faccount");
    type("Email", "ada@example.com");
    press("Email me a link");

    await screen.findByText(/If an account exists for that address/);
    expect(authClientMock.signIn.magicLink).toHaveBeenCalledWith({
      email: "ada@example.com",
      callbackURL: `${window.location.origin}/account`,
      errorCallbackURL: `${window.location.origin}/sign-in`,
    });
  });

  it("ignores an off-site ?next= and falls back to /app", async () => {
    await open("/sign-in?next=https%3A%2F%2Fevil.example");
    type("Email", "ada@example.com");
    press("Email me a link");
    await screen.findByRole("status");
    expect(authClientMock.signIn.magicLink.mock.calls[0][0].callbackURL).toBe(
      `${window.location.origin}/app`,
    );
  });

  it("signs in with a password and navigates to next", async () => {
    await open("/sign-in?next=%2Faccount");
    press("Use password");
    type("Email", "ada@example.com");
    type("Password", "hunter22");
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(currentLocation()).toBe("/account"));
    expect(authClientMock.signIn.email).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "hunter22",
      callbackURL: `${window.location.origin}/account`,
    });
  });

  it("announces a failed password sign-in without revealing whether the account exists", async () => {
    authClientMock.signIn.email.mockResolvedValue({ data: null, error: { status: 401 } });
    await open();
    press("Use password");
    type("Email", "ada@example.com");
    type("Password", "wrong");
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Incorrect email or password.");
  });

  it("starts Google sign-in", async () => {
    await open();
    press("Continue with Google");
    await waitFor(() =>
      expect(authClientMock.signIn.social).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: `${window.location.origin}/app`,
      }),
    );
  });

  it("creates an account and answers neutrally", async () => {
    await open();
    press("Create an account");
    type("Name", "Ada");
    type("Email", "ada@example.com");
    type("Password", "hunter22");
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }));

    await screen.findByText(/If this address can be registered/);
    expect(authClientMock.signUp.email).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com", name: "Ada" }),
    );
  });

  it("requests a password reset with a neutral answer", async () => {
    await open();
    press("Use password");
    press("Forgot password?");
    type("Email", "ada@example.com");
    fireEvent.submit(screen.getByRole("button", { name: "Email me a reset link" }));
    await screen.findByText(/If an account exists for that address/);
    expect(authClientMock.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com" }),
    );
  });

  it("completes a reset from ?token= and removes the token from the URL", async () => {
    window.history.replaceState(null, "", "/sign-in?token=tok-1");
    await open("/sign-in?token=tok-1");
    expect(window.location.search).toBe("");
    type("New password", "hunter22");
    fireEvent.submit(screen.getByRole("button", { name: "Update password" }));

    await screen.findByText(/Password updated/);
    expect(authClientMock.resetPassword).toHaveBeenCalledWith({
      newPassword: "hunter22",
      token: "tok-1",
    });
  });

  it("shows ?error= plainly", async () => {
    await open("/sign-in?error=INVALID_TOKEN");
    expect((await screen.findByRole("alert")).textContent).toMatch(/invalid or has expired/);
  });

  it("offers Continue / Sign out when already signed in", async () => {
    setMockSession(USER);
    await open("/sign-in?next=%2Faccount");
    expect(screen.getByText(USER.email)).toBeTruthy();
    press("Continue");
    await waitFor(() => expect(currentLocation()).toBe("/account"));
  });
});

describe("<SignInPage /> OAuth continuation (signed query from the oauth-provider plugin)", () => {
  const OAUTH_SEARCH = "?client_id=cid-1&sig=abc&ba_param=client_id&ba_param=sig";
  const assign = vi.fn();

  // The plugin's client reads window.location.search, so the real URL must
  // carry the query as well as the router's.
  const openOAuth = async () => {
    window.history.replaceState(null, "", `/sign-in${OAUTH_SEARCH}`);
    vi.stubGlobal("location", {
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: window.location.search,
      href: window.location.href,
      assign,
    });
    await open(`/sign-in${OAUTH_SEARCH}`);
  };

  beforeEach(() => assign.mockReset());
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("returns to this very URL from a magic link, sign-up verification and Google", async () => {
    await openOAuth();
    const here = `${window.location.origin}/sign-in${OAUTH_SEARCH}`;

    type("Email", "ada@example.com");
    press("Email me a link");
    await screen.findByText(/If an account exists for that address/);
    expect(authClientMock.signIn.magicLink.mock.calls[0][0].callbackURL).toBe(here);

    press("Continue with Google");
    await waitFor(() => expect(authClientMock.signIn.social).toHaveBeenCalled());
    expect(authClientMock.signIn.social.mock.calls[0][0].callbackURL).toBe(here);

    press("Create an account");
    type("Email", "ada@example.com");
    type("Password", "hunter22");
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(authClientMock.signUp.email).toHaveBeenCalled());
    expect(authClientMock.signUp.email.mock.calls[0][0].callbackURL).toBe(here);
  });

  it("continues the OAuth flow when a session already exists and follows the returned url", async () => {
    setMockSession(USER);
    await openOAuth();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://agent.example/cb?code=2"));
    expect(authClientMock.oauth2.continue).toHaveBeenCalledTimes(1);
  });

  it("the Continue button resumes the OAuth flow too", async () => {
    setMockSession(USER);
    authClientMock.oauth2.continue.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    await openOAuth(); // auto-continue fails, the button stays as the fallback
    await waitFor(() => expect(authClientMock.oauth2.continue).toHaveBeenCalledTimes(1));
    expect(assign).not.toHaveBeenCalled();
    press("Continue");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://agent.example/cb?code=2"));
  });

  it("after a password sign-in continues OAuth instead of navigating to next", async () => {
    await openOAuth();
    press("Use password");
    type("Email", "ada@example.com");
    type("Password", "hunter22");
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(authClientMock.oauth2.continue).toHaveBeenCalled());
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://agent.example/cb?code=2"));
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("never navigates to next when the sign-in result already carries a redirect url", async () => {
    authClientMock.signIn.email.mockResolvedValue({
      data: { redirect: true, url: "https://agent.example/cb?code=9" },
      error: null,
    });
    await openOAuth();
    press("Use password");
    type("Email", "ada@example.com");
    type("Password", "hunter22");
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://agent.example/cb?code=9"));
    expect(authClientMock.oauth2.continue).not.toHaveBeenCalled();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("a plain visit (no signed query) never calls oauth2.continue", async () => {
    setMockSession(USER);
    await open("/sign-in?next=%2Faccount");
    press("Continue");
    await waitFor(() => expect(currentLocation()).toBe("/account"));
    expect(authClientMock.oauth2.continue).not.toHaveBeenCalled();
  });
});

describe("<SignInPage /> base path", () => {
  it("links back to the app root under the deploy base", async () => {
    vi.stubEnv("BASE_URL", "/pen/");
    try {
      await open("/sign-in", { enabled: false, google: false, emailEnabled: false });
      expect(screen.getByRole("link", { name: "Back to Sideform" }).getAttribute("href")).toBe("/pen/");
      expect(screen.getByRole("link", { name: "Sideform" }).getAttribute("href")).toBe("/pen/");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
