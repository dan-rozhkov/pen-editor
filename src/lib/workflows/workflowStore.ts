// Workflows: the store behind the /workflow surface, the agent's workflow_* tools
// and the chat composer's "attach workflow" picker. A workflow is a titled,
// ordered list of text steps (no branching yet); as a prompt it is a markdown
// numbered list (workflowMarkdown.ts).
//
// Same storage model as docs/docStore.ts, without the desktop disk mirror:
// localStorage is the only copy. The agent panel (/agent) and a desktop workflow
// tab (/workflow) share one origin and one storage partition, so the panel's
// tools write here and the tab hears the change through BroadcastChannel (and
// the `storage` event as a backup). Every sync decision compares `rev`.
//
// Every localStorage access is wrapped: a private window or blocked site data
// makes getItem/setItem throw.

export interface WorkflowStep {
  /** Stable id: React keys and focus survive edits and reorders. */
  id: string;
  text: string;
}

export interface WorkflowMeta {
  id: string;
  title: string;
  updatedAt: number;
  /** Non-blank steps; written with every commit so lists need not parse bodies. */
  stepCount: number;
}

export interface Workflow extends Omit<WorkflowMeta, "stepCount"> {
  steps: WorkflowStep[];
  /** Monotonic write counter: create = 1, +1 on every successful write. */
  rev: number;
}

/** Who wrote a change: the editor UI or the agent's tools. */
export type WorkflowChangeSource = "editor" | "agent";

export interface WorkflowChange {
  id: string;
  deleted?: boolean;
  /** Absent for changes that arrive through the `storage` event. */
  source?: WorkflowChangeSource;
  /** The workflow as written (absent for deletes). */
  workflow?: Workflow;
}

const INDEX_KEY = "pen.workflows.index";
const WORKFLOW_KEY_PREFIX = "pen.workflows.wf.";
const CHANNEL_NAME = "pen.workflows";

/** The title of a workflow nobody named. */
export const DEFAULT_WORKFLOW_TITLE = "Untitled workflow";

/** Thrown by writes when localStorage is full or blocked. */
export const WORKFLOW_STORAGE_ERROR = "Workflow storage is unavailable in this browser (localStorage blocked or full).";

type Listener = (change: WorkflowChange) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readIndex(): WorkflowMeta[] {
  const index = readJson<WorkflowMeta[]>(INDEX_KEY);
  return Array.isArray(index) ? index : [];
}

/** Steps with text: the count every list, chip and tool shows (blank steps are skipped in the markdown). */
export function countFilledSteps(steps: readonly Pick<WorkflowStep, "text">[]): number {
  return steps.filter((s) => s.text.trim().length > 0).length;
}

function randomHex(length: number): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`;
  return uuid.replace(/[^0-9a-f]/gi, "").slice(0, length);
}

export function newStepId(): string {
  return `st_${randomHex(10)}`;
}

/** Builds steps with fresh ids from plain texts. */
export function stepsFromTexts(texts: readonly string[]): WorkflowStep[] {
  return texts.map((text) => ({ id: newStepId(), text }));
}

export function parseWorkflow(value: unknown): Workflow | null {
  const wf = value as Partial<Workflow> | null;
  if (!wf || typeof wf.id !== "string" || typeof wf.title !== "string" || typeof wf.updatedAt !== "number" || !Array.isArray(wf.steps)) {
    return null;
  }
  const steps: WorkflowStep[] = [];
  for (const step of wf.steps as unknown[]) {
    const s = step as Partial<WorkflowStep> | null;
    if (!s || typeof s.id !== "string" || typeof s.text !== "string") return null;
    steps.push({ id: s.id, text: s.text });
  }
  return { id: wf.id, title: wf.title, steps, updatedAt: wf.updatedAt, rev: typeof wf.rev === "number" ? wf.rev : 0 };
}

function parseWorkflowJson(raw: string): Workflow | null {
  try {
    return parseWorkflow(JSON.parse(raw));
  } catch {
    return null;
  }
}

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<WorkflowChange>) => emitLocal(event.data);
  return channel;
}

let storageListening = false;
function onStorage(event: StorageEvent): void {
  if (!event.key?.startsWith(WORKFLOW_KEY_PREFIX)) return;
  const id = event.key.slice(WORKFLOW_KEY_PREFIX.length);
  if (event.newValue === null) {
    emitLocal({ id, deleted: true });
    return;
  }
  const workflow = parseWorkflowJson(event.newValue);
  if (workflow) emitLocal({ id, workflow });
}
function listenToStorage(): void {
  if (storageListening || typeof window === "undefined") return;
  storageListening = true;
  window.addEventListener("storage", onStorage);
}

// One listener throwing must neither skip the others nor make a finished write look failed.
function emitLocal(change: WorkflowChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (e) {
      console.error("workflowStore listener failed", e);
    }
  }
}

function notify(change: WorkflowChange): void {
  emitLocal(change);
  try {
    getChannel()?.postMessage(change);
  } catch (e) {
    console.error("workflowStore broadcast failed", e);
  }
}

/** Newest first. */
export function listWorkflows(): WorkflowMeta[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** True when localStorage holds no body at all for this id (a present but unparseable body is not "missing"). */
export function isWorkflowBodyMissing(id: string): boolean {
  try {
    return localStorage.getItem(WORKFLOW_KEY_PREFIX + id) === null;
  } catch {
    return false;
  }
}

/**
 * Removes an index entry whose body is gone. Never deletes a body: when any text is stored
 * under the id (even unparseable) nothing happens. Returns true when an entry was removed.
 */
export function dropStaleWorkflowIndexEntry(id: string): boolean {
  if (!isWorkflowBodyMissing(id)) return false;
  const index = readIndex();
  if (!index.some((m) => m.id === id)) return false;
  if (!writeJson(INDEX_KEY, index.filter((m) => m.id !== id))) return false;
  notify({ id, deleted: true, source: "editor" });
  return true;
}

export function getWorkflow(id: string): Workflow | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(WORKFLOW_KEY_PREFIX + id);
  } catch {
    return null;
  }
  return raw === null ? null : parseWorkflowJson(raw);
}

export function createWorkflow(input: { title: string; steps?: WorkflowStep[] }, source: WorkflowChangeSource): Workflow {
  const workflow: Workflow = {
    id: `wf_${randomHex(12)}`,
    title: input.title.trim() || DEFAULT_WORKFLOW_TITLE,
    steps: input.steps ?? [],
    updatedAt: Date.now(),
    rev: 1,
  };
  commitWorkflow(workflow, source);
  return workflow;
}

export interface UpdateWorkflowOptions {
  /** Compare-and-set: write only when the stored rev equals this; otherwise nothing is written and "conflict" is returned. */
  expectedRev?: number;
}

/**
 * Writes the patch over the stored workflow and returns it (rev + 1). Returns null
 * when no readable workflow has this id, and "conflict" only when `expectedRev`
 * was passed and differs from the stored rev.
 */
export function updateWorkflow(
  id: string,
  patch: Partial<Pick<Workflow, "title" | "steps">>,
  source: WorkflowChangeSource,
  options?: UpdateWorkflowOptions,
): Workflow | null | "conflict" {
  const current = getWorkflow(id);
  if (!current) return null;
  if (options?.expectedRev !== undefined && current.rev !== options.expectedRev) return "conflict";
  const next: Workflow = { ...current, ...patch, updatedAt: Date.now(), rev: current.rev + 1 };
  if (patch.title !== undefined) next.title = patch.title.trim() || DEFAULT_WORKFLOW_TITLE;
  commitWorkflow(next, source);
  return next;
}

export function deleteWorkflow(id: string, source: WorkflowChangeSource): void {
  try {
    localStorage.removeItem(WORKFLOW_KEY_PREFIX + id);
  } catch {
    // Storage blocked: nothing was stored either.
  }
  writeJson(INDEX_KEY, readIndex().filter((meta) => meta.id !== id));
  notify({ id, deleted: true, source });
}

/**
 * Body first, then index; if the index write fails the body goes back to what it
 * was (or disappears on create). Listeners hear about the write only after both succeeded.
 */
function commitWorkflow(workflow: Workflow, source: WorkflowChangeSource): void {
  const key = WORKFLOW_KEY_PREFIX + workflow.id;
  let previous: string | null;
  try {
    previous = localStorage.getItem(key);
  } catch {
    throw new Error(WORKFLOW_STORAGE_ERROR);
  }
  if (!writeJson(key, workflow)) throw new Error(WORKFLOW_STORAGE_ERROR);
  const meta: WorkflowMeta = { id: workflow.id, title: workflow.title, updatedAt: workflow.updatedAt, stepCount: countFilledSteps(workflow.steps) };
  if (!writeJson(INDEX_KEY, [meta, ...readIndex().filter((m) => m.id !== workflow.id)])) {
    try {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    } catch {
      // Storage is blocked: the body write above could not have stuck either.
    }
    throw new Error(WORKFLOW_STORAGE_ERROR);
  }
  notify({ id: workflow.id, source, workflow });
}

/** Subscribes to changes from this page and from other same-origin pages. Returns the unsubscribe function. */
export function subscribeWorkflows(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  listenToStorage();
  return () => {
    listeners.delete(listener);
  };
}
