import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { authClientMock, CONFIG_ALL, resetAuthMocks, setMockSession, stubAuthConfig, USER } from "@/test/authMocks";

vi.mock("@/lib/auth/authClient", async () => (await import("@/test/authMocks")).authClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/test/authMocks")).sessionModule());

import { PrivacySection } from "../PrivacySection";

beforeAll(async () => {
  await import("../DeleteAccountGroup");
});
beforeEach(() => {
  resetAuthMocks();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PrivacySection delete account", () => {
  it("is hidden while signed out", async () => {
    stubAuthConfig(CONFIG_ALL);
    render(<PrivacySection />);
    await screen.findByText("Export my data");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Delete account")).toBeNull();
  });

  it("enables the button only when the typed email matches, then signs out", async () => {
    setMockSession(USER);
    const f = stubAuthConfig(CONFIG_ALL, (url) =>
      url.endsWith("/api/account/delete") ? new Response(JSON.stringify({ deleted: true }), { status: 200 }) : undefined,
    );
    render(<PrivacySection />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete account" }));
    const confirm = screen.getAllByRole("button", { name: "Delete account" }).at(-1)!;
    expect(confirm.hasAttribute("disabled") || confirm.getAttribute("aria-disabled") === "true" || (confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type ada@example.com/), { target: { value: "other@example.com" } });
    expect((screen.getAllByRole("button", { name: "Delete account" }).at(-1) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type ada@example.com/), { target: { value: "Ada@Example.com" } });
    const enabled = screen.getAllByRole("button", { name: "Delete account" }).at(-1) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    fireEvent.click(enabled);
    await screen.findByText("Account deleted");
    await waitFor(() => expect(authClientMock.signOut).toHaveBeenCalled());
    const call = f.mock.calls.find((c) => String(c[0]).endsWith("/api/account/delete"))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ confirmEmail: "Ada@Example.com" });
  });

  it.each([
    ["resolves", () => authClientMock.signOut.mockResolvedValue({ data: null, error: null })],
    ["rejects", () => authClientMock.signOut.mockRejectedValue(new Error("network"))],
  ])("forces the session to re-resolve after a delete when signOut %s", async (_label, arrange) => {
    arrange();
    setMockSession(USER);
    stubAuthConfig(CONFIG_ALL, (url) =>
      url.endsWith("/api/account/delete") ? new Response(JSON.stringify({ deleted: true }), { status: 200 }) : undefined,
    );
    render(<PrivacySection />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete account" }));
    fireEvent.change(screen.getByLabelText(/Type ada@example.com/), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Delete account" }).at(-1)!);
    await screen.findByText("Account deleted");
    await waitFor(() => expect(authClientMock.$store.notify).toHaveBeenCalledWith("$sessionSignal"));
  });

  it.each([
    [400, "confirm_email_mismatch", "That email does not match your account."],
    [401, "sign_in_required", "Your session has ended. Sign in again, then retry."],
    [503, "auth_disabled", "Accounts are turned off on this server."],
    [500, "delete_failed", "Could not delete the account. Try again."],
    [500, "something_new", "Could not delete the account. Try again."],
  ])("maps %i %s to a friendly message, never the code", async (status, code, message) => {
    setMockSession(USER);
    stubAuthConfig(CONFIG_ALL, (url) =>
      url.endsWith("/api/account/delete") ? new Response(JSON.stringify({ error: code }), { status }) : undefined,
    );
    render(<PrivacySection />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete account" }));
    fireEvent.change(screen.getByLabelText(/Type ada@example.com/), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Delete account" }).at(-1)!);
    await screen.findByText(message);
    expect(screen.queryByText(code)).toBeNull();
    expect(authClientMock.signOut).not.toHaveBeenCalled();
    expect(authClientMock.$store.notify).not.toHaveBeenCalled();
  });
});

describe("PrivacySection analytics switch", () => {
  it("is replaced by a note without a PostHog key", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    stubAuthConfig({ enabled: false, google: false, emailEnabled: false });
    render(<PrivacySection />);
    expect(screen.queryByRole("switch", { name: "Usage analytics" })).toBeNull();
    expect(screen.getByText("Analytics is not enabled in this build.")).toBeTruthy();
  });

  it("writes the opt-out flag", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    stubAuthConfig({ enabled: false, google: false, emailEnabled: false });
    render(<PrivacySection />);
    fireEvent.click(screen.getByRole("switch", { name: "Usage analytics" }));
    expect(localStorage.getItem("pen.analytics")).toBe("off");
    fireEvent.click(screen.getByRole("switch", { name: "Usage analytics" }));
    expect(localStorage.getItem("pen.analytics")).toBeNull();
  });
});
