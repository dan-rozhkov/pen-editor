import { cleanup, screen, waitFor } from "@testing-library/react";
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

  it("accepts the invitation once", async () => {
    open();
    expect(await screen.findByText("You are now a member of the organization.")).toBeTruthy();
    expect(authClientMock.organization.acceptInvitation).toHaveBeenCalledTimes(1);
    expect(authClientMock.organization.acceptInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
  });

  it("explains an expired invitation", async () => {
    authClientMock.organization.acceptInvitation.mockResolvedValue({
      data: null,
      error: { code: "INVITATION_NOT_FOUND", message: "Invitation not found", status: 400 },
    });
    open();
    expect((await screen.findByRole("alert")).textContent).toMatch(/expired or was cancelled/);
  });

  it("explains a wrong-email invitation", async () => {
    authClientMock.organization.acceptInvitation.mockResolvedValue({
      data: null,
      error: { code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION", status: 403 },
    });
    open();
    expect((await screen.findByRole("alert")).textContent).toMatch(/different email address/);
  });

  it("treats already a member as success", async () => {
    authClientMock.organization.acceptInvitation.mockResolvedValue({
      data: null,
      error: { code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION", status: 400 },
    });
    open();
    expect(await screen.findByText("You are now a member of the organization.")).toBeTruthy();
  });

  it("rejects a link without an id", async () => {
    open("/app/accept-invitation");
    expect((await screen.findByRole("alert")).textContent).toMatch(/incomplete/);
  });
});
