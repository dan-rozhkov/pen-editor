import { useAuthConfig } from "@/lib/auth/authConfig";
import { useAuthStore } from "@/lib/auth/authState";

/**
 * Who the backend will see for the next request, or `null` while that is not
 * known yet. Per-user fetches must wait for a non-null key and re-run when it
 * changes: before /api/auth-config resolves there are no credentials, and with
 * accounts on the session is unresolved until SessionSync mirrors it (a request
 * sent earlier would go out anonymous, or with an anon id, and hit the wrong
 * identity).
 */
export function useIdentityKey(): string | null {
  const config = useAuthConfig();
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.userId);
  if (!config) return null;
  if (!config.enabled) return "anon";
  if (status === "unknown") return null;
  return status === "signed-in" && userId ? `user:${userId}` : "anon";
}
