import { useEffect, useState } from "react";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import type { SceneState } from "@/store/sceneStore";
import { findPixiChild } from "@/utils/pixiUtils";
import type { FlatFrameNode } from "@/types/scene";

const EMPTY_THUMBNAILS: Map<string, string> = new Map();

function addChangedRecordEntries<T>(
  changedIds: Set<string>,
  previous: Record<string, T>,
  next: Record<string, T>,
): void {
  for (const id of Object.keys(next)) {
    if (previous[id] !== next[id]) changedIds.add(id);
  }
  for (const id of Object.keys(previous)) {
    if (!(id in next)) changedIds.add(id);
  }
}

function collectChangedNodeIds(previous: SceneState, next: SceneState): Set<string> {
  const changedIds = new Set<string>();
  addChangedRecordEntries(changedIds, previous.nodesById, next.nodesById);
  addChangedRecordEntries(changedIds, previous.parentById, next.parentById);
  addChangedRecordEntries(changedIds, previous.childrenById, next.childrenById);
  return changedIds;
}

function findRequestedAncestor(
  nodeId: string,
  parentById: Record<string, string | null>,
  requestedIds: Set<string>,
): string | null {
  let currentId: string | null = nodeId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    if (requestedIds.has(currentId)) return currentId;
    visited.add(currentId);
    currentId = parentById[currentId] ?? null;
  }

  return null;
}

/**
 * Generic Pixi-extract thumbnail generator for any list of nodes with an
 * `id` that resolves to a Pixi container in the scene (frames, in practice).
 * Shared by ComponentsPanel (reusable components) and SlidesPanel (top-level
 * frames). The initial list is captured once; later scene changes are mapped
 * to the nearest requested ancestor so only dirty thumbnails are regenerated.
 */
export function useNodeThumbnails(nodes: { id: string }[]) {
  const pixiRefs = useCanvasRefStore((s) => s.pixiRefs);
  const [thumbnails, setThumbnails] = useState<Map<string, string> | null>(null);
  const nodeIdsKey = nodes.map((node) => node.id).sort().join("\u0000");

  useEffect(() => {
    const nodeIds = nodeIdsKey ? nodeIdsKey.split("\u0000") : [];
    if (!pixiRefs || nodeIds.length === 0) return;
    const { app, sceneRoot } = pixiRefs;

    const requestedIds = new Set(nodeIds);
    const pendingIds = new Set(nodeIds);
    let previousScene = useSceneStore.getState();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let captureInFlight = false;
    let disposed = false;

    function scheduleCapture(ids: Iterable<string>): void {
      for (const id of ids) pendingIds.add(id);
      if (timeoutId !== null || captureInFlight || pendingIds.size === 0) return;
      timeoutId = setTimeout(flushPendingCaptures, 300);
    }

    async function flushPendingCaptures(): Promise<void> {
      timeoutId = null;
      if (disposed || pendingIds.size === 0) return;

      const ids = [...pendingIds];
      pendingIds.clear();
      captureInFlight = true;
      const updates = new Map<string, string>();

      for (const id of ids) {
        const container = findPixiChild(sceneRoot, id);
        if (!container) continue;
        try {
          const raw = await app.renderer.extract.base64(container);
          // raw may or may not include the data URI prefix
          const dataUrl = raw.startsWith("data:")
            ? raw
            : `data:image/png;base64,${raw}`;
          updates.set(id, dataUrl);
        } catch {
          // skip — placeholder will be shown
        }
      }

      captureInFlight = false;
      if (disposed) return;

      setThumbnails((previous) => {
        const next = new Map(previous ?? []);
        for (const id of next.keys()) {
          if (!requestedIds.has(id)) next.delete(id);
        }
        for (const [id, dataUrl] of updates) next.set(id, dataUrl);
        return next;
      });

      if (pendingIds.size > 0) scheduleCapture([]);
    }

    scheduleCapture([]);

    const unsubscribe = useSceneStore.subscribe((nextScene) => {
      const changedIds = collectChangedNodeIds(previousScene, nextScene);
      const dirtyRequestedIds = new Set<string>();

      for (const changedId of changedIds) {
        const nextAncestor = findRequestedAncestor(
          changedId,
          nextScene.parentById,
          requestedIds,
        );
        if (nextAncestor) dirtyRequestedIds.add(nextAncestor);

        const previousAncestor = findRequestedAncestor(
          changedId,
          previousScene.parentById,
          requestedIds,
        );
        if (previousAncestor) dirtyRequestedIds.add(previousAncestor);
      }

      previousScene = nextScene;
      scheduleCapture(dirtyRequestedIds);
    });

    return () => {
      disposed = true;
      unsubscribe();
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [pixiRefs, nodeIdsKey]);

  // Derived: with no canvas refs or no nodes there are no thumbnails;
  // otherwise keep showing the last generated map until the next one is ready
  // (same behavior as before, without setState inside the effect body).
  if (!pixiRefs || nodes.length === 0) return EMPTY_THUMBNAILS;
  return thumbnails ?? EMPTY_THUMBNAILS;
}

export function useComponentThumbnails(components: FlatFrameNode[]) {
  return useNodeThumbnails(components);
}
