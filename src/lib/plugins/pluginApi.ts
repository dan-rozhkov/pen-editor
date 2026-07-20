import { toast } from "sonner";
import { toolHandlers } from "@/lib/toolRegistry";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import type { SceneNode } from "@/types/scene";
import { PLUGIN_ALLOWED_TOOLS } from "./toolAllowlist";

function storageKey(pluginId: string, key: string): string {
  return `pen.plugin.${pluginId}.${key}`;
}

function asStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`${what} must be an array of node ids`);
  }
  return value as string[];
}

async function runTool(name: unknown, args: unknown): Promise<string> {
  if (typeof name !== "string") throw new Error("tools.run: tool name must be a string");
  if (!PLUGIN_ALLOWED_TOOLS.has(name)) throw new Error(`tools.run: tool "${name}" is not allowed for plugins`);
  const handler = toolHandlers[name];
  if (!handler) throw new Error(`tools.run: unknown tool "${name}"`);
  return handler((args ?? {}) as Record<string, unknown>);
}

/** Collect tree nodes matching ids (any depth) for viewport fitting. */
function findTreeNodes(nodes: SceneNode[], ids: ReadonlySet<string>): SceneNode[] {
  const found: SceneNode[] = [];
  const walk = (list: SceneNode[]) => {
    for (const node of list) {
      if (ids.has(node.id)) found.push(node);
      if ("children" in node && node.children) walk(node.children as SceneNode[]);
    }
  };
  walk(nodes);
  return found;
}

/**
 * Host-side facade for the sandboxed `pen.*` API. Every RPC request from a
 * plugin iframe lands here; anything not handled below is rejected.
 */
export async function callPluginMethod(
  pluginId: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  switch (method) {
    case "tools.run":
      return runTool(args[0], args[1]);
    case "scene.batch": {
      if (typeof args[0] !== "string") throw new Error("scene.batch: operations must be a string");
      return runTool("batch_design", { operations: args[0] });
    }
    case "scene.get": {
      if (args[0] === undefined || args[0] === null) return runTool("get_editor_state", {});
      return runTool("batch_get", { nodeIds: asStringArray(args[0], "scene.get ids") });
    }
    case "selection.get":
      return [...useSelectionStore.getState().selectedIds];
    case "selection.set": {
      const ids = asStringArray(args[0], "selection.set ids");
      const { nodesById } = useSceneStore.getState();
      const known = ids.filter((id) => nodesById[id]);
      useSelectionStore.getState().setSelectedIds(known);
      return null;
    }
    case "viewport.zoomTo": {
      const ids = new Set(asStringArray(args[0], "viewport.zoomTo ids"));
      const targets = findTreeNodes(useSceneStore.getState().getNodes(), ids);
      if (targets.length === 0) throw new Error("viewport.zoomTo: no matching nodes");
      useViewportStore.getState().fitToContent(targets, window.innerWidth, window.innerHeight);
      return null;
    }
    case "notify": {
      toast(String(args[0] ?? ""));
      return null;
    }
    case "storage.get": {
      if (typeof args[0] !== "string") throw new Error("storage.get: key must be a string");
      const raw = localStorage.getItem(storageKey(pluginId, args[0]));
      return raw === null ? null : (JSON.parse(raw) as unknown);
    }
    case "storage.set": {
      if (typeof args[0] !== "string") throw new Error("storage.set: key must be a string");
      localStorage.setItem(storageKey(pluginId, args[0]), JSON.stringify(args[1] ?? null));
      return null;
    }
    default:
      throw new Error(`Unknown pen method: ${method}`);
  }
}
