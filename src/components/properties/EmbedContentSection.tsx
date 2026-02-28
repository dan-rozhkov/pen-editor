import { useState, useEffect, useRef } from "react";
import type { SceneNode, EmbedNode } from "@/types/scene";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Textarea } from "@/components/ui/textarea";

interface EmbedContentSectionProps {
  node: EmbedNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

export function EmbedContentSection({ node, onUpdate }: EmbedContentSectionProps) {
  const [localValue, setLocalValue] = useState(node.htmlContent);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocalValue(node.htmlContent);
  }, [node.htmlContent]);

  const handleChange = (value: string) => {
    setLocalValue(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdate({ htmlContent: value } as Partial<SceneNode>);
    }, 300);
  };

  return (
    <PropertySection title="HTML Content">
      <Textarea
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        className="min-h-32 font-mono resize-y"
        spellCheck={false}
        placeholder="<div>Your HTML here</div>"
      />
    </PropertySection>
  );
}
