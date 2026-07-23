import { useSceneStore } from "@/store/sceneStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import { useHistoryStore, withHistoryBatch } from "@/store/historyStore";
import { updateFillAt } from "@/components/properties/fillSectionUtils";
import { clearLegacyFillProps, createSolidPaint, getFills, getPrimarySolidPaint } from "@/utils/fillUtils";
import type { FlatSceneNode } from "@/types/scene";

/**
 * Apply a sampled eyedropper color as the Fill of every selected node
 * (Figma-style eyedropper hotkey — see
 * docs/superpowers/specs/2026-07-23-eyedropper-fill-design.md).
 *
 * For each node: if it has a primary (topmost visible) solid paint, its
 * color is replaced in place; otherwise the node's fill stack is reset to a
 * single new solid paint. No DOM/EyeDropper access here — pure store
 * mutation so this stays unit-testable without a browser API.
 */
export function applyEyedropperColor(hex: string, selectedIds: string[]): void {
  const { nodesById } = useSceneStore.getState();
  const targetIds = selectedIds.filter((id): id is string => Boolean(nodesById[id]));
  if (targetIds.length === 0) return;

  const applyToNode = (id: string) => {
    const node = nodesById[id] as FlatSceneNode;
    const fills = getFills(node);
    const primary = getPrimarySolidPaint(node);
    const nextFills = primary
      ? updateFillAt(fills, fills.indexOf(primary), { ...primary, color: hex })
      : [createSolidPaint(hex)];
    useSceneStore.getState().updateNode(id, { fills: nextFills, ...clearLegacyFillProps() });
  };

  if (targetIds.length === 1) {
    applyToNode(targetIds[0]);
    return;
  }

  // Multi-node pick: one snapshot before any mutation + a history batch
  // around the per-node updates, so N node updates collapse into a single
  // undo step (mirrors src/lib/tools/applyStyleToNodes.ts).
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
  withHistoryBatch(() => {
    for (const id of targetIds) applyToNode(id);
  });
}
