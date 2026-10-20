import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { AuthButton, AuthShell, FormMessage } from "@/components/auth/authUi";
import { apiFetch } from "@/lib/apiBase";
import { useAuthConfig } from "@/lib/auth/authConfig";
import { signInPath } from "@/lib/auth/paths";
import { signOut, useSession } from "@/lib/auth/session";

// The browser half of the desktop shell's sign-in: /auth/desktop?state=…&challenge=….
// Must stay free of editor/Pixi imports (it is a tiny lazy chunk).

export const PENDING_KEY = "pen.desktopAuth.pending";
const PENDING_TTL_MS = 10 * 60 * 1000;
const PARAM = /^[A-Za-z0-9_-]{43}$/;

interface Pending {
  state: string;
  challenge: string;
}

const valid = (p: Pending) => PARAM.test(p.state) && PARAM.test(p.challenge);

// Query wins and is remembered (a magic link opens in a new tab, an OAuth callback drops the query);
// without a query the remembered pair is used while it is under 10 minutes old.
function resolvePending(params: URLSearchParams): Pending | null {
  const fromQuery = { state: params.get("state") ?? "", challenge: params.get("challenge") ?? "" };
  try {
    if (valid(fromQuery)) {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ ...fromQuery, at: Date.now() }));
      return fromQuery;
    }
    const stored = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as (Pending & { at?: number }) | null;
    if (stored && typeof stored.at === "number" && Date.now() - stored.at < PENDING_TTL_MS && valid(stored)) {
      return { state: stored.state, challenge: stored.challenge };
    }
  } catch {
    // storage blocked: only the query can work
    return valid(fromQuery) ? fromQuery : null;
  }
  return null;
}

export default function DesktopAuthPage() {
  const config = useAuthConfig();
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [pending] = useState(() => resolvePending(params));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"sent" | "cancelled" | null>(null);
  const user = session.data?.user ?? null;

  // No automatic hand-off: any page could open this URL with its own challenge, so a click confirms it.
  const handOff = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/account/desktop-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: pending.challenge }),
      });
      const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
      if (res.status === 401) {
        // The cached browser session is no longer valid server-side: drop it and sign in again.
        try {
          await signOut();
        } catch {
          // best effort
        }
        navigate(signInPath(`/auth/desktop?state=${pending.state}&challenge=${pending.challenge}`), { replace: true });
        return;
      }
      if (!res.ok || typeof body?.token !== "string") {
        setError("Could not start sign-in. Try again.");
        return;
      }
      // The pending pair stays (it expires by its own TTL) so "Try again" works after a dismissed prompt.
      setOutcome("sent");
      window.location.href = `sideform://auth?token=${encodeURIComponent(body.token)}&state=${encodeURIComponent(pending.state)}`;
    } catch {
      setError("Could not reach Sideform. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [pending, navigate]);

  const enabled = config?.enabled === true;
  const settled = enabled && !session.isPending;

  useEffect(() => {
    if (!pending || !settled) return;
    if (!user) {
      navigate(signInPath(`/auth/desktop?state=${pending.state}&challenge=${pending.challenge}`), { replace: true });
    }
  }, [pending, settled, user, navigate]);

  const cancel = () => {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      // ignore
    }
    setOutcome("cancelled");
  };

  const shell = (children: ReactNode) => <AuthShell title="Sideform Desktop">{children}</AuthShell>;

  if (config === null || (enabled && session.isPending)) {
    return shell(
      <p role="status" className="text-sm text-text-muted">
        Loading…
      </p>,
    );
  }
  if (!enabled) return shell(<p className="text-sm text-text-muted">Sign-in is not available right now.</p>);
  if (outcome === "cancelled") return shell(<p className="text-sm text-text-muted">Sign-in cancelled. You can close this tab.</p>);
  if (!pending) {
    return shell(
      <p className="text-sm text-text-muted">This sign-in link is invalid or has expired. Start again from Sideform Desktop.</p>,
    );
  }
  if (!user) return shell(<p role="status" className="text-sm text-text-muted">Redirecting to sign in…</p>);

  if (outcome === "sent") {
    return shell(
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">Return to Sideform Desktop. You can close this tab.</p>
        {error && <FormMessage kind="error">{error}</FormMessage>}
        <AuthButton variant="secondary" disabled={busy} onClick={() => void handOff()}>
          Try again
        </AuthButton>
      </div>,
    );
  }

  return shell(
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-primary">
        Sign in to Sideform Desktop as <span className="font-medium">{user.email}</span>?
      </p>
      <p className="text-xs text-text-muted">Continue only if you started sign-in from Sideform Desktop just now.</p>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      <AuthButton disabled={busy} onClick={() => void handOff()}>
        Sign in to Sideform Desktop
      </AuthButton>
      <AuthButton variant="secondary" disabled={busy} onClick={cancel}>
        Cancel
      </AuthButton>
    </div>,
  );
}
