import { useEmbedScreenRect } from "@/components/canvas/useEmbedScreenRect";
import { AgentComposerButton } from "@/components/canvas/AgentComposerButton";
import { FRAME_QUICK_ACTIONS } from "@/components/canvas/frameQuickActions";

interface NodeAgentButtonProps {
  node: { id: string; width: number; height: number };
  absoluteX: number;
  absoluteY: number;
  placeholder: string;
  launch: (nodeId: string, text: string) => void | Promise<unknown>;
}

/**
 * On-canvas affordance shown at a selected node's top-right corner: a small
 * trigger that opens a composer (text input + send + quick actions). Sending
 * invokes the injected `launch` — both the frame and embed variants rely on
 * the current selection (no screenshot is attached up front). Positioning
 * mirrors EmbedActionBar — world
 * coordinates are converted to screen space via the viewport transform so the
 * button tracks pan/zoom.
 *
 * Thin wrapper around the shared `AgentComposerButton`: this component only
 * computes the screen rect and the frame quick actions; the popup itself
 * (and the embed-element variant, `EmbedElementAgentButton`) share the same
 * presentational component.
 */
export function NodeAgentButton({
  node,
  absoluteX,
  absoluteY,
  placeholder,
  launch,
}: NodeAgentButtonProps) {
  const rect = useEmbedScreenRect(absoluteX, absoluteY, node.width, node.height);

  return (
    <AgentComposerButton
      anchor={{ x: rect.left + rect.width, y: rect.top }}
      placeholder={placeholder}
      onSend={(text) => void launch(node.id, text)}
      quickActions={FRAME_QUICK_ACTIONS}
    />
  );
}
