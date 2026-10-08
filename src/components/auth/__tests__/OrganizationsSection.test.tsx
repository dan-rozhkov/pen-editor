import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authClientMock, resetAuthMocks, USER } from "@/test/authMocks";

vi.mock("@/lib/auth/authClient", async () => (await import("@/test/authMocks")).authClientModule());

import { OrganizationsSection } from "../OrganizationsSection";

const ok = (data: unknown) => ({ data, error: null });
const fail = (code: string, status = 400, message = "x") => ({ data: null, error: { code, status, message } });
const ORG = { id: "o1", name: "Acme" };
const OTHER = { id: "m2", userId: "u2", role: "viewer", user: { email: "bob@example.com" } };
const full = (role: string) =>
  ok({
    members: [{ id: "m1", userId: USER.id, role, user: { email: USER.email } }, OTHER],
    invitations: [{ id: "i1", email: "eve@example.com", role: "editor", status: "pending" }],
  });
const org = authClientMock.organization;
const withExpiredInvitation = () =>
  org.getFullOrganization.mockResolvedValue(
    ok({
      members: [{ id: "m1", userId: USER.id, role: "owner", user: { email: USER.email } }],
      invitations: [{ id: "i1", email: "eve@example.com", role: "editor", status: "pending", expiresAt: "2020-01-01T00:00:00Z" }],
    }),
  );
const open = () => render(<OrganizationsSection userId={USER.id} />);

beforeEach(() => {
  resetAuthMocks();
  org.list.mockResolvedValue(ok([ORG]));
  org.getFullOrganization.mockResolvedValue(full("owner"));
});
afterEach(cleanup);

describe("<OrganizationsSection />", () => {
  it("shows an empty state", async () => {
    org.list.mockResolvedValue(ok([]));
    open();
    expect(await screen.findByText("You do not belong to any organization.")).toBeTruthy();
  });

  it("creates an organization", async () => {
    org.list.mockResolvedValue(ok([]));
    open();
    fireEvent.change(await screen.findByLabelText("Organization name"), { target: { value: "Design team" } });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));
    await waitFor(() => expect(org.create).toHaveBeenCalled());
    expect(org.create.mock.calls[0][0]).toMatchObject({ name: "Design team", slug: expect.stringMatching(/^design-team-/) });
    await waitFor(() => expect(org.list).toHaveBeenCalledTimes(2));
  });

  it("explains the 5-organization limit", async () => {
    org.list.mockResolvedValue(ok([])); // listing is not what blocks here: the server does
    org.create.mockResolvedValue(fail("YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS", 403));
    open();
    fireEvent.change(await screen.findByLabelText("Organization name"), { target: { value: "Sixth" } });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/limit of 5 organizations/);
  });

  it("disables creating at the limit", async () => {
    org.list.mockResolvedValue(ok([1, 2, 3, 4, 5].map((n) => ({ id: `o${n}`, name: `Org ${n}` }))));
    open();
    expect(await screen.findByText(/reached the limit of 5 organizations/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "More" } });
    expect((screen.getByRole("button", { name: "Create organization" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets an owner invite, change a role and remove a member", async () => {
    open();
    expect(await screen.findByText("bob@example.com")).toBeTruthy();
    expect(screen.getByText(/eve@example.com/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Invite by email"), { target: { value: "dan@example.com" } });
    fireEvent.change(screen.getByLabelText("Role for the invitation"), { target: { value: "editor" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() =>
      expect(org.inviteMember).toHaveBeenCalledWith({ email: "dan@example.com", role: "editor", organizationId: "o1" }),
    );

    fireEvent.change(screen.getByLabelText("Role for bob@example.com"), { target: { value: "editor" } });
    expect(org.updateMemberRole).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm role editor for bob@example.com" }));
    await waitFor(() =>
      expect(org.updateMemberRole).toHaveBeenCalledWith({ memberId: "m2", role: "editor", organizationId: "o1" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove bob@example.com" }));
    expect(org.removeMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove bob@example.com" }));
    await waitFor(() =>
      expect(org.removeMember).toHaveBeenCalledWith({ memberIdOrEmail: "m2", organizationId: "o1" }),
    );
  });

  it("rolls a failed role change back", async () => {
    org.updateMemberRole.mockResolvedValue(fail("YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER", 403));
    open();
    await screen.findByText("bob@example.com");
    fireEvent.change(screen.getByLabelText("Role for bob@example.com"), { target: { value: "owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm role owner for bob@example.com" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Only owners can change roles/);
    expect((screen.getByLabelText("Role for bob@example.com") as HTMLSelectElement).value).toBe("viewer");
  });

  it("marks expired invitations and resends them", async () => {
    withExpiredInvitation();
    open();
    expect(await screen.findByText(/Expired/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resend invitation to eve@example.com" }));
    await waitFor(() =>
      expect(org.inviteMember).toHaveBeenCalledWith({ email: "eve@example.com", role: "editor", organizationId: "o1" }),
    );
  });

  it("retries once on a slug collision", async () => {
    org.list.mockResolvedValue(ok([]));
    org.create
      .mockResolvedValueOnce(fail("ORGANIZATION_ALREADY_EXISTS"))
      .mockResolvedValueOnce(ok({}));
    open();
    fireEvent.change(await screen.findByLabelText("Organization name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));
    await waitFor(() => expect(org.create).toHaveBeenCalledTimes(2));
    expect(org.create.mock.calls[0][0].slug).not.toBe(org.create.mock.calls[1][0].slug);
  });

  it("shows an error with Retry and no actions when the first load fails", async () => {
    org.getFullOrganization.mockResolvedValue(fail("X", 500));
    open();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Leave organization" })).toBeNull();
    expect(screen.queryByLabelText("Invite by email")).toBeNull();
  });

  it("resend cancels the expired invitation first", async () => {
    withExpiredInvitation();
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Resend invitation to eve@example.com" }));
    await waitFor(() => expect(org.inviteMember).toHaveBeenCalled());
    expect(org.cancelInvitation).toHaveBeenCalledWith({ invitationId: "i1" });
  });

  it("allows one confirm at a time and resets the select", async () => {
    open();
    await screen.findByText("bob@example.com");
    fireEvent.change(screen.getByLabelText("Role for bob@example.com"), { target: { value: "owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove bob@example.com" }));
    expect((screen.getByLabelText("Role for bob@example.com") as HTMLSelectElement).value).toBe("viewer");
    expect(screen.queryByRole("button", { name: /Confirm role/ })).toBeNull();
  });

  it("keeps the list and offers Retry when reloading fails", async () => {
    open();
    await screen.findByText("bob@example.com");
    org.getFullOrganization.mockResolvedValue(fail("X", 500));
    fireEvent.click(screen.getByRole("button", { name: "Remove bob@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove bob@example.com" }));
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByText("bob@example.com")).toBeTruthy();
  });

  it("gives a non-owner no management controls but lets them leave", async () => {
    org.getFullOrganization.mockResolvedValue(full("viewer"));
    open();
    expect(await screen.findByText("bob@example.com")).toBeTruthy();
    expect(screen.queryByLabelText("Invite by email")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete organization" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
    await waitFor(() => expect(org.leave).toHaveBeenCalledWith({ organizationId: "o1" }));
  });

  it("shows the purge-libraries message when delete is refused", async () => {
    org.delete.mockResolvedValue(
      fail("", 409, "Purge or move the organization's design-system libraries first"),
    );
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Delete organization" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Purge or move them first/);
  });

  it("explains the only-owner leave refusal", async () => {
    org.leave.mockResolvedValue(fail("YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER", 400));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Leave organization" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/only owner/);
  });
});
