import { useEffect, useState } from "react";

import { apiFetch, setCredentialsEnabled } from "@/lib/apiBase";
import { useAuthStore } from "@/lib/auth/authState";

// Mirrors GET /api/auth-config on the backend.
export interface AuthConfig {
  enabled: boolean;
  google: boolean;
  emailEnabled: boolean;
}

export const AUTH_DISABLED: AuthConfig = {
  enabled: false,
  google: false,
  emailEnabled: false,
};

let cached: Promise<AuthConfig> | null = null;

// Fetched once per page load, WITHOUT credentials (the flag is still off). ANY failure (offline, 404 on an older backend,
// bad JSON) resolves to "disabled": the UI then renders no sign-in surface at
// all and the app behaves exactly as it did before accounts existed.
export function loadAuthConfig(): Promise<AuthConfig> {
  cached ??= (async () => {
    try {
      const res = await apiFetch("/api/auth-config");
      if (!res.ok) return AUTH_DISABLED;
      const body = (await res.json()) as Partial<AuthConfig> | null;
      if (!body || body.enabled !== true) return AUTH_DISABLED;
      // From here on every backend call carries the session cookie.
      setCredentialsEnabled(true);
      useAuthStore.setState({ accountsEnabled: true });
      return {
        enabled: true,
        google: body.google === true,
        emailEnabled: body.emailEnabled === true,
      };
    } catch {
      return AUTH_DISABLED;
    }
  })();
  return cached;
}

/** Tests only. */
export function resetAuthConfigCache(): void {
  cached = null;
  setCredentialsEnabled(false);
  useAuthStore.setState({ accountsEnabled: false });
}

/** `null` while loading, then the (cached) config. */
export function useAuthConfig(): AuthConfig | null {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  useEffect(() => {
    let live = true;
    void loadAuthConfig().then((c) => {
      if (live) setConfig(c);
    });
    return () => {
      live = false;
    };
  }, []);
  return config;
}
