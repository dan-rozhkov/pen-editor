import { useRef, useState } from "react";
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
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgError(null);
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

  const handleRemoveBackground = async () => {
    if (!imageFill?.url) {
      setBgError("Add an image before removing its background.");
      return;
    }
    setIsRemovingBg(true);
    setBgError(null);
    try {
      // Lazy-loaded: onnxruntime-web + model weights are only fetched here,
      // on first actual use, never at app/module load time.
      const { removeBackground, blobToDataUrl } = await import(
        "@/lib/backgroundRemoval"
      );
      const resultBlob = await removeBackground(imageFill.url);
      const dataUrl = await blobToDataUrl(resultBlob);
      onUpdate({
        imageFill: { url: dataUrl, mode: imageFill.mode },
      } as Partial<SceneNode>);
    } catch (err) {
      setBgError(
        err instanceof Error ? err.message : "Failed to remove background.",
      );
    } finally {
      setIsRemovingBg(false);
    }
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
          <div className="w-full h-20 rounded border border-border-light overflow-hidden bg-secondary">
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

          <Button
            onClick={handleRemoveBackground}
            variant="secondary"
            className="w-full"
            disabled={isRemovingBg}
          >
            {isRemovingBg ? "Removing background…" : "Remove Background"}
          </Button>

          {bgError && (
            <span className="text-xs text-destructive" role="alert">
              {bgError}
            </span>
          )}
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
