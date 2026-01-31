import { useRef } from "react";
import type { ImageFillMode, SceneNode } from "@/types/scene";
import { Button } from "@/components/ui/button";
import { PropertySection, SelectInput } from "@/components/ui/PropertyInputs";

export function ImageFillSection({
  imageFill,
  onUpdate,
}: {
  imageFill?: { url: string; mode: ImageFillMode } | undefined;
  onUpdate: (updates: Partial<SceneNode>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onUpdate({
        imageFill: { url: dataUrl, mode: imageFill?.mode ?? "fill" },
      } as Partial<SceneNode>);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRemove = () => {
    onUpdate({ imageFill: undefined } as Partial<SceneNode>);
  };

  const handleModeChange = (mode: string) => {
    if (!imageFill) return;
    onUpdate({
      imageFill: { ...imageFill, mode: mode as ImageFillMode },
    } as Partial<SceneNode>);
  };

  return (
    <PropertySection title="Image Fill">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {imageFill ? (
        <div className="flex flex-col gap-2">
          <div className="w-full h-20 rounded border border-border-light overflow-hidden bg-surface-elevated">
            <img
              src={imageFill.url}
              alt="Fill preview"
              className="w-full h-full object-cover"
            />
          </div>

          <SelectInput
            label="Mode"
            value={imageFill.mode}
            options={[
              { value: "fill", label: "Fill (Cover)" },
              { value: "fit", label: "Fit (Contain)" },
              { value: "stretch", label: "Stretch" },
            ]}
            onChange={handleModeChange}
          />

          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
            >
              Replace
            </button>
            <button
              onClick={handleRemove}
              className="flex-1 px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-red-400 text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => fileInputRef.current?.click()}
          variant="secondary"
          className="w-full"
        >
          Upload Image
        </Button>
      )}
    </PropertySection>
  );
}
