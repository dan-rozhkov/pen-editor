import { useEffect } from "react";
import { AgentComposerButton } from "@/components/canvas/AgentComposerButton";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { launchEmbedElementAgentChat } from "@/lib/launchEmbedElementAgentChat";
import type { EmbedElementSelection } from "@/lib/embedElementPicker";

interface EmbedElementAgentButtonProps {
  selection: EmbedElementSelection;
  /** Where the trigger sits: the picked element's own top-right corner, in
   * the overlay's canvas-relative space — the same corner `NodeAgentButton`
   * anchors to for a native node, so the affordance lands next to what was
   * actually picked rather than across the embed. Clamped into the embed
   * host's box by `elementAgentAnchor` (EmbedElementHighlight.tsx), which
   * also documents the pointer-overlap this placement accepts.
   * `AgentComposerButton` adds the 8px gap. */
  anchor: { x: number; y: number };
}

/**
 * On-canvas agent affordance for a picked embed element — the embed
 * equivalent of `FrameAgentButton`/`EmbedAgentButton`, but scoped to a single
 * element inside the embed's shadow DOM rather than the whole node. No quick
 * actions (those are frame-specific), no screenshot up front (see
 * `launchEmbedElementAgentChat`'s doc comment).
 */
export function EmbedElementAgentButton({
  selection,
  anchor,
}: EmbedElementAgentButtonProps) {
  // Tell PixiCanvas the element-scoped affordance exists, so it can suppress
  // the embed-level one it replaces — see `elementAffordanceVisible`'s doc
  // comment in embedPickerStore.ts for why this is reported from the mount
  // rather than derived from the picker selection.
  useEffect(() => {
    useEmbedPickerStore.getState().setElementAffordanceVisible(true);
    return () => useEmbedPickerStore.getState().setElementAffordanceVisible(false);
  }, []);

  return (
    <AgentComposerButton
      anchor={anchor}
      placeholder="Ask the agent about this element…"
      onSend={(text) => void launchEmbedElementAgentChat(selection, text)}
    />
  );
}
