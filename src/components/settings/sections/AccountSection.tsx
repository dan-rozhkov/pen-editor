import { lazy, Suspense } from "react";

import { useAuthConfig } from "@/lib/auth/authConfig";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

// The auth client is only fetched once /api/auth-config says accounts are on.
const AccountSectionInner = lazy(() => import("./AccountSectionInner"));

export function AccountSection() {
  const config = useAuthConfig();
  return (
    <SettingsSection title="Account">
      {config === null ? (
        <p role="status" className="py-5 text-sm text-text-muted">
          Loading…
        </p>
      ) : !config.enabled ? (
        <SettingsGroup title="Accounts are off" description="This deployment does not offer sign-in." />
      ) : (
        <Suspense fallback={null}>
          <AccountSectionInner />
        </Suspense>
      )}
    </SettingsSection>
  );
}
