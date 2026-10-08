import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authClientMock, resetAuthMocks, setMockSession, USER } from "@/test/authMocks";
import { currentLocation, renderAuthPage } from "@/test/renderAuthPage";

vi.mock("@/lib/auth/authClient", async () => (await import("@/test/authMocks")).authClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/test/authMocks")).sessionModule());

import AcceptInvitationPage from "../AcceptInvitationPage";

const URL = "/app/accept-invitation?id=inv-1";
const open = (url = URL) => renderAuthPage(AcceptInvitationPage, "/app/accept-invitation", url);

beforeEach(() => {
  resetAuthMocks();
  setMockSession(USER);
  sessionStorage.clear();
});
afterEach(cleanup);

describe("<AcceptInvitationPage />", () => {
  it("sends a signed-out visitor to sign-in and back to this URL", async () => {
    setMockSession(null);
    open();
    await waitFor(() =>
      expect(currentLocation()).toBe(`/sign-in?next=${encodeURIComponent(URL)}`),
    );
    expect(authClientMock.organization.acceptInvitation).not.toHaveBeenCalled();
  });

  it("shows the invitation and does not accept on load", async () => {
    open();
    expect(await screen.findByText(/boss@example.com/)).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(authClientMock.organization.acceptInvitation).not.toHaveBeenCalled();
  });

  it("accepts after the user clicks Accept", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(await screen.findByText("You are now a member of Acme.")).toBeTruthy();
    expect(authClientMock.organization.acceptInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
  });

  it("declines", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(await screen.findByText("You declined the invitation.")).toBeTruthy();
    expect(authClientMock.organization.rejectInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
  });

  it("explains a missing invitation (the server sends no code)", async () => {
    authClientMock.organization.getInvitation.mockResolvedValue({
      data: null,
      error: { message: "Invitation not found!", status: 400 },
    });
    open();
    expect((await screen.findByRole("alert")).textContent).toMatch(/no longer valid.*account page/);
    expect(screen.getByRole("link", { name: "Go to your account" })).toBeTruthy();
  });

  it("does not call a decline of an existing membership a success", async () => {
    authClientMock.organization.rejectInvitation.mockResolvedValue({
      data: null,
      error: { code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION", status: 400 },
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already a member/);
  });

  it("shows an error when sign out fails", async () => {
    authClientMock.organization.getInvitation.mockResolvedValue({
      data: null,
      error: { code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION", status: 403 },
    });
    authClientMock.signOut.mockRejectedValue(new Error("net"));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out and continue" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not sign out/);
  });

  it("offers sign out when the invitation is for another email", async () => {
    authClientMock.organization.getInvitation.mockResolvedValue({
      data: null,
      error: { code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION", status: 403 },
    });
    open();
    expect((await screen.findByRole("alert")).textContent).toMatch(/different email address/);
    fireEvent.click(screen.getByRole("button", { name: "Sign out and continue" }));
    await waitFor(() =>
      expect(currentLocation()).toBe(`/sign-in?next=${encodeURIComponent(URL)}`),
    );
    expect(authClientMock.signOut).toHaveBeenCalled();
  });

  it("rejects a link without an id", async () => {
    open("/app/accept-invitation");
    expect((await screen.findByRole("alert")).textContent).toMatch(/incomplete/);
  });
});
