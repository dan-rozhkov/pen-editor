import type { FrameNode, GroupNode } from "@/types/scene";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";

interface FrameActionsSectionProps {
  node: FrameNode | GroupNode;
}

export function FrameActionsSection({ node }: FrameActionsSectionProps) {
  const handleConvertToEmbed = () => {
    const embedId = useSceneStore.getState().convertDesignToEmbed(node.id);
    if (embedId) {
      useSelectionStore.getState().setSelectedIds([embedId]);
    }
  };

  return (
    <PropertySection title="Actions">
      <Button onClick={handleConvertToEmbed} variant="secondary" className="w-full">
        Convert to Embed
      </Button>
    </PropertySection>
  );
}
