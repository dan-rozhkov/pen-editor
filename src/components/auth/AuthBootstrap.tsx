import { lazy, Suspense } from "react";

import { useAuthConfig } from "@/lib/auth/authConfig";

// Pulls in the auth client (and starts mirroring the session) only on
// deployments where accounts are enabled.
const SessionSync = lazy(() => import("@/lib/auth/SessionSync"));

export function AuthBootstrap() {
  const config = useAuthConfig();
  if (!config?.enabled) return null;
  return (
    <Suspense fallback={null}>
      <SessionSync />
    </Suspense>
  );
}
