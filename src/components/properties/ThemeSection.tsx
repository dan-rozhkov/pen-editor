import type { FrameNode, SceneNode } from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { PropertySection, SelectInput } from "@/components/ui/PropertyInputs";

interface ThemeSectionProps {
  node: FrameNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

export function ThemeSection({ node, onUpdate }: ThemeSectionProps) {
  return (
    <PropertySection title="Theme">
      <SelectInput
        value={node.themeOverride ?? "inherit"}
        options={[
          { value: "inherit", label: "Inherit" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        onChange={(v) =>
          onUpdate({
            themeOverride: v === "inherit" ? undefined : (v as ThemeName),
          } as Partial<SceneNode>)
        }
      />
    </PropertySection>
  );
}
