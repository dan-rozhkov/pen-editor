import type { FrameNode, SceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { PropertySection, CheckboxInput } from "@/components/ui/PropertyInputs";

interface SlotsSectionProps {
  node: FrameNode;
  childNodes: SceneNode[];
}

export function SlotsSection({ node, childNodes }: SlotsSectionProps) {
  const toggleSlot = useSceneStore((s) => s.toggleSlot);
  const slotIds = node.slot ?? [];

  if (childNodes.length === 0) return null;

  return (
    <PropertySection title="Slots">
      <div className="flex flex-col gap-1">
        {childNodes.map((child) => (
          <CheckboxInput
            key={child.id}
            label={child.name || child.type}
            checked={slotIds.includes(child.id)}
            onChange={() => toggleSlot(node.id, child.id)}
          />
        ))}
      </div>
    </PropertySection>
  );
}
