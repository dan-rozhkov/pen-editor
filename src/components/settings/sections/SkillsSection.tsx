import { SkillsManager } from "@/components/chat/SkillsManager";
import { useIdentityKey } from "@/lib/auth/useIdentityKey";

import { SettingsSection } from "../SettingsSection";

/**
 * Waits until the identity is known (so the first skills fetch carries the
 * right credentials) and remounts the manager when it changes, dropping any
 * open form of the previous identity. SessionSync already refreshes the store
 * on a change, so the remount adds no second fetch (a settled store no-ops).
 */
export function SkillsSection() {
  const identity = useIdentityKey();
  return (
    <SettingsSection title="Skills">
      <div className="flex min-h-96 flex-col pt-3">
        {identity === null ? (
          <p role="status" className="py-5 text-sm text-text-muted">
            Loading…
          </p>
        ) : (
          <SkillsManager key={identity} mode="embedded" />
        )}
      </div>
    </SettingsSection>
  );
}
