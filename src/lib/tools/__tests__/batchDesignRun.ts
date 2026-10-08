import { expect } from "vitest";
import { batchDesign } from "@/lib/tools/batchDesign";
import { useSceneStore } from "@/store/sceneStore";

export type Rec = Record<string, unknown>;

export const sceneNode = (id: string) => useSceneStore.getState().nodesById[id] as unknown as Rec;

/** Runs a batch_design script, asserts success and returns the parsed result. */
export async function runBatch(operations: string) {
  const result = JSON.parse(await batchDesign({ operations }));
  expect(result.success).toBe(true);
  return result as { createdNodes: { id: string }[]; warnings?: string[]; issues?: string[] };
}
