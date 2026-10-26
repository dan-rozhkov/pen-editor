import { SkillsManager } from "./SkillsManager";

interface SkillsPageProps {
  onClose: () => void;
}

/**
 * "Skills" page inside the chat panel (replaces the chat list / open-chat
 * header while shown). Reached from the chat panel's skills button and the
 * slash menu's "Manage skills". The body is shared with Settings → Skills.
 */
export function SkillsPage({ onClose }: SkillsPageProps) {
  return <SkillsManager onClose={onClose} />;
}
