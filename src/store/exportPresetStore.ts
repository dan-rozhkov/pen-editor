import { create } from "zustand";
import type { ExportSetting, ExportSettingFormat } from "@/types/scene";
import { generateId } from "@/types/scene";

const STORAGE_KEY = "export-presets";

/** A named, reusable export configuration — global, not tied to any node/`.pen` file. */
export interface ExportPreset {
  id: string;
  name: string;
  format: ExportSettingFormat;
  scale: number;
  suffix?: string;
  quality?: number;
}

const VALID_FORMATS: ExportSettingFormat[] = ["svg", "png", "jpg", "webp", "pdf"];

function isValidPreset(value: unknown): value is ExportPreset {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.scale === "number" &&
    typeof p.format === "string" &&
    VALID_FORMATS.includes(p.format as ExportSettingFormat)
  );
}

function readPersisted(): ExportPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPreset);
  } catch {
    return [];
  }
}

function persist(presets: ExportPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

interface ExportPresetState {
  presets: ExportPreset[];
  addPreset: (preset: Omit<ExportPreset, "id">) => ExportPreset;
  removePreset: (id: string) => void;
  updatePreset: (id: string, updates: Partial<Omit<ExportPreset, "id">>) => void;
  /** Build an `ExportSetting` (fresh id, no `name`) from a saved preset, for applying to a node. */
  toExportSetting: (presetId: string) => ExportSetting | null;
}

export const useExportPresetStore = create<ExportPresetState>((set, get) => ({
  presets: readPersisted(),

  addPreset: (preset) => {
    const created: ExportPreset = { ...preset, id: generateId() };
    const next = [...get().presets, created];
    set({ presets: next });
    persist(next);
    return created;
  },

  removePreset: (id) => {
    const next = get().presets.filter((p) => p.id !== id);
    set({ presets: next });
    persist(next);
  },

  updatePreset: (id, updates) => {
    const next = get().presets.map((p) => (p.id === id ? { ...p, ...updates } : p));
    set({ presets: next });
    persist(next);
  },

  toExportSetting: (presetId) => {
    const preset = get().presets.find((p) => p.id === presetId);
    if (!preset) return null;
    return {
      id: generateId(),
      format: preset.format,
      scale: preset.scale,
      suffix: preset.suffix,
      quality: preset.quality,
    };
  },
}));
