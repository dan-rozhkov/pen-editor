import type { EmbedNode } from "@/types/scene";
import { NodeAgentButton } from "@/components/canvas/NodeAgentButton";
import { launchEmbedAgentChat } from "@/lib/launchEmbedAgentChat";

interface EmbedAgentButtonProps {
  node: EmbedNode;
  absoluteX: number;
  absoluteY: number;
}

/** On-canvas agent affordance for a selected embed (selection-only context). */
export function EmbedAgentButton({ node, absoluteX, absoluteY }: EmbedAgentButtonProps) {
  return (
    <NodeAgentButton
      node={node}
      absoluteX={absoluteX}
      absoluteY={absoluteY}
      placeholder="Ask the agent about this embed…"
      launch={launchEmbedAgentChat}
    />
  );
}
