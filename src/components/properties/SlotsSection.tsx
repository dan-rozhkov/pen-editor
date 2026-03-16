import type { FlatFrameNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { PropertySection, CheckboxInput } from "@/components/ui/PropertyInputs";

interface SlotsSectionProps {
  node: FlatFrameNode;
}

export function SlotsSection({ node }: SlotsSectionProps) {
  const toggleSlot = useSceneStore((s) => s.toggleSlot);

  return (
    <PropertySection title="Slot">
      <CheckboxInput
        label="Mark as slot"
        checked={!!node.isSlot}
        onChange={() => toggleSlot(node.id)}
      />
    </PropertySection>
  );
}
