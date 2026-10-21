import { Kbd } from "@/components/ui/kbd";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useDevModeStore, type CodegenFormat, type CodegenReactStyle, type InspectUnits } from "@/store/devModeStore";
import { useGuidesStore } from "@/store/guidesStore";
import { usePixelGridStore } from "@/store/pixelGridStore";

import { SettingsGroup, SettingsSection, SettingsSubheading } from "../SettingsSection";

const UNIT_OPTIONS = [
  { value: "px", label: "px" },
  { value: "rem", label: "rem" },
] as const;
const FORMAT_OPTIONS = [
  { value: "css", label: "CSS" },
  { value: "tailwind", label: "Tailwind" },
  { value: "react", label: "React" },
] as const;
const REACT_STYLE_OPTIONS = [
  { value: "inline", label: "Inline styles" },
  { value: "tailwind", label: "Tailwind" },
] as const;

export function CanvasSection() {
  const showPixelGrid = usePixelGridStore((s) => s.showPixelGrid);
  const showRulers = useGuidesStore((s) => s.showRulers);
  const dev = useDevModeStore();

  return (
    <SettingsSection title="Canvas">
      <SettingsGroup inline title="Pixel grid" description="Draw a grid between pixels when zoomed in far enough.">
        <Switch
          aria-label="Pixel grid"
          checked={showPixelGrid}
          onCheckedChange={() => usePixelGridStore.getState().togglePixelGrid()}
        />
      </SettingsGroup>
      <SettingsGroup
        inline
        title="Rulers"
        description={
          <>
            Show rulers on the canvas edges. Shortcut <Kbd>Shift</Kbd> <Kbd>R</Kbd>
          </>
        }
      >
        <Switch aria-label="Rulers" checked={showRulers} onCheckedChange={(next) => useGuidesStore.getState().setShowRulers(next)} />
      </SettingsGroup>

      <SettingsSubheading>Dev mode</SettingsSubheading>
      <SettingsGroup inline title="Units" description="Unit used for measurements in the inspector.">
        <SegmentedControl<InspectUnits> aria-label="Units" options={UNIT_OPTIONS} value={dev.units} onValueChange={dev.setUnits} />
      </SettingsGroup>
      <SettingsGroup inline title="Rem base" description="Pixels per 1rem when units are rem.">
        <Input
          aria-label="Rem base"
          type="number"
          min={1}
          step={1}
          defaultValue={dev.remBase}
          key={dev.remBase}
          className="w-20"
          onBlur={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value) && value > 0) dev.setRemBase(value);
            else e.target.value = String(dev.remBase);
          }}
        />
      </SettingsGroup>
      <SettingsGroup inline title="Code format" description="Language of the generated code snippet.">
        <SegmentedControl<CodegenFormat>
          aria-label="Code format"
          options={FORMAT_OPTIONS}
          value={dev.codegenFormat}
          onValueChange={dev.setCodegenFormat}
        />
      </SettingsGroup>
      <SettingsGroup inline title="React style" description="How React snippets carry their styles.">
        <SegmentedControl<CodegenReactStyle>
          aria-label="React style"
          options={REACT_STYLE_OPTIONS}
          value={dev.codegenReactStyle}
          onValueChange={dev.setCodegenReactStyle}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}
