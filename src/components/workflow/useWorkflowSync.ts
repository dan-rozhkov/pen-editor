import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  DEFAULT_WORKFLOW_TITLE,
  createWorkflow,
  deleteWorkflow,
  dropStaleWorkflowIndexEntry,
  getWorkflow,
  listWorkflows,
  newStepId,
  subscribeWorkflows,
  updateWorkflow,
  type Workflow,
  type WorkflowMeta,
  type WorkflowStep,
} from "@/lib/workflows/workflowStore";
import { isDesktopWorkflowsReady, whenDesktopWorkflowsReady } from "@/lib/workflows/desktopWorkflowMirror";

const SAVE_DELAY_MS = 300;
/** Longest an edit may stay unsaved while the user keeps typing. */
const SAVE_MAX_WAIT_MS = 1000;

const CONFLICT_MESSAGE = "The agent changed this workflow. Your last edits were replaced.";
const STORAGE_FAILURE_MESSAGE = "Could not save the workflow: browser storage is full or blocked.";
const UNREADABLE_MESSAGE = "A stored workflow could not be read and was skipped.";
const DELETED_MESSAGE = "This workflow was deleted.";

/** Ids whose unreadable body was already reported (module-level: survives remounts). */
const reportedCorrupt = new Set<string>();

interface Local {
  id: string | null;
  title: string;
  steps: readonly WorkflowStep[];
}

/** Edits not yet written. */
interface Pending {
  id: string;
  title?: string;
  steps?: readonly WorkflowStep[];
}

function localOf(workflow: Workflow | null, id: string | null): Local {
  return { id, title: workflow?.title ?? "", steps: workflow?.steps ?? [] };
}

export interface WorkflowSync {
  workflows: WorkflowMeta[];
  /** True until the desktop disk mirror's startup reconcile ends (never on the web): no selection yet, creating is off. */
  loading: boolean;
  /** Selected workflow id, or null when none exist. */
  id: string | null;
  title: string;
  steps: readonly WorkflowStep[];
  select: (id: string) => void;
  create: () => void;
  remove: () => void;
  setTitle: (title: string) => void;
  /** Replaces the steps with the updater's result (the same array means no change). */
  setSteps: (update: (steps: readonly WorkflowStep[]) => readonly WorkflowStep[]) => void;
}

/**
 * State of the open workflow on /workflow: selection via `?id=`, debounced
 * compare-and-set autosave, and adoption of writes by the agent or another tab.
 * Much simpler than useDocSync: the whole workflow is small and an agent write
 * always wins over a conflicting local edit.
 */
export function useWorkflowSync(): WorkflowSync {
  const [params, setParams] = useSearchParams();
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>(() => listWorkflows());
  const paramId = params.get("id");
  // Desktop: disk workflows may still be on their way in. Until the startup reconcile ends,
  // re-read the list when it does so a workflow that only exists on disk shows up.
  const [mirrorReady, setMirrorReady] = useState(isDesktopWorkflowsReady);
  useEffect(() => {
    if (mirrorReady) return;
    let live = true;
    void whenDesktopWorkflowsReady().then(() => {
      if (!live) return;
      setMirrorReady(true);
      setWorkflows(listWorkflows());
    });
    return () => {
      live = false;
    };
  }, [mirrorReady]);
  const wantsNew = params.get("new") === "1";
  // First candidate (the URL's, then newest first) with a readable body; the others are reported in `bad`.
  const { id, bad } = useMemo(() => {
    // Nothing is picked (and no index entry judged) until the startup reconcile ends.
    if (!mirrorReady) return { id: null, bad: [] as string[] };
    const candidates = [...(paramId ? [paramId] : []), ...workflows.map((w) => w.id)];
    const unreadable: string[] = [];
    for (const candidate of new Set(candidates)) {
      if (getWorkflow(candidate)) return { id: candidate, bad: unreadable };
      // An id typed into the URL that was never stored is not an index problem.
      if (candidate !== paramId || workflows.some((w) => w.id === candidate)) unreadable.push(candidate);
    }
    return { id: null, bad: unreadable };
  }, [paramId, workflows, mirrorReady]);

  // Index entries without a body are dropped; a body that exists but cannot be parsed is left
  // alone (never written) and reported once.
  useEffect(() => {
    for (const badId of bad) {
      if (dropStaleWorkflowIndexEntry(badId)) continue;
      if (!reportedCorrupt.has(badId)) {
        reportedCorrupt.add(badId);
        toast.error(UNREADABLE_MESSAGE);
      }
    }
  }, [bad]);

  const [local, setLocal] = useState<Local>(() => localOf(id ? getWorkflow(id) : null, id));
  const localRef = useRef(local);
  const idRef = useRef(id);
  // The stored rev this page last adopted or saved: the compare-and-set base.
  const baseRevRef = useRef(id ? (getWorkflow(id)?.rev ?? 0) : 0);
  const pendingRef = useRef<Pending | null>(null);
  const savingRef = useRef(false);
  const storageFailing = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSaveTimers = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxTimer.current) clearTimeout(maxTimer.current);
    saveTimer.current = maxTimer.current = null;
  }, []);

  const show = useCallback((next: Local) => {
    localRef.current = next;
    setLocal(next);
  }, []);

  /** Takes a stored version as the new base and drops any pending edit. */
  const adopt = useCallback(
    (workflow: Workflow) => {
      pendingRef.current = null;
      clearSaveTimers();
      baseRevRef.current = workflow.rev;
      show(localOf(workflow, workflow.id));
    },
    [clearSaveTimers, show],
  );

  /** Writes the pending edit. Returns false only when storage rejected it (the edit stays pending). */
  const save = useCallback((): boolean => {
    clearSaveTimers();
    const p = pendingRef.current;
    if (!p) return true;
    if (p.id !== idRef.current) {
      pendingRef.current = null;
      return true;
    }
    let result: ReturnType<typeof updateWorkflow>;
    savingRef.current = true;
    try {
      const patch = { ...(p.title !== undefined ? { title: p.title } : {}), ...(p.steps !== undefined ? { steps: [...p.steps] } : {}) };
      result = updateWorkflow(p.id, patch, "editor", { expectedRev: baseRevRef.current });
    } catch {
      if (!storageFailing.current) {
        storageFailing.current = true;
        toast.error(STORAGE_FAILURE_MESSAGE);
      }
      return false;
    } finally {
      savingRef.current = false;
    }
    storageFailing.current = false;
    if (result === null) {
      pendingRef.current = null;
      toast(DELETED_MESSAGE);
      return true;
    }
    if (result === "conflict") {
      const stored = getWorkflow(p.id);
      if (stored) {
        adopt(stored);
        toast(CONFLICT_MESSAGE);
      } else {
        pendingRef.current = null;
      }
      return true;
    }
    baseRevRef.current = result.rev;
    if (pendingRef.current === p) pendingRef.current = null;
    return true;
  }, [adopt, clearSaveTimers]);

  // Debounce restarts on every edit; the max wait bounds the unsaved window.
  const schedule = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, SAVE_DELAY_MS);
    if (!maxTimer.current) maxTimer.current = setTimeout(save, SAVE_MAX_WAIT_MS);
  }, [save]);

  // Loads a new selection into state. Pending edits never survive a switch.
  useEffect(() => {
    if (idRef.current === id) return;
    if (!save()) pendingRef.current = null;
    idRef.current = id;
    const workflow = id ? getWorkflow(id) : null;
    baseRevRef.current = workflow?.rev ?? 0;
    show(localOf(workflow, id));
  }, [id, save, show]);

  const createAndSelect = useCallback(() => {
    // A workflow made before the reconcile ends would race the disk copy of the same list.
    if (!mirrorReady) return;
    save();
    let workflow: Workflow;
    try {
      workflow = createWorkflow({ title: DEFAULT_WORKFLOW_TITLE, steps: [{ id: newStepId(), text: "" }] }, "editor");
    } catch {
      toast.error(STORAGE_FAILURE_MESSAGE);
      return;
    }
    setWorkflows(listWorkflows());
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("new");
        next.set("id", workflow.id);
        return next;
      },
      { replace: true },
    );
  }, [mirrorReady, save, setParams]);

  // "/workflow?new=1": create exactly one workflow (StrictMode runs effects twice).
  const newHandled = useRef(false);
  useEffect(() => {
    if (wantsNew && mirrorReady && !newHandled.current) {
      newHandled.current = true;
      createAndSelect();
    } else if (!wantsNew) {
      newHandled.current = false;
    }
  }, [wantsNew, mirrorReady, createAndSelect]);

  // Keep the URL pointing at the resolved workflow (no id, or a stale one).
  useEffect(() => {
    if (id && paramId !== id && !wantsNew) {
      const next = new URLSearchParams(params);
      next.set("id", id);
      setParams(next, { replace: true });
    }
  }, [id, paramId, wantsNew, params, setParams]);

  useEffect(() => {
    const unsubscribe = subscribeWorkflows((change) => {
      setWorkflows(listWorkflows());
      if (change.id !== idRef.current || savingRef.current) return;
      if (change.deleted) {
        // The selection effect resolves the fallback; pending writes to a dead workflow are dropped.
        pendingRef.current = null;
        clearSaveTimers();
        setParams(
          (p) => {
            const next = new URLSearchParams(p);
            next.delete("id");
            return next;
          },
          { replace: true },
        );
        return;
      }
      const workflow = change.workflow ?? getWorkflow(change.id);
      // At or below our base: a duplicate, a stale copy or our own save.
      if (!workflow || workflow.rev <= baseRevRef.current) return;
      // A pending local edit is resolved by the compare-and-set at save time.
      if (pendingRef.current?.id === workflow.id) return;
      adopt(workflow);
    });
    return () => {
      unsubscribe();
      save();
    };
  }, [adopt, clearSaveTimers, save, setParams]);

  // Cmd+W / reload / tab hidden: do not lose the last debounce window.
  useEffect(() => {
    const onHide = () => save();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [save]);

  const select = useCallback(
    (next: string) => {
      save();
      const p = new URLSearchParams(params);
      p.set("id", next);
      setParams(p, { replace: true });
    },
    [save, params, setParams],
  );

  const remove = useCallback(() => {
    const current = idRef.current;
    if (!current) return;
    pendingRef.current = null;
    clearSaveTimers();
    deleteWorkflow(current, "editor");
  }, [clearSaveTimers]);

  const edit = useCallback(
    (patch: { title?: string; steps?: readonly WorkflowStep[] }) => {
      const current = idRef.current;
      if (!current) return;
      show({ ...localRef.current, ...patch });
      pendingRef.current = { ...(pendingRef.current?.id === current ? pendingRef.current : { id: current }), ...patch };
      schedule();
    },
    [schedule, show],
  );

  const setTitle = useCallback((title: string) => edit({ title }), [edit]);
  const setSteps = useCallback(
    (update: (steps: readonly WorkflowStep[]) => readonly WorkflowStep[]) => {
      const next = update(localRef.current.steps);
      if (next !== localRef.current.steps) edit({ steps: next });
    },
    [edit],
  );

  useEffect(() => {
    const title = local.title.trim() || "Workflow";
    document.title = title;
    window.penDesktop?.setDocumentTitle?.(title);
  }, [local.title]);

  return { workflows, loading: !mirrorReady, id, title: local.title, steps: local.steps, select, create: createAndSelect, remove, setTitle, setSteps };
}
