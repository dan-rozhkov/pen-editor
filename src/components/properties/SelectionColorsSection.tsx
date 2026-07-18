import { useMemo, useState } from "react";
import type { SceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { collectSubtreeIds } from "@/utils/nodeUtils";
import { useShallow } from "zustand/react/shallow";
import { ColorInput, PropertySection } from "@/components/ui/PropertyInputs";
import {
  collectSelectionColors,
  normalizeColorKey,
  remapSelectionColor,
} from "@/utils/selectionColors";

interface SelectionColorsSectionProps {
  nodes: SceneNode[];
}

/**
 * One editable swatch. Owns local draft state so the picker/text field keeps
 * its own value while editing:
 * - dragging the picker fires onChange continuously; writing straight to the
 *   store would change the aggregated color key and remount this row (closing
 *   the picker) — the draft decouples the visible value from the store.
 * - the text field emits every keystroke verbatim; only *valid* hex is written
 *   to the scene graph, so invalid intermediates ("#00FF0") never land in a
 *   node (and don't spam undo history).
 * Remaps are chained from the last committed value, not the original color.
 */
export function SelectionColorRow({
  color,
  onRemap,
}: {
  color: string;
  onRemap: (from: string, to: string) => void;
}) {
  // `draft` = what the field currently shows; `committed` = the last value
  // actually written to the store (what the next remap chains from).
  const [draft, setDraft] = useState(color);
  const [committed, setCommitted] = useState(color);

  // Re-sync when the selection (or its aggregated colors) changes underneath us.
  // Adjust-state-during-render (guarded) rather than an effect — this is the
  // React-recommended way to reset state on a prop change and avoids the extra
  // render pass an effect would cause.
  const [prevColor, setPrevColor] = useState(color);
  if (color !== prevColor) {
    setPrevColor(color);
    setDraft(color);
    setCommitted(color);
  }

  const handleChange = (next: string) => {
    setDraft(next); // always reflect what the user typed/dragged
    if (normalizeColorKey(next)) {
      // only write valid hex to the store
      onRemap(committed, next);
      setCommitted(next);
    }
  };

  return <ColorInput value={draft} onChange={handleChange} />;
}

/**
 * "Selection colors" (Figma parity): aggregates every unique solid color used
 * across `nodes` and their descendants, one swatch per color. Editing a
 * swatch remaps that exact color everywhere it appears in the selection in a
 * single undo step. Hidden when the selection carries no colors.
 */
export function SelectionColorsSection({ nodes }: SelectionColorsSectionProps) {
  const updateNodesById = useSceneStore((s) => s.updateNodesById);

  // Narrow subscription: re-render only when a node inside the SELECTION's
  // own subtrees changes, not on every scene mutation elsewhere (e.g. every
  // frame of a drag on an unselected node) — mirrors the pattern in
  // SizeSection.tsx. `basicMutations.ts` only replaces the touched id's entry
  // in `nodesById`/`childrenById`, so untouched nodes keep their original
  // object identity across mutations and `useShallow` short-circuits the
  // re-render when nothing in these subtrees changed.
  const rootIds = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const selectionSnapshot = useSceneStore(
    useShallow((s) =>
      collectSubtreeIds(rootIds, s.childrenById).map((id) => s.nodesById[id]),
    ),
  );

  const colors = useMemo(() => {
    const { nodesById, childrenById } = useSceneStore.getState();
    return collectSelectionColors(nodes, nodesById, childrenById);
    // `selectionSnapshot` (not `nodesById`/`childrenById` directly) is the
    // recompute trigger — see the comment above. It's not referenced in the
    // body (the lookup happens via `getState()`), hence the lint override.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, selectionSnapshot]);

  if (colors.length === 0) return null;

  const apply = (from: string, to: string) => {
    const { nodesById, childrenById } = useSceneStore.getState();
    updateNodesById(remapSelectionColor(nodes, nodesById, childrenById, from, to));
  };

  return (
    <PropertySection title="Selection colors">
      {colors.map((c, i) => (
        <SelectionColorRow key={i} color={c.color} onRemap={apply} />
      ))}
    </PropertySection>
  );
}
