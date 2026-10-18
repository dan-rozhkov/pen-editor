// SPIKE(ipc-streaming): installs window.__spike when the desktop preload
// offers the spike bridge. Loaded lazily from main.tsx.
import { buildCanvasContext, executeToolCall, getToolCallTimeoutMs } from "@/hooks/useDesignChat";
import { getStreamingToolAdapter } from "@/lib/streamingTools";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { createSpikeRuntime } from "./runtime";

/** Identity token: changes whenever any store input of canvasContext changes. */
function contextVersion(): unknown {
  const scene = useSceneStore.getState();
  const key = [
    scene.nodesById,
    scene.rootIds,
    useSelectionStore.getState().selectedIds,
    useThemeStore.getState().activeTheme,
    useVariableStore.getState().variables,
  ];
  return versionFor(key);
}

const ids = new WeakMap<object, number>();
let nextId = 1;
const versions = new Map<string, object>();
function versionFor(parts: unknown[]): object {
  const key = parts
    .map((p) => {
      if (typeof p !== "object" || p === null) return String(p);
      if (!ids.has(p)) ids.set(p, nextId++);
      return `#${ids.get(p)}`;
    })
    .join("|");
  let token = versions.get(key);
  if (!token) {
    token = {};
    versions.set(key, token);
  }
  return token;
}

export function installSpike(): void {
  const bridge = window.penDesktop?.surfaceSpike;
  if (!bridge || window.__spike) return;
  const { api } = createSpikeRuntime({
    bridge,
    toolTimeoutMs: getToolCallTimeoutMs,
    getAdapter: getStreamingToolAdapter,
    executeToolCall: (toolName, input, context) => executeToolCall(toolName, input, context, "chat"),
    buildCanvasContext: () => (buildCanvasContext() as { canvasContext: string }).canvasContext,
    contextVersion,
  });
  window.__spike = api;
}
