import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeToolCall } from "@/hooks/useDesignChat";
import { toolHandlers } from "@/lib/toolRegistry";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { startNumberBindingSync } from "@/store/numberBindingSync";
import { consumeDirty } from "@/store/sceneStore/dirtyTracking";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

let stop: (() => void) | undefined;
const original = toolHandlers.get_editor_state;

beforeEach(() => {
  resetStores();
  useVariableStore.getState().setVariables([{ id: "r", name: "--radius", type: "number", value: "12" }]);
  const a = {
    id: "a", type: "frame", x: 0, y: 0, width: 10, height: 10, cornerRadius: 1,
    numberBindings: { cornerRadius: { variableId: "r" } },
  } as unknown as FlatSceneNode;
  useSceneStore.setState({ nodesById: { a }, parentById: { a: null }, childrenById: {}, rootIds: ["a"], _cachedTree: null });
  consumeDirty();
  stop = startNumberBindingSync();
});

afterEach(() => {
  stop?.();
  toolHandlers.get_editor_state = original;
});

describe("executeToolCall and bound numbers", () => {
  it("a handler that changes a variable returns a result read after the bound literals settled", async () => {
    toolHandlers.get_editor_state = async () => {
      useVariableStore.getState().setVariables([{ id: "r", name: "--radius", type: "number", value: "30" }]);
      return "ok";
    };
    const result = await executeToolCall("get_editor_state", {}, undefined, "bridge");
    expect(result).toBe("ok");
    // Same task as the tool result: no microtask has been awaited by the test.
    expect((useSceneStore.getState().nodesById.a as unknown as { cornerRadius: number }).cornerRadius).toBe(30);
  });

  it("a handler sees settled literals from a mutation that preceded it", async () => {
    useVariableStore.getState().setVariables([{ id: "r", name: "--radius", type: "number", value: "7" }]);
    let seen: number | undefined;
    toolHandlers.get_editor_state = async () => {
      seen = (useSceneStore.getState().nodesById.a as unknown as { cornerRadius: number }).cornerRadius;
      return "ok";
    };
    await executeToolCall("get_editor_state", {}, undefined, "bridge");
    expect(seen).toBe(7);
  });
});
