import { useState } from "react";
import { PlusIcon, MinusIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
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
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props {
  nodeId: string;
  nodeName: string | undefined;
  settings: ExportSetting[];
  onChange: (next: ExportSetting[]) => void;
  /**
   * Skip the built-in `PropertySection` title/border chrome and render just
   * the rows/actions. Used by Dev Mode's `DevExportSection`, whose caller
   * (`InspectPanel`'s collapsible `Section`) already renders an "Export"
   * heading — without this, both would render their own "Export" heading
   * (double header, two `border-b`s). The add-row action (normally the
   * `PropertySection` header's `action` slot) is kept reachable as a small
   * button above the rows instead of being dropped.
   */
  hideHeader?: boolean;
  /** The enclosing section renders the add action in its own header. */
  hideBodyAddAction?: boolean;
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
 * Presentational "Export" panel section (Figma-style): a list of
 * `ExportSetting` rows (format/scale plus advanced options), add/remove per
 * row, an "Export all" button that runs every configured setting, and global
 * presets (save the first row as a reusable preset / apply a saved preset as
 * a new row).
 *
 * The settings source and their mutation are both props (`settings`/
 * `onChange`) rather than a `node`/`onUpdate` pair, so this component has no
 * opinion on *where* settings live — `ExportSettingsSection` (Design mode)
 * wires it to `node.exportSettings` via `onUpdate`, `DevExportSection` (Dev
 * mode, dev-03) wires it to an ephemeral session-only override store instead
 * of mutating the node/`.pen` document. Presets live in `useExportPresetStore`
 * (localStorage) — shared by both, since presets are already outside the
 * document.
 */
export function ExportSettingsList({ nodeId, nodeName, settings, onChange, hideHeader, hideBodyAddAction = false }: Props) {
  const pixiRefs = useCanvasRefStore((s) => s.pixiRefs);
  const presets = useExportPresetStore((s) => s.presets);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleAdd = () => onChange(addExportSetting(settings, createExportSetting()));
  const handleRemove = (id: string) => onChange(removeExportSetting(settings, id));
  const handleChange = (id: string, updates: Partial<Omit<ExportSetting, "id">>) =>
    onChange(updateExportSetting(settings, id, updates));

  const handleApplyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    onChange(
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
      const results = await runExportSettingsForNode(nodeId, nodeName, settings, pixiRefs);
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
    <IconButton variant="ghost" size="icon-sm" onClick={handleAdd} tooltip="Add export setting">
      <PlusIcon />
    </IconButton>
  );

  const body = (
    <>
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
                <PopoverContent
                  side="left"
                  align="start"
                  draggable
                  dragHandleContent={<span className="text-[11px] font-semibold text-text-primary">Export settings</span>}
                >
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
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={() => handleRemove(setting.id)}
                tooltip="Remove export setting"
              >
                <MinusIcon />
              </IconButton>
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
        <Button onClick={handleExportAll} disabled={isExporting} variant="outline" className="w-full min-w-0">
          <span className="min-w-0 truncate">{isExporting ? "Exporting…" : "Export all"}</span>
        </Button>
      )}

      {status && <div className="text-[10px] text-text-muted">{status}</div>}
    </>
  );

  if (hideHeader) {
    return (
      <div className="flex flex-col gap-2 px-3 pb-2">
        {!hideBodyAddAction && <div className="flex justify-end">{action}</div>}
        {body}
      </div>
    );
  }

  return (
    <PropertySection title="Export" action={action}>
      {body}
    </PropertySection>
  );
}
