import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";

import { AuthButton, AuthShell, FormMessage } from "@/components/auth/authUi";
import { authClient } from "@/lib/auth/authClient";
import { asOrgRole, ROLE_LABELS } from "@/lib/auth/orgAccess";
import { orgErrorMessage } from "@/lib/auth/orgErrors";
import { signInPath } from "@/lib/auth/paths";
import { signOut, useSession } from "@/lib/auth/session";

interface Invitation {
  organizationId: string;
  organizationName: string;
  inviterEmail: string;
  role: string;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; invitation: Invitation }
  | { kind: "working"; invitation: Invitation }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string; wrongEmail?: boolean };

const GENERIC = "Could not load this invitation. Try again later.";
const memoKey = (id: string) => `pen.invitation.${id}`;

// An accepted invitation is no longer "pending", so a reload cannot read it
// back. The organization id is remembered per invitation to tell "already
// accepted" from "expired".
function remember(id: string, orgId: string): void {
  try {
    sessionStorage.setItem(memoKey(id), orgId);
  } catch {
    // storage blocked: the expired message is shown instead
  }
}
function remembered(id: string): string | null {
  try {
    return sessionStorage.getItem(memoKey(id));
  } catch {
    return null;
  }
}

async function isMember(orgId: string | null): Promise<boolean> {
  if (!orgId) return false;
  try {
    const res = await authClient.organization.list();
    return ((res.data ?? []) as { id: string }[]).some((o) => o.id === orgId);
  } catch {
    return false;
  }
}

function InvitationFlow({ id, returnTo }: { id: string; returnTo: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    const set = (s: State) => live && setState(s);
    void authClient.organization
      .getInvitation({ query: { id } })
      .then(async (res) => {
        if (res.error || !res.data) {
          const code = (res.error as { code?: string } | null)?.code;
          if (code === "INVITATION_NOT_FOUND" || !code) {
            if (await isMember(remembered(id))) {
              return set({ kind: "done", message: "You are already a member of this organization." });
            }
          }
          return set({
            kind: "error",
            message: orgErrorMessage(res.error, GENERIC),
            wrongEmail: code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
          });
        }
        const invitation = res.data as unknown as Invitation;
        remember(id, invitation.organizationId);
        set({ kind: "ready", invitation });
      })
      .catch(() => set({ kind: "error", message: GENERIC }));
    return () => {
      live = false;
    };
  }, [id]);

  async function decide(invitation: Invitation, accept: boolean) {
    setState({ kind: "working", invitation });
    try {
      const res = accept
        ? await authClient.organization.acceptInvitation({ invitationId: id })
        : await authClient.organization.rejectInvitation({ invitationId: id });
      const code = (res.error as { code?: string } | null)?.code;
      if (!res.error || code === "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION") {
        setState({
          kind: "done",
          message: accept
            ? `You are now a member of ${invitation.organizationName}.`
            : "You declined the invitation.",
        });
      } else {
        setState({
          kind: "error",
          message: orgErrorMessage(res.error, "Could not complete this. Try again later."),
          wrongEmail: code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
        });
      }
    } catch {
      setState({ kind: "error", message: "Could not complete this. Try again later." });
    }
  }

  const accountLink = (
    <p className="mt-4 text-sm">
      <Link to="/account" className="text-accent-primary underline-offset-2 hover:underline">
        Go to your account
      </Link>
    </p>
  );

  switch (state.kind) {
    case "loading":
      return (
        <p role="status" className="text-sm text-text-muted">
          Loading the invitation…
        </p>
      );
    case "ready":
    case "working": {
      const inv = state.invitation;
      const busy = state.kind === "working";
      return (
        <div aria-busy={busy}>
          <p className="mb-5 text-sm text-text-primary">
            <strong>{inv.inviterEmail}</strong> invited you to join <strong>{inv.organizationName}</strong> as{" "}
            {ROLE_LABELS[asOrgRole(inv.role)].toLowerCase()}.
          </p>
          <div className="flex gap-2">
            <AuthButton disabled={busy} onClick={() => void decide(inv, true)}>
              Accept
            </AuthButton>
            <AuthButton variant="secondary" disabled={busy} onClick={() => void decide(inv, false)}>
              Decline
            </AuthButton>
          </div>
        </div>
      );
    }
    case "done":
      return (
        <>
          <FormMessage kind="notice">{state.message}</FormMessage>
          {accountLink}
        </>
      );
    case "error":
      return (
        <>
          <FormMessage kind="error">{state.message}</FormMessage>
          {state.wrongEmail && (
            <div className="mt-4">
              <AuthButton
                variant="secondary"
                onClick={() => void signOut().then(() => navigate(signInPath(returnTo), { replace: true }))}
              >
                Sign out and continue
              </AuthButton>
            </div>
          )}
          {accountLink}
        </>
      );
  }
}

// The invitation email links here (`/app/accept-invitation?id=<id>`). Nothing
// is accepted on load: the invitee sees who invited them and chooses.
export default function AcceptInvitationPage() {
  const session = useSession();
  const location = useLocation();
  const [params] = useSearchParams();
  const id = params.get("id");
  const returnTo = `${location.pathname}${location.search}`;

  if (session.isPending) {
    return (
      <AuthShell title="Invitation">
        <p role="status" className="text-sm text-text-muted">
          Loading…
        </p>
      </AuthShell>
    );
  }
  if (!session.data?.user) return <Navigate to={signInPath(returnTo)} replace />;
  return (
    <AuthShell title="Invitation">
      {id ? (
        <InvitationFlow key={id} id={id} returnTo={returnTo} />
      ) : (
        <FormMessage kind="error">This invitation link is incomplete. Open the link from your email again.</FormMessage>
      )}
    </AuthShell>
  );
}
