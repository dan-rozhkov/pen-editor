import type { FrameNode } from "@/types/scene";
import { NodeAgentButton } from "@/components/canvas/NodeAgentButton";
import { launchFrameAgentChat } from "@/lib/launchFrameAgentChat";

interface FrameAgentButtonProps {
  node: FrameNode;
  absoluteX: number;
  absoluteY: number;
}

/** On-canvas agent affordance for a selected frame (screenshot context). */
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
