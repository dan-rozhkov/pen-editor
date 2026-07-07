import { useRef } from "react";
import type { PatternFill } from "@/types/scene";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/PropertyInputs";

/**
 * Editor for a pattern paint's tile source + tiling params. Scale and row
 * offset are edited as percentages (model stores factors 0-1/1=100%);
 * spacing/offset are px.
 */
export function PatternFillEditor({
  pattern,
  onChange,
}: {
  pattern: PatternFill;
  onChange: (next: PatternFill) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onChange({ ...pattern, url: reader.result as string });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {pattern.url ? (
        <div className="flex flex-col gap-2">
          <div className="w-full h-20 rounded border border-border-light overflow-hidden bg-secondary">
            <img
              src={pattern.url}
              alt="Tile preview"
              className="w-full h-full object-contain"
            />
          </div>

          <NumberInput
            label="Scale"
            labelOutside
            value={Math.round((pattern.scale ?? 1) * 100)}
            min={1}
            onChange={(v) => onChange({ ...pattern, scale: Math.max(1, v) / 100 })}
          />
          <div className="flex gap-1">
            <NumberInput
              label="Gap X"
              labelOutside
              value={pattern.spacingX ?? 0}
              min={0}
              onChange={(v) => onChange({ ...pattern, spacingX: Math.max(0, v) })}
            />
            <NumberInput
              label="Gap Y"
              labelOutside
              value={pattern.spacingY ?? 0}
              min={0}
              onChange={(v) => onChange({ ...pattern, spacingY: Math.max(0, v) })}
            />
          </div>
          <div className="flex gap-1">
            <NumberInput
              label="Offset X"
              labelOutside
              value={pattern.offsetX ?? 0}
              onChange={(v) => onChange({ ...pattern, offsetX: v })}
            />
            <NumberInput
              label="Offset Y"
              labelOutside
              value={pattern.offsetY ?? 0}
              onChange={(v) => onChange({ ...pattern, offsetY: v })}
            />
          </div>
          <NumberInput
            label="Row offset"
            labelOutside
            value={Math.round((pattern.rowOffset ?? 0) * 100)}
            min={0}
            max={100}
            onChange={(v) =>
              onChange({ ...pattern, rowOffset: Math.min(100, Math.max(0, v)) / 100 })
            }
          />

          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="secondary"
            className="w-full"
          >
            Replace Tile
          </Button>
        </div>
      ) : (
        <Button
          onClick={() => fileInputRef.current?.click()}
          variant="secondary"
          className="w-full"
        >
          Upload Tile
        </Button>
      )}
    </>
  );
}
