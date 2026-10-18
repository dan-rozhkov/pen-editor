import { useMemo } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { usePanelSelection } from "@/lib/canvasLink/usePanelSelection";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import type { EmbedElementSelection } from "@/lib/embedElementPicker";

// Keep chip labels compact — a CSS-selector-ish description, not the full
// class list (which can run long on utility-class-heavy markup).
const MAX_CLASSES_IN_LABEL = 2;
const MAX_CLASS_LABEL_LENGTH = 20;

function truncateClass(cls: string): string {
  return cls.length > MAX_CLASS_LABEL_LENGTH
    ? `${cls.slice(0, MAX_CLASS_LABEL_LENGTH)}…`
    : cls;
}

/**
 * Format a picked embed element as a compact, CSS-selector-like label for
 * display (e.g. in the chat composer's chip). Pure so it's unit-testable
 * without mounting any store.
 *
 * Priority: `#id` (elements with an id are usually the most identifiable
 * anchor) — otherwise `tag.class1.class2` capped at
 * `MAX_CLASSES_IN_LABEL` classes — otherwise just the bare tag name.
 */
export function formatEmbedElementLabel(
  selection: Pick<EmbedElementSelection, "tagName" | "elementId" | "classes">,
): string {
  if (selection.elementId) return `#${selection.elementId}`;
  if (selection.classes.length === 0) return selection.tagName;
  const classesPart = selection.classes
    .slice(0, MAX_CLASSES_IN_LABEL)
    .map(truncateClass)
    .join(".");
  return `${selection.tagName}.${classesPart}`;
}

export interface EmbedElementContext {
  /** Locally the full pick; in the panel only the text preview the chip shows. */
  selection: Pick<EmbedElementSelection, "textPreview"> & Partial<EmbedElementSelection>;
  /** Compact CSS-selector-like label, e.g. `#hero` or `button.primary`. */
  label: string;
  /** The owning embed node's display name, for a human-readable title. */
  embedName: string;
}

/** Pure: the chip for a picked element, or null when its embed left the scene (shared with the canvas link host). */
export function computeEmbedElementContext(
  selection: EmbedElementSelection | null,
  embedNode: { name?: string } | undefined,
): EmbedElementContext | null {
  if (!selection || !embedNode) return null;
  return { selection, label: formatEmbedElementLabel(selection), embedName: embedNode.name ?? "Embed" };
}

/**
 * The element the user last picked inside an embed (via the "select
 * element" picker), for display above the chat input — the same data
 * already riding along to the agent in `canvasContext.selectedEmbedElement`
 * (see `buildCanvasContext` in `useDesignChat.ts`). This hook is purely a
 * UI-visibility layer: it does not affect what's sent.
 *
 * Returns `null` when there's no selection, or when the selection's owning
 * embed has since left the scene — the same last-line guard
 * `buildCanvasContext` applies before forwarding the selection to the agent,
 * so the chip and the actual outgoing context never disagree.
 */
export function useEmbedElementContext(sessionId?: string): EmbedElementContext | null {
  // In the desktop agent panel the local stores are empty: the chip comes from the bound canvas tab.
  const remote = usePanelSelection(sessionId);
  // In the panel the local stores stay unread: constant selectors never re-render.
  const selection = useEmbedPickerStore((s) => (remote ? null : s.selection));
  const embedNode = useSceneStore((s) => (selection ? s.nodesById[selection.embedId] : undefined));
  const remoteChip = useMemo(
    () =>
      remote?.embedElement
        ? {
            selection: { textPreview: remote.embedElement.textPreview },
            label: remote.embedElement.label,
            embedName: remote.embedElement.embedName,
          }
        : null,
    [remote],
  );
  if (remote) return remoteChip;
  return computeEmbedElementContext(selection, embedNode);
}
