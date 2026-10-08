import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router";

import { AuthShell, FormMessage } from "@/components/auth/authUi";
import { authClient } from "@/lib/auth/authClient";
import { orgErrorMessage } from "@/lib/auth/orgErrors";
import { signInPath } from "@/lib/auth/paths";
import { useSession } from "@/lib/auth/session";

type State = { kind: "working" } | { kind: "done" } | { kind: "error"; message: string };

// The invitation email links here (`/app/accept-invitation?id=<id>`).
export default function AcceptInvitationPage() {
  const session = useSession();
  const location = useLocation();
  const [params] = useSearchParams();
  const id = params.get("id");
  const signedIn = Boolean(session.data?.user);
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    if (!signedIn || !id || started.current) return;
    started.current = true;
    void authClient.organization
      .acceptInvitation({ invitationId: id })
      .then((res) => {
        if (!res.error) return setState({ kind: "done" });
        const code = (res.error as { code?: string }).code;
        setState(
          code === "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION"
            ? { kind: "done" }
            : { kind: "error", message: orgErrorMessage(res.error, "Could not accept this invitation. Try again later.") },
        );
      })
      .catch(() => setState({ kind: "error", message: "Could not accept this invitation. Try again later." }));
  }, [signedIn, id]);

  if (session.isPending) {
    return (
      <AuthShell title="Accept invitation">
        <p role="status" className="text-sm text-text-muted">
          Loading…
        </p>
      </AuthShell>
    );
  }
  if (!signedIn) {
    return <Navigate to={signInPath(`${location.pathname}${location.search}`)} replace />;
  }
  if (!id) {
    return (
      <AuthShell title="Accept invitation">
        <FormMessage kind="error">This invitation link is incomplete. Open the link from your email again.</FormMessage>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Accept invitation">
      {state.kind === "working" && (
        <p role="status" className="text-sm text-text-muted">
          Accepting the invitation…
        </p>
      )}
      {state.kind === "done" && (
        <>
          <FormMessage kind="notice">You are now a member of the organization.</FormMessage>
          <p className="mt-4 text-sm">
            <Link to="/account" className="text-accent-primary underline-offset-2 hover:underline">
              Go to your account
            </Link>
          </p>
        </>
      )}
      {state.kind === "error" && (
        <>
          <FormMessage kind="error">{state.message}</FormMessage>
          <p className="mt-4 text-sm">
            <Link to="/account" className="text-accent-primary underline-offset-2 hover:underline">
              Go to your account
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
