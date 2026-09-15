import { useEffect } from "react";
import { AgentComposerButton } from "@/components/canvas/AgentComposerButton";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { launchEmbedElementAgentChat } from "@/lib/launchEmbedElementAgentChat";
import type { EmbedElementSelection } from "@/lib/embedElementPicker";

interface EmbedElementAgentButtonProps {
  selection: EmbedElementSelection;
  /** Where the trigger sits: the owning embed's right edge, at the picked
   * element's top. Deliberately NOT the element's own top-right corner —
   * that point is inside the embed, so the trigger (and, once opened, the
   * 288px composer) would cover live HTML and swallow clicks in the one mode
   * whose entire job is clicking elements inside that HTML. */
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
