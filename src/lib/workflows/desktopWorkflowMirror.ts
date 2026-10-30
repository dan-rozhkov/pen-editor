// Desktop shell only: mirrors the workflows (workflowStore, localStorage) to disk
// through the shell's IPC bridge and reconciles both copies at startup.
// localStorage stays the synchronous working copy; disk is the durable one.
// On the web there is no bridge and every function here is a no-op.
// The mechanics live in desktopMirrorCore.ts (shared with the document mirror).

import type { DesktopWorkflowsDiskApi } from "@/lib/desktopBridge";
import { createMirror, type DiskBridgeOf } from "@/lib/desktopMirrorCore";
import {
  deleteWorkflow,
  getWorkflow,
  importWorkflow,
  listWorkflows,
  parseWorkflow,
  pruneTombstones,
  readTombstones,
  setWorkflowPersistence,
  upgradeLegacyRev,
  type Workflow,
} from "@/lib/workflows/workflowStore";

type DiskBridge = Required<DesktopWorkflowsDiskApi>;

function isComplete(workflows: DesktopWorkflowsDiskApi | undefined): workflows is DiskBridge {
  return !!workflows && typeof workflows.list === "function" && typeof workflows.save === "function" && typeof workflows.remove === "function";
}

/** The shell's disk store: the agent panel's first, then the desktop tab's. Undefined on the web or on an older shell. */
export function getDesktopWorkflowsBridge(): DiskBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const panel = window.penAgentPanel?.workflows;
  if (isComplete(panel)) return panel;
  const tab = window.penDesktop?.workflows;
  return isComplete(tab) ? tab : undefined;
}

const mirror = createMirror<Workflow>({
  name: "desktopWorkflowMirror",
  noun: "workflow",
  listKey: "workflows",
  getBridge: () => getDesktopWorkflowsBridge() as DiskBridgeOf<Workflow> | undefined,
  parse: parseWorkflow,
  ids: () => listWorkflows().map((meta) => meta.id),
  get: getWorkflow,
  import: importWorkflow,
  delete: (id) => deleteWorkflow(id, "editor", { persist: false }),
  upgradeLegacyRev,
  setPersistence: setWorkflowPersistence,
  tombstones: { read: readTombstones, prune: pruneTombstones },
});

/** True when the startup reconcile is over or the mirror was never started on this page. */
export const isDesktopWorkflowsReady = mirror.isReady;

/** Resolves after the startup reconcile finished or failed; at once when this page has no mirror. Never rejects. */
export const whenDesktopWorkflowsReady = mirror.whenReady;

/** Starts the disk mirror once per page. Resolves when the startup reconcile is done; never rejects. */
export const startDesktopWorkflowMirror = mirror.start;

/** Test seam: forgets the started mirror and removes its sink. */
export const resetDesktopWorkflowMirrorForTests = mirror.resetForTests;
