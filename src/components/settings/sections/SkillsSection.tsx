import { useState } from "react";

import { SKILLS_INTRO, SkillsManager } from "@/components/chat/SkillsManager";
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
  // The manager portals its Add menu here, at the right of the section title.
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  return (
    <SettingsSection
      title="Skills"
      description={SKILLS_INTRO}
      action={<div ref={setActionSlot} className="flex shrink-0 items-center" />}
    >
      <div className="flex min-h-96 flex-col">
        {identity === null ? (
          <p role="status" className="py-5 text-sm text-text-muted">
            Loading…
          </p>
        ) : (
          <SkillsManager key={identity} mode="embedded" actionSlot={actionSlot} />
        )}
      </div>
    </SettingsSection>
  );
}
