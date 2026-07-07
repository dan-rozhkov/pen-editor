import type { ImageFillMode, SceneNode } from "@/types/scene";
import { SelectInput } from "@/components/ui/PropertyInputs";
import { useFileUpload } from "@/components/properties/useFileUpload";
import { FileUploadControl } from "@/components/properties/FileUploadControl";

export function ImageFillEditor({
  imageFill,
  onUpdate,
}: {
  imageFill?: { url: string; mode: ImageFillMode } | undefined;
  onUpdate: (updates: Partial<SceneNode>) => void;
}) {
  const { fileInputRef, handleFileSelect } = useFileUpload((dataUrl) => {
    onUpdate({
      imageFill: { url: dataUrl, mode: imageFill?.mode ?? "fill" },
    } as Partial<SceneNode>);
  });

  const handleModeChange = (mode: string) => {
    if (!imageFill) return;
    onUpdate({
      imageFill: { ...imageFill, mode: mode as ImageFillMode },
    } as Partial<SceneNode>);
  };

  if (!imageFill?.url) {
    return (
      <FileUploadControl
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
        hasValue={false}
        uploadLabel="Upload Image"
        replaceLabel="Replace Image"
      />
    );
  }

  return (
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

      <FileUploadControl
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
        hasValue
        uploadLabel="Upload Image"
        replaceLabel="Replace Image"
      />
    </div>
  );
}
