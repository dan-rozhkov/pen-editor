import { toast } from "sonner";
import { toolHandlers } from "@/lib/toolRegistry";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import type { SceneNode } from "@/types/scene";
import { PLUGIN_ALLOWED_TOOLS } from "./toolAllowlist";

/** encodeURIComponent leaves '.' unescaped; also escape it so pluginId/key
 * segments containing dots can't collide with the `.` separators below. */
const enc = (s: string) => encodeURIComponent(s).replace(/\./g, "%2E");

function storageKey(pluginId: string, key: string): string {
  return `pen.plugin.${enc(pluginId)}.${enc(key)}`;
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

/**
 * Resolve ids to synthetic root-level nodes carrying ABSOLUTE x/y, suitable
 * for `fitToContent`/`calculateNodesBounds`, which treat top-level array
 * entries as canvas-absolute. `nodesById` entries are parent-relative.
 */
function resolveAbsoluteNodes(ids: ReadonlySet<string>): SceneNode[] {
  const { nodesById, getNodes } = useSceneStore.getState();
  const tree = getNodes();
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const resolved: SceneNode[] = [];
  for (const id of ids) {
    const node = nodesById[id];
    if (!node) continue;
    const abs = getNodeAbsolutePositionWithLayout(tree, id, calc);
    if (!abs) continue;
    resolved.push({ ...node, x: abs.x, y: abs.y, children: [] } as SceneNode);
  }
  return resolved;
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
      return known;
    }
    case "viewport.zoomTo": {
      const ids = new Set(asStringArray(args[0], "viewport.zoomTo ids"));
      const targets = resolveAbsoluteNodes(ids);
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
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new Error(`storage.get: corrupt value for key "${args[0]}"`);
      }
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
