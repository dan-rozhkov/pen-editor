import { useSceneStore } from "@/store/sceneStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { createSnapshot, saveHistory } from "@/store/sceneStore/helpers/history";
import type { EmbedNode } from "@/types/scene";
import {
  collectDocumentComponents,
  buildDocumentComponentTagMap,
} from "@/lib/documentComponents";
import { propagateComponentChanges } from "@/utils/embedTemplateUtils";
import type { ToolHandler } from "../../toolRegistry";
import type { ExecutionContext } from "./types";
import { parseOperations, MAX_OPERATIONS } from "./parser";
import { executeOperation, serializeCreatedNodes } from "./executor";

export const batchDesign: ToolHandler = async (args) => {
  const operationsStr = args.operations as string | undefined;

  if (!operationsStr || !operationsStr.trim()) {
    return JSON.stringify({ error: "No operations provided" });
  }

  // 1. Parse operations
  let parsed;
  try {
    parsed = parseOperations(operationsStr);
  } catch (err) {
    return JSON.stringify({
      error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const operationsSubmitted = parsed.length;
  const truncated = operationsSubmitted > MAX_OPERATIONS;
  const executable = truncated ? parsed.slice(0, MAX_OPERATIONS) : parsed;
  const remaining = truncated ? parsed.slice(MAX_OPERATIONS) : [];

  // 2. Get current store state, create mutable copies
  const state = useSceneStore.getState();
  const originalSnapshot = createSnapshot(state);

  // Build document component tag map from current state (before mutations)
  const docComponents = collectDocumentComponents(state.nodesById, undefined, state.childrenById);
  const componentTagMap = buildDocumentComponentTagMap(docComponents);

  const ctx: ExecutionContext = {
    bindings: new Map([["document", "__document__"]]),
    nodesById: { ...state.nodesById },
    parentById: { ...state.parentById },
    childrenById: { ...state.childrenById },
    rootIds: [...state.rootIds],
    createdNodeIds: [],
    issues: [],
    componentTagMap,
    removedIdsForMeasurementCleanup: new Set(),
  };

  // 3. Execute operations sequentially (only the first MAX_OPERATIONS when
  // the submitted script exceeds the cap — see truncation handling below).
  const completedOps: string[] = [];
  try {
    for (const op of executable) {
      executeOperation(op, ctx);
      completedOps.push(
        `${op.binding ? op.binding + "=" : ""}${op.op}(...) [line ${op.line}]`
      );
    }
  } catch (err) {
    // Error: return error + completed ops. Store is untouched.
    return JSON.stringify({
      error: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
      completedOperations: completedOps,
      totalOperations: executable.length,
      ...(truncated ? { truncated: true, operationsSubmitted } : {}),
    });
  }

  // 4. Propagate component changes to dependent embeds
  // Check if any component htmlContent was modified, and re-expand dependents
  const anyComponentChanged = docComponents.some((comp) => {
    const current = ctx.nodesById[comp.id];
    return current && current.type === "embed" &&
      (current as EmbedNode).htmlContent !== comp.templateHtml;
  });
  if (anyComponentChanged) {
    propagateComponentChanges(ctx.nodesById);
  }

  // 5. All operations succeeded — commit to store
  // Save history first (one undo entry for the entire batch)
  saveHistory(originalSnapshot);

  // Commit the new state
  useSceneStore.setState({
    nodesById: ctx.nodesById,
    parentById: ctx.parentById,
    childrenById: ctx.childrenById,
    rootIds: ctx.rootIds,
    _cachedTree: null,
  });

  // Drop pinned measurements touching anything R()/D() removed during the
  // batch — same undo step as the commit above (saveHistory already
  // recorded the pre-batch measurements list; removeMeasurementsForNodes
  // saves no history of its own).
  if (ctx.removedIdsForMeasurementCleanup.size > 0) {
    useMeasurementsStore
      .getState()
      .removeMeasurementsForNodes([...ctx.removedIdsForMeasurementCleanup]);
  }

  // 6. Build response
  const createdNodes = serializeCreatedNodes(ctx);

  const response: Record<string, unknown> = {
    success: true,
    operationsExecuted: completedOps.length,
    createdNodes,
  };

  if (ctx.issues.length > 0) {
    // Dedupe: the same guidance (e.g. "an `id` field is ignored") is pushed
    // once per affected node, so a script touching many nodes would otherwise
    // repeat identical strings and bloat the result returned to the model.
    response.issues = [...new Set(ctx.issues)];
  }

  if (truncated) {
    response.truncated = true;
    response.operationsSubmitted = operationsSubmitted;

    // Bindings created in this batch (excluding the predefined "document").
    // The model needs these to translate binding references in the
    // remaining operations into real node ids in its next call.
    const bindings: Record<string, string> = {};
    for (const [name, id] of ctx.bindings) {
      if (name === "document") continue;
      bindings[name] = id;
    }
    response.bindings = bindings;

    // Remaining operations, verbatim, capped to a character budget so the
    // response itself doesn't balloon on very large batches. At least one
    // operation is always included, even if it alone exceeds the budget —
    // an empty list here would tell the model to send nothing, silently
    // dropping the entire remaining tail.
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
};
