import type { FrameNode, SceneNode } from "@/types/scene";
import { THEME_COLLECTION_ID, type ModeOverrides } from "@/types/variable";
import { PropertySection, SelectInput } from "@/components/ui/PropertyInputs";
import { useVariableStore } from "@/store/variableStore";
import { getFrameModeOverrides } from "@/lib/variables/modeContext";

interface ThemeSectionProps {
  node: FrameNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

const INHERIT = "inherit";

export function ThemeSection({ node, onUpdate }: ThemeSectionProps) {
  const collections = useVariableStore((s) => s.collections);
  const pickable = collections.filter((c) => c.modes.length >= 2);
  const onlyTheme = pickable.length === 1 && pickable[0].id === THEME_COLLECTION_ID;
  const overrides = getFrameModeOverrides(node);

  const pick = (collectionId: string, value: string) => {
    // `updateNode` merges shallowly, so send the complete object (never a partial).
    const next: ModeOverrides = { ...overrides };
    if (value === INHERIT) delete next[collectionId];
    else next[collectionId] = value;
    onUpdate({
      modeOverrides: Object.keys(next).length > 0 ? next : undefined,
      themeOverride: undefined,
    } as Partial<SceneNode>);
  };

  return (
    <PropertySection title={onlyTheme ? "Theme" : "Modes"}>
      {pickable.map((c) => (
        <SelectInput
          key={c.id}
          label={onlyTheme ? undefined : c.name}
          ariaLabel={c.name}
          value={overrides[c.id] ?? INHERIT}
          options={[{ value: INHERIT, label: "Inherit" }, ...c.modes.map((m) => ({ value: m.id, label: m.name }))]}
          onChange={(v) => pick(c.id, v)}
        />
      ))}
    </PropertySection>
  );
}
