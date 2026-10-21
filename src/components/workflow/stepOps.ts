import type { WorkflowStep } from "@/lib/workflows/workflowStore";

/** Inserts `step` at `index` (clamped). */
export function insertStepAt(steps: readonly WorkflowStep[], index: number, step: WorkflowStep): WorkflowStep[] {
  const at = Math.max(0, Math.min(index, steps.length));
  return [...steps.slice(0, at), step, ...steps.slice(at)];
}

/** Moves the step at `index` by `delta` positions; the same array when it cannot move. */
export function moveStep(steps: readonly WorkflowStep[], index: number, delta: number): readonly WorkflowStep[] {
  const to = index + delta;
  if (index < 0 || index >= steps.length || to < 0 || to >= steps.length || delta === 0) return steps;
  const next = [...steps];
  const [step] = next.splice(index, 1);
  next.splice(to, 0, step);
  return next;
}

export function removeStep(steps: readonly WorkflowStep[], index: number): WorkflowStep[] {
  return steps.filter((_, i) => i !== index);
}
