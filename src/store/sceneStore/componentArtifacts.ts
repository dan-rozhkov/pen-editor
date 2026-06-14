import type {
  FlatSceneNode,
  FlatFrameNode,
  ComponentArtifact,
} from "../../types/scene";
import { convertDesignNodesToHtml } from "@/lib/designToHtml";
import type { SceneState } from "./types";
import type { StoreApi } from "zustand";

type SetState = StoreApi<SceneState>["setState"];

function cloneArtifacts(
  artifacts: Record<string, ComponentArtifact>,
): Record<string, ComponentArtifact> {
  return Object.fromEntries(
    Object.entries(artifacts).map(([id, artifact]) => [id, { ...artifact }]),
  );
}

export function markComponentArtifactStaleFromNative(
  artifacts: Record<string, ComponentArtifact>,
  node: FlatSceneNode | undefined,
): Record<string, ComponentArtifact> {
  if (!node || node.type !== "frame" || !(node as FlatFrameNode).reusable) return artifacts;
  const next = cloneArtifacts(artifacts);
  const existing = next[node.id];
  next[node.id] = {
    authoringHtml: existing?.authoringHtml,
    sourceTemplate: existing?.sourceTemplate,
    revision: (existing?.revision ?? 0) + 1,
    syncState: existing?.authoringHtml || existing?.sourceTemplate ? "stale_from_native" : "missing",
  };
  return next;
}

export function markComponentArtifactsStaleFromNative(
  artifacts: Record<string, ComponentArtifact>,
  nodes: Array<FlatSceneNode | undefined>,
): Record<string, ComponentArtifact> {
  return nodes.reduce(
    (next, node) => markComponentArtifactStaleFromNative(next, node),
    artifacts,
  );
}

export function createComponentArtifactOperations(set: SetState) {
  return {
    syncComponentToHtml: (componentId: string) =>
      set((state) => {
        const node = state.nodesById[componentId];
        if (!node || node.type !== "frame" || !(node as FlatFrameNode).reusable) return state;

        const allNodes = state.getNodes();
        const html = convertDesignNodesToHtml(componentId, state.nodesById, state.childrenById, allNodes, { isComponent: true });
        const existing = state.componentArtifactsById[componentId];

        return {
          componentArtifactsById: {
            ...state.componentArtifactsById,
            [componentId]: {
              authoringHtml: html,
              sourceTemplate: existing?.sourceTemplate,
              revision: existing?.revision ?? 1,
              syncState: "in_sync",
            },
          },
        };
      }),
  };
}
