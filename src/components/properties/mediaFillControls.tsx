import type { ReactNode, RefObject } from "react";
import type { ImageCropRect, ImageFillMode } from "@/types/scene";
import { NumberInput, SelectInput } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { CropIcon } from "@phosphor-icons/react";

/**
 * The 4-field crop grid (Left/Top/Width/Height) shared verbatim between the
 * image and video fill editors. `crop` is normalized 0-1 (model space);
 * the inputs display/accept percentages, hence the `v/100` ⇄ `* 100`
 * conversions.
 */
export function CropRectGrid({
  crop,
  onChange,
}: {
  crop: ImageCropRect;
  onChange: (next: ImageCropRect) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberInput
        label="Left"
        value={Math.round(crop.x * 100)}
        onChange={(v) => onChange({ ...crop, x: v / 100 })}
        min={0}
        max={99}
        step={1}
        labelOutside
      />
      <NumberInput
        label="Top"
        value={Math.round(crop.y * 100)}
        onChange={(v) => onChange({ ...crop, y: v / 100 })}
        min={0}
        max={99}
        step={1}
        labelOutside
      />
      <NumberInput
        label="Width"
        value={Math.round(crop.width * 100)}
        onChange={(v) => onChange({ ...crop, width: v / 100 })}
        min={1}
        max={100}
        step={1}
        labelOutside
      />
      <NumberInput
        label="Height"
        value={Math.round(crop.height * 100)}
        onChange={(v) => onChange({ ...crop, height: v / 100 })}
        min={1}
        max={100}
        step={1}
        labelOutside
      />
    </div>
  );
}

/**
 * The Mode selector + crop-toggle icon button row shared between the image
 * and video fill editors.
 */
export function MediaModeRow({
  mode,
  onModeChange,
  cropEditorOpen,
  onToggleCropEditor,
  cropTooltip,
}: {
  mode: ImageFillMode;
  onModeChange: (mode: string) => void;
  cropEditorOpen: boolean;
  onToggleCropEditor: () => void;
  cropTooltip: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <SelectInput
        label="Mode"
        value={mode}
        options={[
          { value: "fill", label: "Fill (Cover)" },
          { value: "fit", label: "Fit (Contain)" },
          { value: "stretch", label: "Stretch" },
        ]}
        onChange={onModeChange}
        labelClassName="text-xs font-normal"
      />
      <IconButton
        type="button"
        size="icon-sm"
        variant={cropEditorOpen ? "default" : "ghost"}
        onClick={onToggleCropEditor}
        tooltip={cropTooltip}
      >
        <CropIcon />
      </IconButton>
    </div>
  );
}

/**
 * The mode row + "Reset Crop" button + crop grid, shared between the image
 * and video fill editors: `MediaModeRow` (with its crop-toggle icon button),
 * a conditional "Reset Crop" button when the crop isn't the full rect, and
 * the `CropRectGrid` when the crop editor is open.
 */
export function MediaCropControls({
  mode,
  onModeChange,
  cropEditorOpen,
  onToggleCropEditor,
  cropTooltip,
  cropped,
  crop,
  onCropChange,
  onResetCrop,
}: {
  mode: ImageFillMode;
  onModeChange: (mode: string) => void;
  cropEditorOpen: boolean;
  onToggleCropEditor: () => void;
  cropTooltip: string;
  cropped: boolean;
  crop: ImageCropRect;
  onCropChange: (next: ImageCropRect) => void;
  onResetCrop: () => void;
}) {
  return (
    <>
      <MediaModeRow
        mode={mode}
        onModeChange={onModeChange}
        cropEditorOpen={cropEditorOpen}
        onToggleCropEditor={onToggleCropEditor}
        cropTooltip={cropTooltip}
      />

      {cropped && (
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onResetCrop}>
            Reset Crop
          </Button>
        </div>
      )}

      {cropEditorOpen && <CropRectGrid crop={crop} onChange={onCropChange} />}
    </>
  );
}

/**
 * The hidden file input + preview container + hover-reveal "Replace …"
 * overlay shared across the image/video/pattern fill editors. `children` is
 * the section-specific inner media element (background-image div, img, or
 * video). The preview container's fixed height (`h-20 w-full`) lives here;
 * per-media object-fit/background sizing stays on `children`.
 *
 * The Tailwind `group/media-preview` name is unified (not parameterized) on
 * purpose: Tailwind's class scanner needs a literal class string per
 * candidate, so building the group name from a template-literal prop would
 * silently drop the hover-reveal utilities from the generated CSS.
 */
export function MediaPreviewReplace({
  fileInputRef,
  onFileSelect,
  accept,
  replaceLabel,
  children,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  accept: string;
  replaceLabel: string;
  children: ReactNode;
}) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onFileSelect}
      />
      <div className="group/media-preview relative h-20 w-full overflow-hidden rounded border border-border-light bg-secondary">
        {children}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover/media-preview:opacity-100 group-focus-within/media-preview:opacity-100">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            className="pointer-events-auto w-auto shrink-0 opacity-100 shadow-sm hover:opacity-100 focus-visible:opacity-100"
          >
            {replaceLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
