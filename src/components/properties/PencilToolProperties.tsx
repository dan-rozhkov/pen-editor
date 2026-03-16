import { useDrawModeStore } from "@/store/drawModeStore";
import type { PencilSettings } from "@/store/drawModeStore";
import {
  PropertySection,
  PropertyRow,
  NumberInput,
  ColorInput,
} from "@/components/ui/PropertyInputs";

export function PencilToolProperties() {
  const pencilSettings = useDrawModeStore((s) => s.pencilSettings);
  const setPencilSettings = useDrawModeStore((s) => s.setPencilSettings);

  const update = (updates: Partial<PencilSettings>) => setPencilSettings(updates);

  return (
    <PropertySection title="Stroke">
      <ColorInput
        value={pencilSettings.color}
        onChange={(color) => update({ color })}
      />
      <PropertyRow>
        <NumberInput
          label="T"
          value={pencilSettings.thickness}
          onChange={(thickness) => update({ thickness })}
          min={1}
          max={100}
          step={1}
        />
        <NumberInput
          label="%"
          value={Math.round(pencilSettings.opacity * 100)}
          onChange={(v) => update({ opacity: v / 100 })}
          min={0}
          max={100}
          step={1}
        />
      </PropertyRow>
    </PropertySection>
  );
}
