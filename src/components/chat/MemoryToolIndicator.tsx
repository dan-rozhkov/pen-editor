import { BrainIcon } from "@phosphor-icons/react";

// The `memory` tool is backend-executed (see pen-editor-backend's
// self-improvement-loop spec, "UI visibility"): it always arrives with a
// state, never streams partial input the way client-executed tools do. A
// successful call is rendered as a compact, non-collapsible chip instead of
// the generic ToolCallIndicator — silent self-modification of the agent's
// memory would otherwise be invisible to the user. Thrown-error states AND
// ordinary `{ ok: false, ... }` outputs (storage failure, over_capacity, an
// ambiguous old_text, the circuit breaker — the tool never throws) fall
// through to ToolCallIndicator in MessageList (kept there, not duplicated
// here) so the user can see why the write didn't happen.
export function MemoryToolIndicator() {
  return (
    <div className="my-0.5 py-0.5 flex items-center gap-1.5 text-[13px] leading-relaxed text-text-muted">
      <BrainIcon size={14} />
      <span>Память обновлена</span>
    </div>
  );
}
