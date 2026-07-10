import { useState } from "react";
import type { ImageAdjustments, ImageCropRect, ImageFillMode, SceneNode } from "@/types/scene";
import { NumberInput, SelectInput } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Slider } from "@/components/ui/slider";
import { CropIcon } from "@phosphor-icons/react";
import { useFileUpload } from "@/components/properties/useFileUpload";
import { FileUploadControl } from "@/components/properties/FileUploadControl";
import { FULL_CROP_RECT, clampCropRect, isFullCropRect, cropRectToBackgroundCss } from "@/lib/imageCrop/cropRect";
import {
  DEFAULT_ADJUSTMENTS,
  clampAdjustments,
  isDefaultAdjustments,
  adjustmentsToCssFilter,
} from "@/lib/imageAdjustments/imageAdjustments";
import { imageModeToCssSize } from "@/lib/cssBackground";

type EditableImageFill = {
  url: string;
  mode: ImageFillMode;
  crop?: ImageCropRect;
  adjustments?: ImageAdjustments;
};

const ADJUSTMENT_ROWS: Array<{ key: keyof ImageAdjustments; label: string }> = [
  { key: "brightness", label: "Brightness" },
  { key: "contrast", label: "Contrast" },
  { key: "saturation", label: "Saturation" },
  { key: "temperature", label: "Temperature" },
  { key: "tint", label: "Tint" },
];

function ImageAdjustmentSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="truncate text-xs leading-none text-text-primary">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <Slider
          value={value}
          min={-100}
          max={100}
          step={1}
          getAriaLabel={() => label}
          onValueChange={(next) => onChange(Array.isArray(next) ? next[0] ?? 0 : next)}
        />
        <span className="flex h-6 w-9 shrink-0 items-center justify-end rounded-md bg-secondary px-2 text-xs leading-none tabular-nums text-secondary-foreground">
          {value}
        </span>
      </div>
    </div>
  );
}

export function ImageFillEditor({
  imageFill,
  onUpdate,
}: {
  imageFill?: EditableImageFill | undefined;
  onUpdate: (updates: Partial<SceneNode>) => void;
}) {
  const [cropEditorOpen, setCropEditorOpen] = useState(false);
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

  const handleCropChange = (crop: ImageCropRect) => {
    if (!imageFill) return;
    onUpdate({
      imageFill: { ...imageFill, crop: clampCropRect(crop) },
    } as Partial<SceneNode>);
  };

  const handleResetCrop = () => {
    if (!imageFill) return;
    onUpdate({
      imageFill: { ...imageFill, crop: undefined },
    } as Partial<SceneNode>);
  };

  const handleAdjustmentChange = (key: keyof ImageAdjustments, value: number) => {
    if (!imageFill) return;
    const next = clampAdjustments({ ...(imageFill.adjustments ?? DEFAULT_ADJUSTMENTS), [key]: value });
    onUpdate({
      imageFill: { ...imageFill, adjustments: next },
    } as Partial<SceneNode>);
  };

  const handleResetAdjustments = () => {
    if (!imageFill) return;
    onUpdate({
      imageFill: { ...imageFill, adjustments: undefined },
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

  const crop = imageFill.crop ?? FULL_CROP_RECT;
  const cropped = !isFullCropRect(imageFill.crop);
  const adjustments = imageFill.adjustments ?? DEFAULT_ADJUSTMENTS;

  // `object-fit: none` (the previous approach) does not actually zoom into a
  // crop per the CSS spec, so it never rendered the crop correctly. Use the
  // same background-image + cropRectToBackgroundCss technique as HTML export
  // (`designToHtml/styleGeneration.ts`) for a faithful-enough preview, and
  // layer on a CSS `filter` approximation of the adjustments.
  const { size: previewSize, position: previewPosition } = cropped
    ? cropRectToBackgroundCss(imageFill.crop)
    : { size: imageModeToCssSize(imageFill.mode), position: imageFill.mode === "stretch" ? "0% 0%" : "center" };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <div className="group/image-preview relative overflow-hidden rounded border border-border-light bg-secondary">
        <div
          role="img"
          aria-label="Fill preview"
          className="h-20 w-full"
          style={{
            backgroundImage: `url("${imageFill.url}")`,
            backgroundSize: previewSize,
            backgroundPosition: previewPosition,
            backgroundRepeat: "no-repeat",
            filter: adjustmentsToCssFilter(imageFill.adjustments),
          }}
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover/image-preview:opacity-100 group-focus-within/image-preview:opacity-100">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            className="pointer-events-auto w-auto shrink-0 opacity-100 shadow-sm hover:opacity-100 focus-visible:opacity-100"
          >
            Replace Image
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <SelectInput
          label="Mode"
          value={imageFill.mode}
          options={[
            { value: "fill", label: "Fill (Cover)" },
            { value: "fit", label: "Fit (Contain)" },
            { value: "stretch", label: "Stretch" },
          ]}
          onChange={handleModeChange}
          labelClassName="text-xs font-normal"
        />
        <IconButton
          type="button"
          size="icon-sm"
          variant={cropEditorOpen ? "default" : "ghost"}
          onClick={() => setCropEditorOpen((v) => !v)}
          tooltip="Crop image"
        >
          <CropIcon />
        </IconButton>
      </div>

      {cropped && (
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={handleResetCrop}>
            Reset Crop
          </Button>
        </div>
      )}

      {cropEditorOpen && (
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Left"
            value={Math.round(crop.x * 100)}
            onChange={(v) => handleCropChange({ ...crop, x: v / 100 })}
            min={0}
            max={99}
            step={1}
            labelOutside
          />
          <NumberInput
            label="Top"
            value={Math.round(crop.y * 100)}
            onChange={(v) => handleCropChange({ ...crop, y: v / 100 })}
            min={0}
            max={99}
            step={1}
            labelOutside
          />
          <NumberInput
            label="Width"
            value={Math.round(crop.width * 100)}
            onChange={(v) => handleCropChange({ ...crop, width: v / 100 })}
            min={1}
            max={100}
            step={1}
            labelOutside
          />
          <NumberInput
            label="Height"
            value={Math.round(crop.height * 100)}
            onChange={(v) => handleCropChange({ ...crop, height: v / 100 })}
            min={1}
            max={100}
            step={1}
            labelOutside
          />
        </div>
      )}

      <div className="-mx-3 flex flex-col gap-2 border-t border-border-default px-3 pt-3">
        <div className="flex flex-col gap-2">
          {ADJUSTMENT_ROWS.map(({ key, label }) => (
            <ImageAdjustmentSlider
              key={key}
              label={label}
              value={adjustments[key]}
              onChange={(value) => handleAdjustmentChange(key, value)}
            />
          ))}
        </div>
        {!isDefaultAdjustments(imageFill.adjustments) && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            onClick={handleResetAdjustments}
          >
            Reset
          </Button>
        )}
      </div>

    </div>
  );
}
