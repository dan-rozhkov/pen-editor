import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { ApiKeysSection } from "@/components/auth/ApiKeysSection";
import { AuthButton, AuthShell } from "@/components/auth/authUi";
import { ConnectedAgentsSection } from "@/components/auth/ConnectedAgentsSection";
import { OrganizationsSection } from "@/components/auth/OrganizationsSection";
import { authClient } from "@/lib/auth/authClient";
import { signInPath } from "@/lib/auth/paths";
import { signOut, useSession } from "@/lib/auth/session";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  credential: "Email and password",
};

function useLinkedProviders(enabled: boolean): string[] | null {
  const [providers, setProviders] = useState<string[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void authClient
      .listAccounts()
      .then((res) => {
        if (live) setProviders((res.data ?? []).map((a) => a.providerId));
      })
      .catch(() => {
        if (live) setProviders([]);
      });
    return () => {
      live = false;
    };
  }, [enabled]);
  return providers;
}

export default function AccountPage() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const user = session.data?.user;
  const providers = useLinkedProviders(Boolean(user));

  if (session.isPending) {
    return (
      <AuthShell title="Account" wide>
        <p role="status" className="text-sm text-text-muted">
          Loading…
        </p>
      </AuthShell>
    );
  }
  if (!user) {
    return <Navigate to={signInPath(`${location.pathname}${location.search}`)} replace />;
  }

  return (
    <AuthShell title="Account" wide>
      <div className="flex flex-col gap-8">
        <section aria-labelledby="profile-heading" className="flex flex-col gap-2">
          <h2 id="profile-heading" className="text-base font-semibold text-text-primary">
            Profile
          </h2>
          <p className="text-sm text-text-primary">{user.email}</p>
          <p className="text-sm text-text-muted">
            Sign-in methods:{" "}
            {providers === null
              ? "loading…"
              : providers.length === 0
                ? "none"
                : providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ")}
          </p>
        </section>
        <OrganizationsSection userId={user.id} />
        <ApiKeysSection />
        <ConnectedAgentsSection />
        <div className="flex flex-wrap gap-2">
          <AuthButton variant="secondary" onClick={() => navigate("/app")}>
            Open the editor
          </AuthButton>
          <AuthButton
            variant="secondary"
            onClick={() => void signOut().then(() => navigate("/", { replace: true }))}
          >
            Sign out
          </AuthButton>
        </div>
      </div>
    </AuthShell>
  );
}
