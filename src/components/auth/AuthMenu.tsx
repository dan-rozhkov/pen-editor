import { lazy, Suspense } from "react";

import { useAuthConfig } from "@/lib/auth/authConfig";

// The auth client is only fetched once /api/auth-config says accounts are on.
const AuthMenuInner = lazy(() => import("./AuthMenuInner"));

export type AuthMenuVariant = "toolbar" | "showcase";

// "Sign in" button / avatar menu for the editor toolbar and the showcase
// header. Renders nothing while the config loads, when accounts are off, or
// when the config request failed — the app then looks exactly as before.
export function AuthMenu({ variant }: { variant: AuthMenuVariant }) {
  const config = useAuthConfig();
  if (!config?.enabled) return null;
  return (
    <Suspense fallback={null}>
      <AuthMenuInner variant={variant} />
    </Suspense>
  );
}
