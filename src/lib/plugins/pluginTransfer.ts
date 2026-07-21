import { sanitizeFilename } from "@/lib/chatExport";
import { saveBlob } from "@/lib/downloadFile";
import type { PenPlugin } from "@/lib/plugins/types";
import type { PluginInstallInput } from "@/store/pluginStore";

/** Shape we accept on import: the required `PenPlugin` fields, everything
 * else (id/timestamps/source) is optional — `id` (if present and not
 * colliding with an installed plugin) round-trips our own exports back to
 * the same record; `pluginStore.install` assigns a fresh id otherwise. */
function isImportablePlugin(
  value: unknown,
): value is Partial<PenPlugin> & Pick<PenPlugin, "name" | "description" | "code"> {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" && typeof v.description === "string" && typeof v.code === "string";
}

export type PluginImportResult =
  | { ok: true; input: PluginInstallInput }
  | { ok: false; reason: "invalid-json" | "invalid-shape" };

/**
 * Parse a plugin export file's text into `pluginStore.install`'s input
 * shape, or report why it was rejected. Pure (no toasts, no store access) —
 * the caller (the manager panel) decides what to show and calls `install`.
 */
export function parsePluginImport(json: string): PluginImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (!isImportablePlugin(parsed)) return { ok: false, reason: "invalid-shape" };
  return {
    ok: true,
    input: {
      name: parsed.name,
      description: parsed.description,
      code: parsed.code,
      icon: parsed.icon,
      ui: parsed.ui,
      source: "imported",
      // `install` dedupes: a colliding id (or none) is replaced with a fresh
      // one, an id from our own export round-trips back to the same record.
      id: parsed.id,
    },
  };
}

/** Serialize a plugin to JSON and trigger a browser download of it. */
export function exportPluginToFile(plugin: PenPlugin): void {
  const blob = new Blob([JSON.stringify(plugin, null, 2)], { type: "application/json" });
  saveBlob(blob, `${sanitizeFilename(plugin.name)}.json`);
}
