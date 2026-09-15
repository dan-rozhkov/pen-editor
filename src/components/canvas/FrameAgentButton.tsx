import type { FrameNode } from "@/types/scene";
import { NodeAgentButton } from "@/components/canvas/NodeAgentButton";
import { launchFrameAgentChat } from "@/lib/launchFrameAgentChat";

interface FrameAgentButtonProps {
  node: FrameNode;
  absoluteX: number;
  absoluteY: number;
}

/**
 * On-canvas agent affordance for a selected frame. No screenshot is
 * attached — the frame is selected, so its id already goes out via
 * canvasContext; the agent calls `get_screenshot` itself if it needs pixels.
 */
export function FrameAgentButton({ node, absoluteX, absoluteY }: FrameAgentButtonProps) {
  return (
    <NodeAgentButton
      node={node}
      absoluteX={absoluteX}
      absoluteY={absoluteY}
      placeholder="Ask the agent about this frame…"
      launch={launchFrameAgentChat}
    />
  );
}
