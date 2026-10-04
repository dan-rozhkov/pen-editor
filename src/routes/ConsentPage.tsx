import { useEffect, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";

import { AuthButton, AuthShell, FormMessage } from "@/components/auth/authUi";
import { authClient } from "@/lib/auth/authClient";
import { signInPath } from "@/lib/auth/paths";
import { describeScope } from "@/lib/auth/scopes";
import { useSession } from "@/lib/auth/session";

interface ConsentResult {
  url?: string;
  redirect_uri?: string;
}

// OAuth consent screen. The oauth-provider plugin sends the browser here with
// the (signed) authorization query: client_id, scope, exp, sig, … The
// auth client's oauth-provider plugin re-attaches that query to the Allow/Deny
// POST as `oauth_query`, and the server answers with where to send the browser
// next (back to the agent's redirect_uri).
export default function ConsentPage() {
  const session = useSession();
  const location = useLocation();
  const [params] = useSearchParams();
  const clientId = params.get("client_id");
  const scopes = (params.get("scope") ?? "").split(/\s+/).filter(Boolean);

  const [clientName, setClientName] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signedIn = Boolean(session.data?.user);
  useEffect(() => {
    if (!signedIn || !clientId) return;
    let live = true;
    void authClient.oauth2
      .publicClient({ query: { client_id: clientId } })
      .then((res) => {
        if (live) setClientName(res.data?.client_name ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [signedIn, clientId]);

  if (session.isPending) {
    return (
      <AuthShell title="Authorize access">
        <p role="status" className="text-sm text-text-muted">
          Loading…
        </p>
      </AuthShell>
    );
  }

  if (!session.data?.user) {
    // Round-trip through sign-in; `next` keeps the whole signed query intact.
    return <Navigate to={signInPath(`${location.pathname}${location.search}`)} replace />;
  }

  if (!clientId) {
    return (
      <AuthShell title="Authorize access">
        <FormMessage kind="error">This authorization request is incomplete. Start again from your agent.</FormMessage>
      </AuthShell>
    );
  }

  async function decide(accept: boolean) {
    setPending(true);
    setError(null);
    try {
      const res = await authClient.oauth2.consent({
        accept,
        ...(scopes.length > 0 ? { scope: scopes.join(" ") } : {}),
      });
      const data = res.data as ConsentResult | null;
      const target = data?.url ?? data?.redirect_uri;
      if (res.error || !target) {
        setError("Could not complete this request. Start again from your agent.");
        setPending(false);
        return;
      }
      // Keeps the busy state: the page is about to be replaced.
      window.location.assign(target);
    } catch {
      setError("Could not complete this request. Start again from your agent.");
      setPending(false);
    }
  }

  const name = clientName ?? clientId;
  return (
    <AuthShell title="Authorize access">
      <p className="mb-4 text-sm text-text-primary">
        <strong>{name}</strong> wants to access your Sideform account
        {session.data.user.email ? ` (${session.data.user.email})` : ""}.
      </p>
      {scopes.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-medium text-text-primary">It will be able to</h2>
          <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-text-muted">
            {scopes.map((scope) => (
              <li key={scope}>{describeScope(scope)}</li>
            ))}
          </ul>
        </>
      )}
      {error && <FormMessage kind="error">{error}</FormMessage>}
      <div className="mt-4 flex gap-2" aria-busy={pending}>
        <AuthButton disabled={pending} onClick={() => void decide(true)}>
          Allow
        </AuthButton>
        <AuthButton variant="secondary" disabled={pending} onClick={() => void decide(false)}>
          Deny
        </AuthButton>
      </div>
    </AuthShell>
  );
}
