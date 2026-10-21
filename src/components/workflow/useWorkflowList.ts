import { useCallback, useEffect, useMemo, useState } from "react";
import { getWorkflow, isWorkflowBodyMissing, listWorkflows, subscribeWorkflows, type Workflow } from "@/lib/workflows/workflowStore";

export interface WorkflowListItem {
  id: string;
  title: string;
}

/** Index metadata only: no workflow body is parsed. Entries whose body key is gone are hidden. */
function readList(): WorkflowListItem[] {
  return listWorkflows().filter(({ id }) => !isWorkflowBodyMissing(id)).map(({ id, title }) => ({ id, title }));
}

// Module-level so the subscribe effect does not re-run on every render.
const ALL_CHANGES = (): boolean => true;

/** Re-renders the caller on every workflow change; the number only exists to key `useMemo` reads. */
function useWorkflowTick(relevant: (id: string) => boolean = ALL_CHANGES): number {
  const [tick, setTick] = useState(0);
  useEffect(
    () =>
      subscribeWorkflows((change) => {
        if (relevant(change.id)) setTick((t) => t + 1);
      }),
    [relevant],
  );
  return tick;
}

/** Workflows newest first, live through `subscribeWorkflows`. */
export function useWorkflowList(): WorkflowListItem[] {
  const tick = useWorkflowTick();
  return useMemo(() => (tick >= 0 ? readList() : []), [tick]);
}

/** One workflow by id, live; null for no id or a missing workflow. */
export function useWorkflowById(id: string | null): Workflow | null {
  const relevant = useCallback((changed: string) => changed === id, [id]);
  const tick = useWorkflowTick(relevant);
  return useMemo(() => (id && tick >= 0 ? getWorkflow(id) : null), [id, tick]);
}
