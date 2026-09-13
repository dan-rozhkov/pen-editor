/**
 * Progressive ("brush by brush") application of `batch_design` while its
 * script is still streaming in. See "2. `batch_design` — progressive real
 * application" in
 * docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md.
 *
 * The executor already runs every batch against a working copy
 * (`ExecutionContext`) and commits it with one `setState` at the end. This
 * module keeps that working copy alive ACROSS deltas of a single streaming
 * tool call, applying whichever statements are already syntactically
 * complete, and hands the still-live context back to
 * `batchDesign/index.ts` when the call finishes so the final commit only
 * has to execute the (usually short, sometimes empty) remainder.
 *
 * Nothing here ever writes to undo history — `saveHistory` is only called
 * once, by the final handler, using `baseSnapshot` captured here. That is
 * what keeps an entire progressively-typed batch behind a single undo step.
 */

import { useSceneStore } from "@/store/sceneStore";
import type { SceneState } from "@/store/sceneStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import {
  collectDocumentComponents,
  buildDocumentComponentTagMap,
} from "@/lib/documentComponents";
import type { FlatSceneNode, HistorySnapshot } from "@/types/scene";
import { isStreamingMutationsEnabled } from "@/lib/streamingTools/types";
import {
  removeNodeAndDescendants,
  removeOrphanedConnectors,
} from "@/store/sceneStore/helpers/flatStoreHelpers";
import { createCachedOperationsParser, MAX_OPERATIONS, type CachedOperationsParser } from "./parser";
import { executeOperation } from "./executor";
import type { ExecutionContext } from "./types";

/** Same synthetic binding name executeOperation uses for the document root. */
const DOCUMENT_BINDING = "__document__";

/**
 * The four scene fields a `batch_design` commit ever touches. Used both to
 * remember "what we last wrote" (`lastCommitted`, for the foreign-mutation
 * identity guard) and — via `HistorySnapshot`, which is a superset of these
 * plus variables/guides/styles/etc — as the pre-batch undo snapshot.
 */
interface CommittedSceneFields {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
}

export interface ProgressiveBatchSession {
  /** The live working copy, mutated in place by executeOperation across frames. */
  ctx: ExecutionContext;
  /** Raw text of every statement applied so far, in order — the prefix identity check. */
  appliedRaw: string[];
  /**
   * Full-document snapshot taken before the first statement was applied.
   * `null` until then. This is exactly what a non-streaming call would have
   * captured as `originalSnapshot`, so the final handler can pass it
   * straight to `saveHistory` and get one undo entry for the whole batch,
   * streamed part included.
   */
  baseSnapshot: HistorySnapshot | null;
  /**
   * The four fields written by our own last `setState`, used to detect a
   * foreign mutation: if the live store no longer holds THESE OBJECTS for
   * every one of `nodesById`/`parentById`/`childrenById`/`rootIds`, someone
   * else (undo/redo, another tool call, a manual edit — including a plain
   * `moveNode`/`reorderNode` drag, which touches only the latter three
   * fields and never `nodesById`) replaced at least one of them between our
   * frames, and we must stop assuming we own the whole document.
   */
  lastCommitted: CommittedSceneFields | null;
  /**
   * True once a foreign mutation was observed: we forked a fresh context
   * from the live state and now only re-apply our own statements on top of
   * it. Rolling back is no longer safe FOREVER after this — it would
   * destroy the foreign edit — so from here on only forward progress or a
   * targeted cleanup (deleting the ids WE created) is allowed. Tracked
   * separately from `degraded` (rather than as another value of one shared
   * "status" field) because the two are independent: a session can detach
   * and LATER also degrade (e.g. a decode divergence discovered after the
   * fork), and degrading must never erase the fact that it detached first —
   * `rollbackIfSafe`'s only defense against restoring `baseSnapshot` over a
   * foreign edit is this flag staying true forever once set.
   */
  detached: boolean;
  /**
   * True once the streamed prefix stopped matching what we already applied
   * (a decode divergence) or a statement threw. The session is inert:
   * further frames are ignored until the final handler takes it.
   */
  degraded: boolean;
}

const sessions = new Map<string, ProgressiveBatchSession>();

/**
 * Keys that have been finalized (taken by the final handler, abandoned, or
 * cleared). A late streaming frame arriving after finalization — the AI SDK
 * can still flush a trailing input-streaming delta after the final
 * tool-input-available part — must never resurrect a session the rest of
 * the app has already moved on from. This set only grows, but keys are
 * `${sessionId}:${toolCallId}` and a toolCallId is never reused, so it
 * cannot leak meaningfully within a session's lifetime.
 */
const finalizedKeys = new Set<string>();

/**
 * One `CachedOperationsParser` per streaming key (finding 4). Kept outside
 * `ProgressiveBatchSession` — rather than as a field on it — because it must
 * exist and accumulate its cache from the very first frame, before a session
 * object is created at all (session creation is gated on "is there anything
 * new to apply", see below), and it must keep living across a fork (foreign-
 * mutation detach replaces the session object but not what's already been
 * PARSED — parsing is independent of which scene state statements execute
 * against). Cleaned up alongside `finalizedKeys`/`sessions` wherever a key is
 * finalized, so it never outlives the stream it belongs to.
 */
const cachedParsers = new Map<string, CachedOperationsParser>();

function getCachedParser(key: string): CachedOperationsParser {
  let parser = cachedParsers.get(key);
  if (!parser) {
    parser = createCachedOperationsParser();
    cachedParsers.set(key, parser);
  }
  return parser;
}

function sessionKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

/**
 * Clone a `childrenById` record so every per-parent ARRAY is a fresh copy,
 * not just the top-level record. `executeOperation` mutates these arrays in
 * place (I()/C() `.push()`, M()'s `.splice()`), which is fine as long as the
 * arrays genuinely belong only to the working copy doing the mutating — but
 * a plain `{ ...childrenById }` only copies the key→array pairs, leaving
 * every array itself the SAME object as whatever it was copied from. Without
 * this, `ctx.childrenById` built from live state shares array identities
 * with the live store (and, via `createSnapshot`, with `baseSnapshot`),
 * because `HistorySnapshot`'s own construction (`buildHistorySnapshot`) does
 * exactly the same shallow `{ ...childrenById }`. Mutating `ctx.childrenById`
 * would then retroactively mutate `baseSnapshot.childrenById` too — the
 * rollback-corrupts-the-snapshot bug this exists to prevent.
 */
export function cloneChildrenById(childrenById: Record<string, string[]>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const key of Object.keys(childrenById)) {
    result[key] = [...childrenById[key]];
  }
  return result;
}

function buildContextFromLive(live: SceneState): ExecutionContext {
  const docComponents = collectDocumentComponents(live.nodesById, undefined, live.childrenById);
  return {
    bindings: new Map([["document", DOCUMENT_BINDING]]),
    nodesById: { ...live.nodesById },
    parentById: { ...live.parentById },
    childrenById: cloneChildrenById(live.childrenById),
    rootIds: [...live.rootIds],
    createdNodeIds: [],
    issues: [],
    componentTagMap: buildDocumentComponentTagMap(docComponents),
    removedIdsForMeasurementCleanup: new Set(),
    imageUrlRepairCount: 0,
  };
}

/**
 * Fork a fresh working copy off the CURRENT live state, carrying forward
 * only what is genuinely "ours": the bindings the script has defined so
 * far, the ids we created, and anything already queued for cleanup. Used
 * exactly once per session, at the moment a foreign mutation is detected —
 * see the "detached" status above.
 */
function forkContextFromLive(live: SceneState, prev: ExecutionContext): ExecutionContext {
  const docComponents = collectDocumentComponents(live.nodesById, undefined, live.childrenById);
  return {
    bindings: new Map(prev.bindings),
    nodesById: { ...live.nodesById },
    parentById: { ...live.parentById },
    childrenById: cloneChildrenById(live.childrenById),
    rootIds: [...live.rootIds],
    createdNodeIds: [...prev.createdNodeIds],
    issues: [...prev.issues],
    componentTagMap: buildDocumentComponentTagMap(docComponents),
    removedIdsForMeasurementCleanup: new Set(prev.removedIdsForMeasurementCleanup),
    imageUrlRepairCount: prev.imageUrlRepairCount,
  };
}

/**
 * `live.nodesById`/`parentById`/`childrenById`/`rootIds` every match exactly
 * what this session last wrote — i.e. nothing (undo/redo, another tool call,
 * a manual edit, a plain `moveNode`/`reorderNode` drag) has touched the scene
 * since. Checked against ALL FOUR fields, not just `nodesById`: a layers-panel
 * drag mutates only `parentById`/`childrenById`/`rootIds` (see
 * `basicMutations.ts`'s `moveNode`/`reorderNode`), so a `nodesById`-only
 * check would miss it entirely and the next progressive commit — or a
 * rollback — would silently discard that structural change.
 */
function liveMatchesCommitted(live: SceneState, committed: CommittedSceneFields): boolean {
  return (
    live.nodesById === committed.nodesById &&
    live.parentById === committed.parentById &&
    live.childrenById === committed.childrenById &&
    live.rootIds === committed.rootIds
  );
}

/**
 * (Finding 1) True iff `session` should still be treated as attached AT
 * FINALIZE TIME — i.e. it is safe for the final handler
 * (`batchDesign/index.ts`) to keep mutating `session.ctx` directly and
 * commit it straight over the live store. The mid-stream guard inside
 * `applyStreamingBatchDesignImpl` only re-runs `liveMatchesCommitted` when a
 * NEW frame carries newly-complete statements — it sits right after the
 * "nothing new complete yet" early return — so a foreign write landing in
 * the window between the LAST streamed delta and the final handler actually
 * running (which waits behind `runToolCall`'s serial queue) is never caught
 * there. Without this second check, `finalizeAndRespond` would write
 * `ctx`'s four fields straight over that foreign write and report success.
 * This is the one other place a foreign mutation can be discovered: right
 * before the final commit would otherwise silently clobber it.
 */
export function isSessionAttachedToLive(session: ProgressiveBatchSession): boolean {
  if (session.detached) return false;
  // A session with no `lastCommitted` yet never progressively wrote
  // anything to the store (every successful statement sets it in the same
  // pass that creates the session — see `applyStreamingBatchDesignImpl`), so
  // there is nothing live to have been clobbered and nothing to protect.
  if (!session.lastCommitted) return true;
  return liveMatchesCommitted(useSceneStore.getState(), session.lastCommitted);
}

/**
 * (Finding 2) True iff every node this session created is still present in
 * the live store. `forkContextFromLive` (the mid-stream detach fork) carries
 * `createdNodeIds` forward unconditionally, on the assumption that whatever
 * foreign edit triggered the fork only ADDED to the document. An undo
 * mid-stream breaks that assumption outright — it can remove nodes this
 * session created before the fork ever ran — and a forked context whose
 * bindings still point at now-vanished ids can't be trusted to continue
 * from: executing only the script's "remainder" on top of it would silently
 * produce a result that doesn't match the canvas (and hand the model a
 * binding for a node that no longer exists). The final handler uses this to
 * decide whether the fork is still trustworthy at all, or must be abandoned
 * in favor of running the whole script fresh from the live state (see
 * `runFreshFromLive` in `batchDesign/index.ts`).
 */
export function sessionCreatedNodesStillLive(session: ProgressiveBatchSession): boolean {
  const live = useSceneStore.getState();
  return session.ctx.createdNodeIds.every((id) => Boolean(live.nodesById[id]));
}

/**
 * Commit `ctx`'s current state to the store — as FRESH top-level copies of
 * the four fields, never `ctx`'s own container objects. `ctx.nodesById` (etc)
 * is the SAME object across every frame of a session: `executeOperation`
 * mutates it in place (`ctx.nodesById[id] = ...`, `.push()`, `.splice()`)
 * rather than reassigning it. Writing that object straight into the store —
 * as this used to — means the store's field identity never changes from
 * frame 2 onward (the object committed to the store IS the object every
 * later frame keeps mutating), so any zustand selector that re-renders only
 * on reference change (EmbedLayer, LayersPanel, ComponentsPanel,
 * SlidesPanel, PropertiesPanel, CommentLayer) stops updating after the first
 * frame — including at the FINAL commit, since `index.ts`'s finalize path
 * also used to write `ctx`'s own objects. A fresh top-level copy here gives
 * the store a genuinely new reference every single commit, while `ctx`
 * itself keeps being the one working copy every frame builds on.
 */
function commitContext(ctx: ExecutionContext): CommittedSceneFields {
  const committed: CommittedSceneFields = {
    nodesById: { ...ctx.nodesById },
    parentById: { ...ctx.parentById },
    childrenById: { ...ctx.childrenById },
    rootIds: [...ctx.rootIds],
  };
  useSceneStore.setState({ ...committed, _cachedTree: null });
  return committed;
}

/**
 * Roll the store back to `session.baseSnapshot` — ONLY when that is still
 * safe: the session must be "attached" (never forked off a foreign edit,
 * which a blind restore would erase) and the live store must still hold
 * exactly the object references we last wrote (otherwise something else
 * has already moved the ground out from under us and overwriting it would
 * lose THAT change instead). Returns whether a rollback actually happened,
 * so callers that could otherwise leave half-applied state know whether
 * they still need the "delete createdNodeIds" fallback instead.
 */
function rollbackIfSafe(session: ProgressiveBatchSession): boolean {
  if (session.detached) return false;
  if (!session.lastCommitted || !session.baseSnapshot) return false;
  const live = useSceneStore.getState();
  if (!liveMatchesCommitted(live, session.lastCommitted)) return false;
  const { nodesById, parentById, childrenById, rootIds } = session.baseSnapshot;
  useSceneStore.setState({ nodesById, parentById, childrenById, rootIds, _cachedTree: null });
  return true;
}

/**
 * Mark a session inert after a divergence or a thrown statement, rolling
 * back first if that's still safe. `degraded` is set unconditionally and
 * independently of `detached` — NEVER by assigning a shared "status" field,
 * which would silently overwrite `detached: true` with a degraded marker and
 * make `rollbackIfSafe`'s guard pass again, restoring `baseSnapshot` over a
 * foreign edit it was specifically set to protect (see the class doc on
 * `detached`).
 */
function degradeAndRollback(session: ProgressiveBatchSession): void {
  rollbackIfSafe(session);
  session.degraded = true;
}

/**
 * Apply as much of a streaming `batch_design` script as is already
 * syntactically complete. Called once per input delta; cheap, idempotent
 * (no-ops once nothing new is complete), and — per the `StreamingToolAdapter`
 * contract — must never throw, so the whole body runs under a catch-all: a
 * malformed frame degrades this one session instead of breaking the chat
 * streaming loop for everything else.
 */
export function applyStreamingBatchDesign(params: {
  sessionId: string;
  toolCallId: string;
  operations: unknown;
}): void {
  try {
    applyStreamingBatchDesignImpl(params);
  } catch {
    const key = sessionKey(params.sessionId, params.toolCallId);
    const session = sessions.get(key);
    if (session) {
      // Best-effort: if the session was still attached, put the scene back
      // the way we found it rather than leave a half-applied frame behind.
      try {
        degradeAndRollback(session);
      } catch {
        session.degraded = true;
      }
    }
  }
}

function applyStreamingBatchDesignImpl(params: {
  sessionId: string;
  toolCallId: string;
  operations: unknown;
}): void {
  if (!isStreamingMutationsEnabled()) return;
  if (typeof params.operations !== "string" || !params.operations.trim()) return;

  const key = sessionKey(params.sessionId, params.toolCallId);
  if (finalizedKeys.has(key)) return;

  let session = sessions.get(key);
  if (session?.degraded) return;

  // (Finding 4) Reuse this key's cached parser rather than re-running
  // `parseLine`/JSON5 over every already-complete statement on every frame —
  // see `createCachedOperationsParser`'s doc comment for why that redundant
  // work is the actual quadratic cost, not the plain character scan.
  const parsedFull = getCachedParser(key).parse(params.operations);
  const parsed =
    parsedFull.length > MAX_OPERATIONS ? parsedFull.slice(0, MAX_OPERATIONS) : parsedFull;

  const appliedCount = session?.appliedRaw.length ?? 0;
  if (parsed.length <= appliedCount) return; // nothing new complete yet

  // Verify what we already applied is still a verbatim prefix of the newly
  // parsed statements. Partial-JSON re-decoding can occasionally reshape an
  // earlier "complete" statement once more text arrives (e.g. a string that
  // looked closed turns out to have had an escaped quote) — that changes
  // the shape of state we've already committed, so we can no longer trust
  // continuing to build on it.
  if (session) {
    for (let i = 0; i < session.appliedRaw.length; i++) {
      if (parsed[i]?.raw !== session.appliedRaw[i]) {
        degradeAndRollback(session);
        return;
      }
    }
  }

  const live = useSceneStore.getState();

  if (session?.lastCommitted && !liveMatchesCommitted(live, session.lastCommitted)) {
    // Foreign mutation guard (see class doc on `detached`): someone else
    // wrote to at least one of the four scene fields between our frames —
    // checked across all four, not just `nodesById`, so a layers-panel
    // `moveNode`/`reorderNode` (which never touches `nodesById`) still trips
    // this. We can't keep mutating our now-stale copy (it would silently
    // discard their edit on our next commit), and we can't roll back either
    // (same reason) — so we fork a fresh context off the current live state
    // and keep going from there, carrying forward only what's genuinely
    // ours.
    session = {
      ctx: forkContextFromLive(live, session.ctx),
      appliedRaw: [...session.appliedRaw],
      baseSnapshot: session.baseSnapshot,
      lastCommitted: null,
      detached: true,
      degraded: false,
    };
    sessions.set(key, session);
  }

  if (!session) {
    session = {
      ctx: buildContextFromLive(live),
      appliedRaw: [],
      baseSnapshot: null,
      lastCommitted: null,
      detached: false,
      degraded: false,
    };
    sessions.set(key, session);
  }

  // Captured once, from the state as it was before this session's first
  // applied statement — exactly the `originalSnapshot` a non-streaming call
  // would take. Cheap enough (shallow clone) to take unconditionally here
  // rather than deferring to "after the first statement actually succeeds"
  // as the design doc phrases it: if every statement in this frame throws,
  // the session is discarded via degradeAndRollback and baseSnapshot is
  // never read, so an eagerly-captured snapshot changes nothing observable.
  if (session.baseSnapshot === null) {
    session.baseSnapshot = createSnapshot(live);
  }

  const newOps = parsed.slice(session.appliedRaw.length);
  for (const op of newOps) {
    try {
      executeOperation(op, session.ctx);
    } catch {
      degradeAndRollback(session);
      return;
    }
    session.appliedRaw.push(op.raw);
  }

  // One setState per frame, however many statements it contained — never
  // saveHistory. This is the entire reason streaming can't touch undo: the
  // real history entry is written exactly once, by the final handler.
  session.lastCommitted = commitContext(session.ctx);
}

/**
 * Build the working context `batchDesign/index.ts` executes a detached
 * session's remainder into at final-call time: a fresh copy of whatever the
 * live store holds RIGHT NOW (which already includes everything this
 * session progressively committed, plus any foreign edit that landed after
 * detaching), carrying forward only the bindings and created-node ids the
 * session itself is responsible for. Exported instead of folded into
 * `applyStreamingBatchDesign`'s internal fork because the final handler
 * needs it too, and — unlike the mid-stream fork — at a time of its own
 * choosing (right before executing the remainder), not in response to a
 * frame.
 */
export function buildFinalDetachedContext(session: ProgressiveBatchSession): ExecutionContext {
  return forkContextFromLive(useSceneStore.getState(), session.ctx);
}

/**
 * Remove and return the session for a finished tool call, permanently
 * finalizing the key first so a late (post-completion) streaming frame —
 * the AI SDK can flush one after the final part — can never resurrect it.
 */
export function takeProgressiveBatchSession(
  sessionId: string,
  toolCallId: string,
): ProgressiveBatchSession | undefined {
  const key = sessionKey(sessionId, toolCallId);
  finalizedKeys.add(key);
  const session = sessions.get(key);
  sessions.delete(key);
  cachedParsers.delete(key);
  return session;
}

/**
 * The call will never complete (abort, chat error, unmount). Roll back
 * whatever we can safely roll back and finalize the key.
 *
 * (Finding 1) A DETACHED session cannot be rolled back — `rollbackIfSafe`
 * always returns `false` for one, by design, since a blind restore would
 * erase whatever foreign edit caused the detach — so this must fall through
 * to `rollbackOrDeleteCreated`'s narrower recovery (surgically deleting the
 * nodes THIS session created) rather than leave them on the canvas forever
 * with no undo entry to remove them by. Concretely: the agent streams a
 * screen, the user drags a layer mid-stream (detaching the session), then
 * hits Stop — every node the stream created must not become permanent.
 */
export function abandonProgressiveBatchSession(sessionId: string, toolCallId: string): void {
  try {
    const key = sessionKey(sessionId, toolCallId);
    finalizedKeys.add(key);
    const session = sessions.get(key);
    sessions.delete(key);
    cachedParsers.delete(key);
    if (session) rollbackOrDeleteCreated(session);
  } catch {
    // Cleanup paths (unmount/abort handlers) must never throw.
  }
}

/**
 * Delete a set of top-level node ids (and their descendants) from the LIVE
 * store state, in a single commit. Used exactly once — see
 * `resolveDivergedOrDegradedSession` below — for the one case where neither
 * rolling back nor keeping the streamed writes is safe: a foreign edit
 * landed (so we can't roll back) AND the streamed prefix diverged from the
 * model's final script (so we can't trust the rest of what we applied
 * either). The nodes we created are still real, still visible in the store,
 * and about to be recreated by the normal (non-streaming) path below them —
 * leaving them in would duplicate every one of them.
 */
function deleteCreatedNodesFromLiveState(ids: readonly string[]): void {
  const present = ids.filter((id) => useSceneStore.getState().nodesById[id]);
  if (present.length === 0) return;

  const live = useSceneStore.getState();
  const nodesById = { ...live.nodesById };
  const parentById = { ...live.parentById };
  const childrenById = { ...live.childrenById };
  let rootIds = [...live.rootIds];

  const removedIds = new Set<string>();
  for (const id of present) {
    if (!nodesById[id]) continue; // already removed as a descendant of an earlier id in this loop

    const parentId = parentById[id];
    if (parentId !== null && parentId !== undefined) {
      childrenById[parentId] = (childrenById[parentId] ?? []).filter((cid) => cid !== id);
    } else {
      rootIds = rootIds.filter((rid) => rid !== id);
    }

    removedIds.add(id);
    for (const descendantId of childrenIdsDeep(id, childrenById)) {
      removedIds.add(descendantId);
    }
    removeNodeAndDescendants(id, nodesById, parentById, childrenById);
  }

  const orphanedConnectorIds = removeOrphanedConnectors(
    removedIds,
    nodesById,
    parentById,
    childrenById,
  );
  if (orphanedConnectorIds.length > 0) {
    const orphanSet = new Set(orphanedConnectorIds);
    rootIds = rootIds.filter((rid) => !orphanSet.has(rid));
  }

  useSceneStore.setState({ nodesById, parentById, childrenById, rootIds, _cachedTree: null });
}

/** Descendant ids of `id`, walking `childrenById` — mirrors executor.ts's own delete path. */
function childrenIdsDeep(id: string, childrenById: Record<string, string[]>): string[] {
  const result: string[] = [];
  const stack = [...(childrenById[id] ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    result.push(next);
    stack.push(...(childrenById[next] ?? []));
  }
  return result;
}

/** What `rollbackOrDeleteCreated` actually did, and the store fields that resulted. */
interface RecoveryResult {
  /** Whether a full rollback to `baseSnapshot` happened (vs. the narrower created-node deletion, vs. nothing). */
  fullyRestored: boolean;
  /**
   * The resulting live scene fields, when recovery changed the store at all
   * (a full rollback, or a created-node deletion) — `null` when there was
   * nothing to do (nothing rolled back and this session created nothing).
   */
  committed: CommittedSceneFields | null;
}

/**
 * Try the cheap, complete recovery first — a full rollback to
 * `baseSnapshot`, safe only while nothing foreign has touched the store
 * since our last write (and never for a `detached` session — see
 * `rollbackIfSafe`). When that is not safe (a foreign edit landed, so a
 * blind restore would erase it), fall back to surgically deleting just the
 * nodes THIS session created, leaving everything else — including the
 * foreign edit — untouched.
 *
 * `committed` is what a caller hands off to an OLDER concurrent session's
 * `lastCommitted` expectation (`clearProgressiveBatchSessions`);
 * `fullyRestored` is what a caller re-running the WHOLE script from scratch
 * needs to decide whether every statement's target is guaranteed to exist
 * exactly as it did before this batch started, or whether some of this
 * session's `U()`/`D()`/`M()` effects are still baked into the live store
 * and the re-run must tolerate a statement whose target the streamed prefix
 * already consumed (`resolveDivergedOrDegradedSession`, finding 2).
 */
function rollbackOrDeleteCreated(session: ProgressiveBatchSession): RecoveryResult {
  if (rollbackIfSafe(session)) {
    // `rollbackIfSafe` just wrote `session.baseSnapshot`'s four fields
    // straight into the store, so those ARE now the live fields by
    // reference (not merely content-equal) — safe to hand to another
    // session's `lastCommitted` expectation.
    const { nodesById, parentById, childrenById, rootIds } = session.baseSnapshot!;
    return { fullyRestored: true, committed: { nodesById, parentById, childrenById, rootIds } };
  }
  if (session.ctx.createdNodeIds.length === 0) {
    return { fullyRestored: false, committed: null };
  }
  deleteCreatedNodesFromLiveState(session.ctx.createdNodeIds);
  const live = useSceneStore.getState();
  return {
    fullyRestored: false,
    committed: {
      nodesById: live.nodesById,
      parentById: live.parentById,
      childrenById: live.childrenById,
      rootIds: live.rootIds,
    },
  };
}

/**
 * The one entry point `batchDesign/index.ts` needs for its "prefix does not
 * match, or degraded" final path (and for a parse error on the final
 * script, which is the same situation): make whatever this session already
 * wrote to the live store safe to ignore, so the normal non-streaming path
 * can run underneath it without duplicating anything.
 *
 * Returns whether a FULL rollback happened (see `RecoveryResult.fullyRestored`)
 * so the caller can decide whether the fallback re-run needs to tolerate a
 * statement whose target the streamed prefix already consumed (finding 2).
 */
export function resolveDivergedOrDegradedSession(session: ProgressiveBatchSession): boolean {
  return rollbackOrDeleteCreated(session).fullyRestored;
}

/**
 * Drop every progressive session belonging to a chat session, rolling each
 * back where safe.
 *
 * Two (or more) sessions can be attached to the SAME live document at once —
 * concurrent tool calls in one chat turn — in which case an older session's
 * `baseSnapshot` is exactly the document as the NEXT-older session left it:
 * a fresh `{ ...childrenById }`-style copy, not the literal objects that
 * session committed. So simply calling `rollbackIfSafe` oldest-first (Map
 * iteration order == creation order) doesn't compose: rolling back the
 * newest session first leaves the live store holding a spread copy of an
 * older session's `lastCommitted` fields — content-identical, but a
 * DIFFERENT object — so that older session's own identity check
 * (`liveMatchesCommitted`) fails and its rollback is skipped, stranding its
 * nodes. Rolling back newest-first while explicitly carrying the
 * just-restored field references forward as the next (older) session's
 * expected `lastCommitted` fixes this: after a successful rollback, the live
 * store's four fields are now LITERALLY `session.baseSnapshot`'s four
 * fields, so any older session waiting in this same loop can be told "this
 * is what you should now expect to still be live" and its own identity
 * check passes for real.
 *
 * (Finding 1) A DETACHED session in this loop can't use the "restored"
 * branch above (`rollbackIfSafe` never succeeds for one) but must still be
 * cleaned up via `rollbackOrDeleteCreated`'s created-node-deletion fallback,
 * or its streamed nodes are stranded permanently, with no undo entry. That
 * fallback also produces a fresh set of live scene fields (a plain spread of
 * whatever was live, not `baseSnapshot`'s), which is propagated to older
 * sessions exactly like a full restore's fields are — the reference identity
 * changed either way, and any older session's own identity check needs to
 * be told what to expect now.
 */
export function clearProgressiveBatchSessions(sessionId: string): void {
  try {
    const prefix = `${sessionId}:`;
    // Snapshot into an array (oldest-first, per Map insertion order) so we
    // can walk it newest-first without disturbing iteration.
    const entries = [...sessions].filter(([key]) => key.startsWith(prefix));

    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, session] = entries[i];
      finalizedKeys.add(key);
      sessions.delete(key);
      cachedParsers.delete(key);

      const { committed } = rollbackOrDeleteCreated(session);
      if (committed) {
        // Every older (not yet processed) session in this same loop now
        // sees exactly what's live, by reference, so its own rollback isn't
        // skipped for a false "someone else touched it" reason.
        for (let j = 0; j < i; j++) {
          const olderSession = entries[j][1];
          if (olderSession.lastCommitted) {
            olderSession.lastCommitted = committed;
          }
        }
      }
    }
  } catch {
    // Cleanup paths must never throw.
  }
}
