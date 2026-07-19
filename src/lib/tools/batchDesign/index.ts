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
import { parseOperations } from "./parser";
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

  // 3. Execute operations sequentially
  const completedOps: string[] = [];
  try {
    for (const op of parsed) {
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
      totalOperations: parsed.length,
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

  return JSON.stringify(response);
};
