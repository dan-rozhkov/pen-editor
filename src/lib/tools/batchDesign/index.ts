import { useSceneStore } from "@/store/sceneStore";
import { createSnapshot, saveHistory } from "@/store/sceneStore/helpers/history";
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

  const ctx: ExecutionContext = {
    bindings: new Map([["document", "__document__"]]),
    nodesById: { ...state.nodesById },
    parentById: { ...state.parentById },
    childrenById: { ...state.childrenById },
    rootIds: [...state.rootIds],
    createdNodeIds: [],
    issues: [],
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

  // 4. All operations succeeded — commit to store
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

  // 5. Build response
  const createdNodes = serializeCreatedNodes(ctx);

  const response: Record<string, unknown> = {
    success: true,
    operationsExecuted: completedOps.length,
    createdNodes,
  };

  if (ctx.issues.length > 0) {
    response.issues = ctx.issues;
  }

  return JSON.stringify(response);
};
