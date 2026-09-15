import { useSceneStore } from "@/store/sceneStore";
import type { SceneState } from "@/store/sceneStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { createSnapshot, saveHistory } from "@/store/sceneStore/helpers/history";
import type { HistorySnapshot } from "@/types/scene";
import type { ToolHandler } from "../../toolRegistry";
import type { ExecutionContext, ParsedOperation } from "./types";
import { parseOperations, MAX_OPERATIONS } from "./parser";
import { executeOperation, serializeCreatedNodes } from "./executor";
import {
  takeProgressiveBatchSession,
  resolveDivergedOrDegradedSession,
  buildFinalDetachedContext,
  isSessionAttachedToLive,
  sessionCreatedNodesStillLive,
  cloneChildrenById,
  type ProgressiveBatchSession,
} from "./progressive";

/** `${op.binding}=OP(...) [line N]`, the completedOperations format every error path uses. */
function formatCompletedOps(ops: ParsedOperation[]): string[] {
  return ops.map((op) => `${op.binding ? op.binding + "=" : ""}${op.op}(...) [line ${op.line}]`);
}

/**
 * True for exactly the "Node not found" family of `executeOperation` errors
 * (`U()`/`R()`/`M()`/`D()`/`G()` all throw this shape when their target id
 * doesn't resolve) — as opposed to `I()`'s "Parent node not found" or `C()`'s
 * "Source node not found", which mean something else entirely (a genuinely
 * missing/malformed reference, not "this target was already consumed").
 * Used only by `runFreshFromLive`'s `lenient` mode (finding 2): a plain
 * message-shape check rather than a typed error class because
 * `executeOperation` throws plain `Error`s everywhere and giving this one
 * failure mode its own class would be a bigger change than the bug warrants.
 */
function isNodeNotFoundError(err: unknown): boolean {
  return err instanceof Error && /Node not found:/.test(err.message);
}

/**
 * `session.appliedRaw` (what streaming already applied) must still be an
 * exact, in-order prefix of the FINAL, fully-parsed script for the
 * progressively-built context to be trusted at all. A mismatch means the
 * partial-JSON decode that fed the streaming path reshaped an earlier
 * statement once more text arrived (rare, but the whole reason this check
 * exists rather than trusting the stream unconditionally).
 */
function isVerbatimPrefix(appliedRaw: readonly string[], executable: ParsedOperation[]): boolean {
  if (appliedRaw.length > executable.length) return false;
  for (let i = 0; i < appliedRaw.length; i++) {
    if (executable[i].raw !== appliedRaw[i]) return false;
  }
  return true;
}

/**
 * Steps 4-6 of the non-streaming design (propagate component changes, save
 * history once, commit, clean up pinned measurements, build the response).
 * Shared by all three success paths — no-session, attached, detached — so
 * the response shape can never drift between them.
 */
function finalizeAndRespond(params: {
  ctx: ExecutionContext;
  historySnapshot: HistorySnapshot;
  operationsExecuted: number;
  truncated: boolean;
  operationsSubmitted: number;
  remaining: ParsedOperation[];
}): string {
  const { ctx, historySnapshot, operationsExecuted, truncated, operationsSubmitted, remaining } =
    params;

  // Save history first (one undo entry for the entire batch, streamed part
  // included — `historySnapshot` is the state from before the FIRST
  // statement of the whole call, not just this final delta).
  saveHistory(historySnapshot);

  useSceneStore.setState({
    nodesById: ctx.nodesById,
    parentById: ctx.parentById,
    childrenById: ctx.childrenById,
    rootIds: ctx.rootIds,
    _cachedTree: null,
  });

  if (ctx.removedIdsForMeasurementCleanup.size > 0) {
    useMeasurementsStore
      .getState()
      .removeMeasurementsForNodes([...ctx.removedIdsForMeasurementCleanup]);
  }

  const createdNodes = serializeCreatedNodes(ctx);

  const response: Record<string, unknown> = {
    success: true,
    operationsExecuted,
    createdNodes,
  };

  if (ctx.issues.length > 0) {
    response.issues = [...new Set(ctx.issues)];
  }

  if (ctx.imageUrlRepairCount > 0) {
    response.imageUrlRepair = `repaired ${ctx.imageUrlRepairCount} mistyped image url(s)`;
  }

  if (truncated) {
    response.truncated = true;
    response.operationsSubmitted = operationsSubmitted;

    const bindings: Record<string, string> = {};
    for (const [name, id] of ctx.bindings) {
      if (name === "document") continue;
      bindings[name] = id;
    }
    response.bindings = bindings;

    const REMAINING_OPS_CHAR_BUDGET = 8000;
    const remainingRaw = remaining.map((op) => op.raw);
    let budget = 0;
    let cutoff = remainingRaw.length;
    for (let i = 0; i < remainingRaw.length; i++) {
      budget += remainingRaw[i].length;
      if (budget > REMAINING_OPS_CHAR_BUDGET) {
        cutoff = i;
        break;
      }
    }
    if (cutoff === 0) {
      cutoff = 1;
    }
    response.remainingOperations = remainingRaw.slice(0, cutoff);
    const remainingListTruncated = cutoff < remainingRaw.length;
    if (remainingListTruncated) {
      response.remainingOperationsTruncated = true;
    }

    if (remainingListTruncated) {
      response.note =
        `Executed the first ${MAX_OPERATIONS} of ${operationsSubmitted} submitted operations. ` +
        `${remainingRaw.length} operations remain unexecuted; "remainingOperations" below lists only the first ${cutoff} ` +
        `of those ${remainingRaw.length} (it was cut short to stay under the response size budget) — it is NOT the full remainder. ` +
        `Send the "remainingOperations" listed here verbatim in your next batch_design call, then continue with the rest of the ` +
        `unexecuted operations from your own script (the ones after these) in subsequent calls, in order — ` +
        `do not repeat the operations already executed, or you will create duplicate nodes. ` +
        `Replace any binding references with the real node ids in "bindings".`;
    } else {
      response.note =
        `Executed the first ${MAX_OPERATIONS} of ${operationsSubmitted} submitted operations. ` +
        `"remainingOperations" below lists all operations that were NOT executed, verbatim. ` +
        `Send ONLY those remaining operations in your next batch_design call — ` +
        `do not repeat the operations already executed, or you will create duplicate nodes. ` +
        `Replace any binding references from this call with the real node ids in "bindings".`;
    }
  }

  return JSON.stringify(response);
}

/**
 * Execute the not-yet-streamed remainder of a progressive session's script
 * against `ctx`, then finalize exactly like the never-streamed path. Shared by
 * the ATTACHED and DETACHED cases below: both build `ctx`/`historySnapshot`
 * differently, but from there the remainder-execution and rollback-on-error
 * shape is identical, including WHAT gets rolled back — never `ctx` itself
 * (either it's the live session's, which `resolveDivergedOrDegradedSession`
 * cleans up, or a fork that was never committed anywhere), only the
 * session's own bookkeeping.
 */
function runRemainderAndFinalize(
  session: ProgressiveBatchSession,
  ctx: ExecutionContext,
  historySnapshot: HistorySnapshot,
  executable: ParsedOperation[],
  remaining: ParsedOperation[],
  truncated: boolean,
  operationsSubmitted: number,
): string {
  const remainderOps = executable.slice(session.appliedRaw.length);

  let succeeded = 0;
  try {
    for (const op of remainderOps) {
      executeOperation(op, ctx);
      succeeded++;
    }
  } catch (err) {
    resolveDivergedOrDegradedSession(session);
    return JSON.stringify({
      error: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
      completedOperations: formatCompletedOps(
        executable.slice(0, session.appliedRaw.length + succeeded),
      ),
      totalOperations: executable.length,
      ...(truncated ? { truncated: true, operationsSubmitted } : {}),
    });
  }

  return finalizeAndRespond({
    ctx,
    historySnapshot,
    operationsExecuted: executable.length,
    truncated,
    operationsSubmitted,
    remaining,
  });
}

/**
 * Finish an ATTACHED progressive session: nothing foreign has touched the
 * scene since our last progressive write, so we keep mutating the exact
 * same working copy the streaming frames built, execute only the ops that
 * weren't complete/streamed yet, and save history once from the snapshot
 * captured before the very first streamed statement — one undo entry for
 * the whole call, streamed part included.
 */
function finishAttachedSession(
  session: ProgressiveBatchSession,
  executable: ParsedOperation[],
  remaining: ParsedOperation[],
  truncated: boolean,
  operationsSubmitted: number,
): string {
  // session.baseSnapshot is always set once a session exists: it is
  // written the moment the first statement is applied, which is also the
  // moment the session itself is created (see progressive.ts).
  return runRemainderAndFinalize(
    session,
    session.ctx,
    session.baseSnapshot!,
    executable,
    remaining,
    truncated,
    operationsSubmitted,
  );
}

/**
 * Finish a DETACHED progressive session: a foreign edit landed on the
 * scene while this session was streaming, so we no longer trust
 * `session.ctx` as "the whole document" — instead fork a brand-new working
 * copy off whatever the live store holds right now (which already includes
 * everything this session progressively committed, plus the foreign edit),
 * carrying forward only bindings/createdNodeIds, and execute the remainder
 * on top of THAT. History is saved from a snapshot taken at this same
 * moment, not from the session's original `baseSnapshot` — restoring
 * `baseSnapshot` here would discard the foreign edit, which is worse.
 *
 * Honest limitation (finding 3 — NOT "two undo steps" as an earlier version
 * of this comment claimed): `historySnapshot` is taken from `live`, and
 * `live` already contains everything this session streamed, because the
 * streamed prefix was committed to the store before the foreign edit ever
 * landed. So `saveHistory(historySnapshot)` below folds the streamed prefix
 * into the SAME undo entry as the foreign edit, not a separate one — the
 * first Ctrl+Z reverts this call's own remainder (the ops after the detach
 * point), and the second reverts the foreign edit *and* the streamed prefix
 * together, as one entry. The streamed prefix is never separately undoable
 * once a foreign edit interleaves with it. A cleaner split isn't possible
 * with this store: the foreign edit was applied ON TOP OF the streamed
 * prefix, so recovering just the prefix out of that combined state would
 * need per-node (or per-field) history — each node keeping its own undo
 * timeline — and `historyStore` doesn't have that; it only ever snapshots
 * and restores the whole document.
 */
function finishDetachedSession(
  session: ProgressiveBatchSession,
  executable: ParsedOperation[],
  remaining: ParsedOperation[],
  truncated: boolean,
  operationsSubmitted: number,
): string {
  // Finding 2: a destructive foreign edit (most commonly an undo mid-stream)
  // can remove nodes THIS session created before it detached. The fork
  // carries `createdNodeIds` forward unconditionally (see
  // `forkContextFromLive`), so if any of them are gone, `session.ctx`'s
  // bindings point at ids that no longer exist — executing only the
  // "remainder" of the script on top of that fork would silently produce a
  // result that doesn't match the canvas. There's no coherent way to
  // continue in that case: degrade to running the WHOLE script fresh
  // against the live state, exactly as if there had been no progressive
  // session at all.
  if (!sessionCreatedNodesStillLive(session)) {
    // Clean up whatever THIS session already committed to the live store
    // first (same helper the "prefix diverged / degraded" path below uses) —
    // rollback isn't safe for a detached session, so this surgically deletes
    // just the nodes we created. Without it, `runFreshFromLive` would create
    // a second copy of every node this session's earlier progressive commits
    // already put on the canvas.
    resolveDivergedOrDegradedSession(session);
    // A detached session can never get the full-`baseSnapshot` rollback
    // (see `resolveDivergedOrDegradedSession`'s return value) — only the
    // narrower created-node deletion above — so any `U()`/`D()`/`M()` this
    // session already streamed is still baked into the live store. `lenient`
    // is unconditionally required here (third-review finding 2): the full
    // re-run below is guaranteed to re-encounter those same statements.
    return runFreshFromLive(executable, remaining, truncated, operationsSubmitted, {
      lenient: true,
    });
  }

  const live = useSceneStore.getState();
  const ctx = buildFinalDetachedContext(session);
  const historySnapshot = createSnapshot(live);

  return runRemainderAndFinalize(
    session,
    ctx,
    historySnapshot,
    executable,
    remaining,
    truncated,
    operationsSubmitted,
  );
}

/**
 * Build a fresh `ExecutionContext` from whatever the live store holds RIGHT
 * NOW and execute the FULL `executable` list against it from scratch, then
 * finalize exactly like the always-existed never-streamed path. Used for
 * three situations that all boil down to "nothing about the current live
 * state can be trusted to already reflect any part of `executable`": a
 * buffering model / MCP / WebMCP caller / kill-switch-off request that never
 * had a progressive session at all; a detached session whose created nodes
 * didn't survive a foreign edit; and a detached session whose streamed
 * prefix diverged from the final script (see `lenient` below).
 *
 * `lenient`, when true, tolerates a statement whose target no longer exists
 * (finding 2): when a streamed prefix already applied `U()`/`D()`/`M()`
 * statements against the live store and rolling that back would also erase
 * a foreign edit (so `resolveDivergedOrDegradedSession` could only run its
 * narrower "delete created nodes" recovery, not a full `baseSnapshot`
 * restore), re-running the WHOLE script from scratch here hits those same
 * statements again — e.g. `D("x")` a second time, after the streamed prefix
 * already deleted `"x"`. Without `lenient`, `executeOperation` throws "Node
 * not found" and the entire batch comes back as an execution error, even
 * though the canvas already reflects exactly what that statement asked for.
 * A statement skipped this way is recorded in `ctx.issues` (surfaced to the
 * model as `response.issues`) so the JSON still describes what happened.
 * Only ever passed when the caller already knows a full rollback did NOT
 * happen — see `resolveDivergedOrDegradedSession`'s return value and
 * `finishDetachedSession`'s unconditional `true` (a detached session, by
 * definition, never gets the full-rollback recovery).
 */
function runFreshFromLive(
  executable: ParsedOperation[],
  remaining: ParsedOperation[],
  truncated: boolean,
  operationsSubmitted: number,
  options?: { lenient?: boolean },
): string {
  const state: SceneState = useSceneStore.getState();
  const originalSnapshot = createSnapshot(state);

  const ctx: ExecutionContext = {
    bindings: new Map([["document", "__document__"]]),
    nodesById: { ...state.nodesById },
    parentById: { ...state.parentById },
    // Finding 3: a shallow `{ ...childrenById }` only copies the top-level
    // record — every per-parent ARRAY would stay the SAME object as the
    // live store's (and, via `originalSnapshot` above, as the undo
    // snapshot's). `executeOperation` mutates those arrays in place
    // (`.push()`/`.splice()`), which would then retroactively corrupt the
    // undo snapshot this function just took. `cloneChildrenById` (shared
    // with progressive.ts, not copy-pasted) clones every array too.
    childrenById: cloneChildrenById(state.childrenById),
    rootIds: [...state.rootIds],
    createdNodeIds: [],
    issues: [],
    removedIdsForMeasurementCleanup: new Set(),
    imageUrlRepairCount: 0,
  };

  const completedOps: string[] = [];
  let executedCount = 0;
  try {
    for (const op of executable) {
      try {
        executeOperation(op, ctx);
      } catch (err) {
        if (options?.lenient && isNodeNotFoundError(err)) {
          // (Finding 2) This statement's target was already consumed by a
          // streamed prefix we could not cleanly roll back (a foreign edit
          // made a full restore unsafe) — the canvas already reflects it.
          // Skip instead of failing the whole batch; record it so the
          // response still describes what happened.
          ctx.issues.push(
            `Line ${op.line}: skipped — already applied before recovery (${err instanceof Error ? err.message : String(err)})`,
          );
          executedCount++;
          continue;
        }
        throw err;
      }
      completedOps.push(`${op.binding ? op.binding + "=" : ""}${op.op}(...) [line ${op.line}]`);
      executedCount++;
    }
  } catch (err) {
    return JSON.stringify({
      error: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
      completedOperations: completedOps,
      totalOperations: executable.length,
      ...(truncated ? { truncated: true, operationsSubmitted } : {}),
    });
  }

  return finalizeAndRespond({
    ctx,
    historySnapshot: originalSnapshot,
    operationsExecuted: executedCount,
    truncated,
    operationsSubmitted,
    remaining,
  });
}

export const batchDesign: ToolHandler = async (args, context) => {
  const operationsStr = args.operations as string | undefined;

  const takeSessionIfAny = (): ProgressiveBatchSession | undefined =>
    context?.sessionId && context?.toolCallId
      ? takeProgressiveBatchSession(context.sessionId, context.toolCallId)
      : undefined;

  if (!operationsStr || !operationsStr.trim()) {
    // No operations at all — nothing for this call to do. Still finalize
    // and clean up any progressive session tied to this tool call id so a
    // stray earlier stream (unlikely, but not impossible with a model that
    // streams then sends empty final args) can't leave scene writes behind
    // with nothing to ever claim them.
    const session = takeSessionIfAny();
    if (session) resolveDivergedOrDegradedSession(session);
    return JSON.stringify({ error: "No operations provided" });
  }

  // 1. Parse operations
  let parsed: ParsedOperation[];
  try {
    parsed = parseOperations(operationsStr);
  } catch (err) {
    const session = takeSessionIfAny();
    if (session) resolveDivergedOrDegradedSession(session);
    return JSON.stringify({
      error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const operationsSubmitted = parsed.length;
  const truncated = operationsSubmitted > MAX_OPERATIONS;
  const executable = truncated ? parsed.slice(0, MAX_OPERATIONS) : parsed;
  const remaining = truncated ? parsed.slice(MAX_OPERATIONS) : [];

  const session = takeSessionIfAny();

  if (session && !session.degraded && isVerbatimPrefix(session.appliedRaw, executable)) {
    // Finding 1: `session.detached` only reflects what the MID-STREAM guard
    // observed; it says nothing about a foreign write landing in the window
    // between the last streamed delta and this handler actually running
    // (behind `runToolCall`'s queue). Re-check liveness right here, at the
    // last possible moment before an "attached" finalize would otherwise
    // clobber it.
    return isSessionAttachedToLive(session)
      ? finishAttachedSession(session, executable, remaining, truncated, operationsSubmitted)
      : finishDetachedSession(session, executable, remaining, truncated, operationsSubmitted);
  }

  // Prefix diverged, or the session degraded mid-stream (a statement threw,
  // or an earlier divergence was already detected): make whatever it wrote
  // to the live store safe to ignore, then fall through to the ordinary,
  // never-streamed path below exactly as if there had been no session.
  //
  // (Third-review finding 2) When this session was also `detached`, a
  // foreign edit made a full `baseSnapshot` rollback unsafe, so
  // `resolveDivergedOrDegradedSession` could only run its narrower
  // created-node-deletion recovery — some of this session's `U()`/`D()`/
  // `M()` effects are still live. The full re-run below must tolerate a
  // statement whose target that streamed prefix already consumed, or a
  // recoverable situation would come back as a hard execution error.
  let lenient = false;
  if (session) {
    const fullyRestored = resolveDivergedOrDegradedSession(session);
    lenient = !fullyRestored;
  }

  return runFreshFromLive(executable, remaining, truncated, operationsSubmitted, { lenient });
};
