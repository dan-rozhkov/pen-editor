import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth/authClient";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  credential: "Email and password",
};

/** Provider ids linked to the signed-in account; null while loading. */
export function useLinkedProviders(enabled: boolean): string[] | null {
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

export function formatProviders(providers: string[] | null): string {
  if (providers === null) return "loading…";
  if (providers.length === 0) return "none";
  return providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ");
}
