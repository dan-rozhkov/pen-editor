import { useSyncExternalStore } from "react";
import { getSchedule, subscribeSchedules, type WorkflowSchedule } from "@/lib/workflows/workflowSchedule";

/** The schedule of a workflow, live: follows saves, deletes and run bookkeeping from any page. */
export function useWorkflowSchedule(workflowId: string | null): WorkflowSchedule | null {
  // getSchedule serves the same object until the stored strings change, so the snapshot is
  // referentially stable between unchanged renders and nothing is re-parsed per render.
  return useSyncExternalStore(
    subscribeSchedules,
    () => (workflowId === null ? null : getSchedule(workflowId)),
    () => null,
  );
}
