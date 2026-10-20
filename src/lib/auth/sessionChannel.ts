import { getGlobalBroadcastChannel } from "better-auth/client";
import { toast } from "sonner";

import { apiFetch } from "@/lib/apiBase";

import { authClient } from "./authClient";
import { desktopAuth } from "./desktopAuth";

/** Makes this view's Better Auth session atom refetch (no reload): notifying `$sessionSignal` runs fetchSession. */
export function refetchSession(): void {
  authClient.$store.notify("$sessionSignal");
}

/**
 * Better Auth's own cross-view sync: its client listens for `storage` events on `better-auth.message`
 * and refetches the session. Posting a "session" message there reaches every OTHER same-origin view.
 */
export function announceSessionChange(): void {
  getGlobalBroadcastChannel().post({ event: "session", data: { trigger: "getSession" }, clientId: Math.random().toString(36).slice(2) });
}

export async function exchangeDesktopToken(payload: { token: string; verifier: string }): Promise<string | null> {
  const res = await apiFetch("/api/account/desktop-exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: payload.token, verifier: payload.verifier }),
  });
  if (!res.ok) throw new Error(`desktop-exchange failed (${res.status})`);
  const body = (await res.json().catch(() => null)) as { user?: { email?: unknown } } | null;
  return typeof body?.user?.email === "string" ? body.user.email : null;
}

/** In the desktop shell this view receives the browser sign-in token, exchanges it for a session cookie and tells the other views. */
export function startSessionBridge(): () => void {
  return (
    desktopAuth()?.onToken((payload) => {
      exchangeDesktopToken(payload).then(
        (email) => {
          refetchSession();
          announceSessionChange();
          if (email) toast.success(`Signed in as ${email}`);
        },
        (error) => {
          console.warn("[auth] desktop sign-in failed", error);
          toast.error("Sign-in failed. Try again from the menu.");
        },
      );
    }) ?? (() => undefined)
  );
}
