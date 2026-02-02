import { useRef } from "react";
import type { ImageFillMode, SceneNode } from "@/types/scene";
import { Button } from "@/components/ui/button";
import { SelectInput } from "@/components/ui/PropertyInputs";

export function ImageFillEditor({
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

  const handleModeChange = (mode: string) => {
    if (!imageFill) return;
    onUpdate({
      imageFill: { ...imageFill, mode: mode as ImageFillMode },
    } as Partial<SceneNode>);
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

      {imageFill?.url ? (
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

          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="secondary"
            className="w-full"
          >
            Replace Image
          </Button>
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
    </>
  );
}
