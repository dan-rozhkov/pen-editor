// Workflows: the store behind the /workflow surface, the agent's workflow_* tools
// and the chat composer's "attach workflow" picker. A workflow is a titled,
// ordered list of text steps (no branching yet); as a prompt it is a markdown
// numbered list (workflowMarkdown.ts).
//
// Same storage model as docs/docStore.ts: localStorage is the synchronous working
// copy. In the desktop shell, desktopWorkflowMirror.ts installs a persistence sink
// (`setWorkflowPersistence`) that mirrors every local write to disk and feeds disk
// workflows back in through `importWorkflow` at startup; without a sink (the web)
// nothing leaves this browser. The agent panel (/agent) and a desktop workflow
// tab (/workflow) share one origin and one storage partition, so the panel's
// tools write here and the tab hears the change through BroadcastChannel (and
// the `storage` event as a backup). Every sync decision compares `rev`.
//
// Every localStorage access is wrapped (localStoreKit.ts).

import { createPersistenceSlot, createTombstoneStore, readJson, writeJson } from "@/lib/localStoreKit";

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

/** Receives every successful write made by THIS page (never changes from other pages or from `importWorkflow`). */
export interface WorkflowPersistence {
  save(workflow: Workflow): void;
  remove(id: string): void;
}

const persistence = createPersistenceSlot<Workflow>("workflowStore");

/** Installs (or with null removes) the sink that mirrors local writes elsewhere, e.g. to disk. */
export function setWorkflowPersistence(sink: WorkflowPersistence | null): void {
  persistence.set(sink);
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

const tombstones = createTombstoneStore("pen.workflows.deleted");

/** Deleted ids as `{ [id]: { rev, at } }`. Keeps a stale disk copy from bringing a deleted workflow back. */
export const readTombstones = tombstones.read;

export const clearTombstone = tombstones.clear;

/** Drops tombstones older than `maxAgeMs`; returns how many went. */
export const pruneTombstones = tombstones.prune;

/**
 * `persist: false` is for a delete the disk already knows about (the shell removed the file
 * itself): tombstone, body, index entry and listeners behave the same, only the sink's remove is skipped.
 */
export function deleteWorkflow(id: string, source: WorkflowChangeSource, options: { persist?: boolean } = {}): void {
  // Only where a persistence sink exists: a web page has no second copy to guard against.
  const before = persistence.active() ? getWorkflow(id) : null;
  if (before) tombstones.record(id, before.rev);
  try {
    localStorage.removeItem(WORKFLOW_KEY_PREFIX + id);
  } catch {
    // Storage blocked: nothing was stored either.
  }
  writeJson(INDEX_KEY, readIndex().filter((meta) => meta.id !== id));
  notify({ id, deleted: true, source });
  if (options.persist !== false) persistence.run((sink) => sink.remove(id));
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
  persistence.run((sink) => sink.save(workflow));
}

/**
 * Writes a workflow that came from outside (the desktop disk store), keeping its `rev` and
 * `updatedAt`. Only when the local body is missing, unreadable or has a lower rev, and the id
 * carries no delete tombstone of the same or a higher rev; returns whether it wrote. Never calls
 * the persistence sink. Listeners hear it with no `source`.
 */
export function importWorkflow(workflow: Workflow): boolean {
  const tombstone = tombstones.read()[workflow.id];
  if (tombstone !== undefined) {
    if (workflow.rev <= tombstone.rev) return false;
    tombstones.clear(workflow.id);
  }
  const key = WORKFLOW_KEY_PREFIX + workflow.id;
  const local = getWorkflow(workflow.id);
  if (local && local.rev >= workflow.rev) return false;
  let previous: string | null;
  try {
    previous = localStorage.getItem(key);
  } catch {
    return false;
  }
  if (!writeJson(key, workflow)) return false;
  const meta: WorkflowMeta = { id: workflow.id, title: workflow.title, updatedAt: workflow.updatedAt, stepCount: countFilledSteps(workflow.steps) };
  if (!writeJson(INDEX_KEY, [meta, ...readIndex().filter((m) => m.id !== workflow.id)])) {
    try {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    } catch {
      // Storage is blocked: the body write above could not have stuck either.
    }
    return false;
  }
  notify({ id: workflow.id, workflow });
  return true;
}

/**
 * Raises a local body stored without a `rev` (reads as 0) to rev 1, keeping everything else.
 * Never calls the persistence sink. Listeners hear it with no `source`. Returns whether it wrote.
 */
export function upgradeLegacyRev(id: string): boolean {
  const current = getWorkflow(id);
  if (!current || current.rev >= 1) return false;
  const next: Workflow = { ...current, rev: 1 };
  if (!writeJson(WORKFLOW_KEY_PREFIX + id, next)) return false;
  notify({ id, workflow: next });
  return true;
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
