import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { resolveApiUrl } from "@/lib/apiBase";

// Better Auth lives on the backend at <backend base>/api/auth. The base is the
// same one every other backend call uses (apiBase.ts); when it is empty
// (same-origin / dev proxy) fall back to the page origin, which the client
// needs as an absolute URL.
export const AUTH_BASE_PATH = "/api/auth";

export function resolveAuthBaseUrl(): string {
  return resolveApiUrl("") || window.location.origin;
}

export const authClient = createAuthClient({
  baseURL: resolveAuthBaseUrl(),
  basePath: AUTH_BASE_PATH,
  // This client is only loaded once /api/auth-config said accounts are on, so
  // it always sends the session cookie (unlike apiFetch, which waits for that).
  fetchOptions: { credentials: "include" },
  plugins: [magicLinkClient(), apiKeyClient(), oauthProviderClient()],
});

export type AuthClient = typeof authClient;
