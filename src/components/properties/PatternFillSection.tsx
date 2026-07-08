import type { PatternFill } from "@/types/scene";
import { NumberInput } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { useFileUpload } from "@/components/properties/useFileUpload";
import { FileUploadControl } from "@/components/properties/FileUploadControl";

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
  const { fileInputRef, handleFileSelect } = useFileUpload((dataUrl) => {
    onChange({ ...pattern, url: dataUrl });
  });

  if (!pattern.url) {
    return (
      <FileUploadControl
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
        hasValue={false}
        uploadLabel="Upload Tile"
        replaceLabel="Replace Tile"
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <div className="group/pattern-preview relative h-20 w-full overflow-hidden rounded border border-border-light bg-secondary">
        <img
          src={pattern.url}
          alt="Tile preview"
          className="h-full w-full object-contain"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover/pattern-preview:opacity-100 group-focus-within/pattern-preview:opacity-100">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            className="pointer-events-auto w-auto shrink-0 opacity-100 shadow-sm hover:opacity-100 focus-visible:opacity-100"
          >
            Replace Tile
          </Button>
        </div>
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

    </div>
  );
}
