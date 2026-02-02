import { useState } from "react";
import type { GradientFill, GradientColorStop } from "@/types/scene";
import { GradientBar } from "@/components/ui/GradientBar";
import { CustomColorPicker } from "@/components/ui/ColorPicker";
import { NumberInput } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "@phosphor-icons/react";
import { getGradientAngle, setGradientAngle } from "@/utils/gradientUtils";

interface GradientEditorProps {
  gradient: GradientFill;
  onChange: (gradient: GradientFill) => void;
}

export function GradientEditor({ gradient, onChange }: GradientEditorProps) {
  const [selectedStopIndex, setSelectedStopIndex] = useState(0);

  // Ensure selected index is valid
  const safeIndex = Math.min(selectedStopIndex, gradient.stops.length - 1);
  const selectedStop = gradient.stops[safeIndex];

  const updateStop = (index: number, updates: Partial<GradientColorStop>) => {
    const newStops = gradient.stops.map((s, i) =>
      i === index ? { ...s, ...updates } : s,
    );
    onChange({ ...gradient, stops: newStops });
  };

  const handleMoveStop = (index: number, position: number) => {
    updateStop(index, { position });
  };

  const handleAddStop = (position: number, color: string) => {
    const newStops = [...gradient.stops, { color, position }];
    onChange({ ...gradient, stops: newStops });
    setSelectedStopIndex(newStops.length - 1);
  };

  const handleRemoveStop = () => {
    if (gradient.stops.length <= 2) return;
    const newStops = gradient.stops.filter((_, i) => i !== safeIndex);
    onChange({ ...gradient, stops: newStops });
    setSelectedStopIndex(Math.min(safeIndex, newStops.length - 1));
  };

  const handleColorChange = (hex: string) => {
    updateStop(safeIndex, { color: hex });
  };

  const handlePositionChange = (pct: number) => {
    updateStop(safeIndex, { position: Math.max(0, Math.min(100, pct)) / 100 });
  };

  const angle = gradient.type === "linear" ? getGradientAngle(gradient) : 0;

  const handleAngleChange = (deg: number) => {
    const normalized = ((deg % 360) + 360) % 360;
    onChange(setGradientAngle(gradient, normalized));
  };

  return (
    <div className="flex flex-col gap-2">
      <GradientBar
        stops={gradient.stops}
        selectedIndex={safeIndex}
        onSelectStop={setSelectedStopIndex}
        onMoveStop={handleMoveStop}
        onAddStop={handleAddStop}
      />
      <div className="flex items-center gap-1">
        <CustomColorPicker
          value={selectedStop?.color ?? "#000000"}
          onChange={handleColorChange}
          swatchSize="md"
        />
        <div className="flex-1">
          <NumberInput
            label="Pos %"
            value={Math.round((selectedStop?.position ?? 0) * 100)}
            onChange={handlePositionChange}
            min={0}
            max={100}
            step={1}
          />
        </div>
        <Button
          variant="secondary"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            const pos = gradient.stops.length > 0
              ? (gradient.stops[gradient.stops.length - 1].position + (gradient.stops[0]?.position ?? 0)) / 2
              : 0.5;
            handleAddStop(pos, selectedStop?.color ?? "#888888");
          }}
          title="Add stop"
        >
          <Plus size={12} />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="h-7 w-7"
          onClick={handleRemoveStop}
          disabled={gradient.stops.length <= 2}
          title="Remove stop"
        >
          <Minus size={12} />
        </Button>
      </div>
      {gradient.type === "linear" && (
        <NumberInput
          label="Angle °"
          value={angle}
          onChange={handleAngleChange}
          min={0}
          max={359}
          step={1}
        />
      )}
    </div>
  );
}
