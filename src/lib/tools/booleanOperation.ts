import { useSceneStore } from "@/store/sceneStore";
import type { BooleanOpKind } from "@/lib/booleanOps";
import type { ToolHandler } from "../toolRegistry";

const VALID_OPS = new Set<BooleanOpKind>(["union", "subtract", "intersect", "exclude", "flatten"]);

function parseNodeIds(raw: unknown): string[] | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      // A single bare id string is also acceptable.
      return raw ? [raw as string] : null;
    }
  }
  if (!Array.isArray(value)) return null;
  const ids = value.filter((v): v is string => typeof v === "string");
  return ids.length > 0 ? ids : null;
}

/**
 * Client-executed AI tool: combine 2+ selected shape nodes (rect/ellipse/
 * polygon/path) into a single destructive path node via a boolean operation.
 * Delegates all geometry + undo/redo to `sceneStore.booleanOperation`
 * (backed by `src/lib/booleanOps`) — this handler only parses args and
 * reports the result back to the model.
 */
export const booleanOperation: ToolHandler = async (args) => {
  const nodeIds = parseNodeIds(args.nodeIds);
  const operation = typeof args.operation === "string" ? args.operation : undefined;

  if (!nodeIds || nodeIds.length < 2) {
    return JSON.stringify({ error: "Provide at least two nodeIds to combine." });
  }
  if (!operation || !VALID_OPS.has(operation as BooleanOpKind)) {
    return JSON.stringify({
      error: `Invalid operation "${operation}". Must be one of: union, subtract, intersect, exclude, flatten.`,
    });
  }

  const resultId = useSceneStore.getState().booleanOperation(nodeIds, operation as BooleanOpKind);

  if (!resultId) {
    return JSON.stringify({
      error:
        "Boolean operation produced no result. The nodes must share a parent, all be " +
        "rect/ellipse/polygon/path shapes, and (for subtract/intersect) actually overlap.",
    });
  }

  return JSON.stringify({ resultNodeId: resultId, operation });
};
