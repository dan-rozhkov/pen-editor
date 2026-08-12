import { BookOpenIcon } from "@phosphor-icons/react";

export type SkillManageKind = "create" | "revive" | "patch" | "delete";

const KIND_TEXT: Record<SkillManageKind, (name: string) => string> = {
  create: (name) => `Скилл создан: ${name}`,
  revive: (name) => `Скилл восстановлен: ${name}`,
  patch: (name) => `Скилл обновлён: ${name}`,
  delete: (name) => `Скилл удалён: ${name}`,
};

interface SkillToolIndicatorProps {
  kind: SkillManageKind;
  name: string;
}

// Mirrors MemoryToolIndicator's rationale, for the phase-2 half of the same
// spec requirement (self-improvement-loop spec, "UI visibility": "silent
// self-modification is not acceptable UX", explicitly extended to skill
// creation). `skill_manage` is backend-executed and never throws (see
// pen-editor-backend's src/ai/skills/tool.ts): the curated guard, the
// read-before-write guard, name/body validation, and a concurrent delete all
// resolve as an ordinary `{ error: ... }` output, not a thrown error. Only a
// genuine `{ ok: true, message }` earns this chip; everything else falls
// through to the generic ToolCallIndicator in MessageList so the user can
// see why the write didn't happen.
export function SkillToolIndicator({ kind, name }: SkillToolIndicatorProps) {
  return (
    <div className="my-2 px-2 py-1 rounded bg-secondary/60 flex items-center gap-1.5 text-xs text-text-muted">
      <BookOpenIcon size={14} />
      <span>{KIND_TEXT[kind](name)}</span>
    </div>
  );
}
