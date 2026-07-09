import { useState } from "react";
import { PlusIcon, MinusIcon, DownloadSimpleIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import type { SceneNode } from "@/types/scene";
import type { ExportSetting } from "@/types/scene";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useExportPresetStore } from "@/store/exportPresetStore";
import {
  createExportSetting,
  addExportSetting,
  removeExportSetting,
  updateExportSetting,
} from "@/utils/exportSettingsUtils";
import { runExportSettingsForNode } from "@/lib/exportSettings/runExportAll";
import { PropertySection, SelectInput, TextInput } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

const FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "webp", label: "WebP" },
  { value: "svg", label: "SVG" },
  { value: "pdf", label: "PDF" },
];

const SCALE_OPTIONS = [
  { value: "0.5", label: "0.5x" },
  { value: "1", label: "1x" },
  { value: "2", label: "2x" },
  { value: "3", label: "3x" },
  { value: "custom", label: "Custom" },
];

function scaleSelectValue(scale: number): string {
  return ["0.5", "1", "2", "3"].includes(String(scale)) ? String(scale) : "custom";
}

/**
 * Per-node "Export" panel section (Figma-style): a list of `ExportSetting`
 * rows (format/scale plus advanced options), add/remove per row, an "Export all" button
 * that runs every configured setting, and global presets (save the first row
 * as a reusable preset / apply a saved preset as a new row). Node mutations
 * go through `onUpdate` like every other property section (`ShaderSection`
 * is the template); presets live in `useExportPresetStore`, persisted to
 * localStorage — NOT part of the node/`.pen` file.
 */
export function ExportSettingsSection({ node, onUpdate }: Props) {
  const pixiRefs = useCanvasRefStore((s) => s.pixiRefs);
  const presets = useExportPresetStore((s) => s.presets);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const settings = node.exportSettings ?? [];

  const setSettings = (next: ExportSetting[]) => onUpdate({ exportSettings: next });

  const handleAdd = () => setSettings(addExportSetting(settings, createExportSetting()));
  const handleRemove = (id: string) => setSettings(removeExportSetting(settings, id));
  const handleChange = (id: string, updates: Partial<Omit<ExportSetting, "id">>) =>
    setSettings(updateExportSetting(settings, id, updates));

  const handleApplyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    setSettings(
      addExportSetting(
        settings,
        createExportSetting({
          format: preset.format,
          scale: preset.scale,
          suffix: preset.suffix,
          quality: preset.quality,
        }),
      ),
    );
  };

  const handleExportAll = async () => {
    if (settings.length === 0) return;
    setIsExporting(true);
    setStatus(null);
    try {
      const results = await runExportSettingsForNode(node.id, node.name, settings, pixiRefs);
      const failed = results.filter((r) => !r.success);
      setStatus(
        failed.length === 0
          ? `Exported ${results.length} file${results.length === 1 ? "" : "s"}.`
          : `Exported ${results.length - failed.length}/${results.length}; ${failed.length} failed.`,
      );
    } finally {
      setIsExporting(false);
    }
  };

  const action = (
    <Button variant="ghost" size="icon-sm" onClick={handleAdd} title="Add export setting">
      <PlusIcon />
    </Button>
  );

  return (
    <PropertySection title="Export" action={action}>
      {settings.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="export-settings-list">
          {settings.map((setting) => (
            <div key={setting.id} className="flex items-center gap-2">
              <div className="flex-1">
                <SelectInput
                  value={setting.format}
                  options={FORMAT_OPTIONS}
                  onChange={(v) => handleChange(setting.id, { format: v as ExportSetting["format"] })}
                />
              </div>
              <div className="flex-1">
                <SelectInput
                  value={scaleSelectValue(setting.scale)}
                  options={SCALE_OPTIONS}
                  onChange={(v) => {
                    if (v === "custom") return;
                    handleChange(setting.id, { scale: Number(v) });
                  }}
                />
              </div>
              <Popover>
                <PopoverTrigger>
                  <Button variant="ghost" size="icon-sm" title="Export settings">
                    <SlidersHorizontalIcon />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="left" align="start">
                  {scaleSelectValue(setting.scale) === "custom" && (
                    <TextInput
                      label="Custom scale"
                      value={String(setting.scale)}
                      onChange={(v) => {
                        const n = Number(v);
                        if (!Number.isNaN(n) && n > 0) handleChange(setting.id, { scale: n });
                      }}
                      placeholder="e.g. 1.5"
                    />
                  )}
                  <TextInput
                    label="Suffix"
                    value={setting.suffix ?? ""}
                    onChange={(v) => handleChange(setting.id, { suffix: v || undefined })}
                    placeholder="@2x, _dark, ..."
                  />
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => handleRemove(setting.id)}
                title="Remove export setting"
              >
                <MinusIcon />
              </Button>
            </div>
          ))}
        </div>
      )}

      {presets.length > 0 && (
        <SelectInput
          label="Apply preset"
          labelOutside
          value=""
          options={presets.map((p) => ({ value: p.id, label: p.name }))}
          onChange={handleApplyPreset}
        />
      )}

      {settings.length > 0 && (
        <Button onClick={handleExportAll} disabled={isExporting} variant="secondary" className="w-full min-w-0">
          <DownloadSimpleIcon />
          <span className="min-w-0 truncate">{isExporting ? "Exporting…" : "Export all"}</span>
        </Button>
      )}

      {status && <div className="text-[10px] text-text-muted">{status}</div>}
    </PropertySection>
  );
}
