import { usePluginStore, type PluginUpdatePatch } from "@/store/pluginStore";
import type { ToolHandler } from "../../toolRegistry";
import { normalizeIcon, parseUiArg, validateCodeLength } from "./shared";

/**
 * update_plugin — patch an existing plugin's code/metadata (the iteration
 * loop: `list_plugins` -> `update_plugin`). Only fields present in `args`
 * are touched; each present field is validated the same way `create_plugin`
 * validates it.
 */
export const updatePlugin: ToolHandler = async (args) => {
  const id = typeof args.id === "string" ? args.id : "";
  if (!id) return JSON.stringify({ error: "id is required" });

  const store = usePluginStore.getState();
  await store.init();
  const existing = usePluginStore.getState().plugins.find((p) => p.id === id);
  if (!existing) return JSON.stringify({ error: `no plugin with id "${id}"` });

  const patch: PluginUpdatePatch = {};

  if (args.name !== undefined) {
    if (typeof args.name !== "string" || !args.name.trim()) {
      return JSON.stringify({ error: "name must be a non-empty string" });
    }
    patch.name = args.name.trim();
  }

  if (args.description !== undefined) {
    if (typeof args.description !== "string" || !args.description.trim()) {
      return JSON.stringify({ error: "description must be a non-empty string" });
    }
    patch.description = args.description.trim();
  }

  if (args.icon !== undefined) {
    const iconResult = normalizeIcon(args.icon);
    if (!iconResult.ok) {
      return JSON.stringify({ error: "icon must be a string (single emoji)" });
    }
    patch.icon = iconResult.icon;
  }

  if (args.code !== undefined) {
    if (typeof args.code !== "string" || !args.code) {
      return JSON.stringify({ error: "code must be a non-empty string" });
    }
    const codeLengthError = validateCodeLength(args.code);
    if (codeLengthError) return JSON.stringify({ error: codeLengthError });
    patch.code = args.code;
  }

  if (args.ui !== undefined) {
    const ui = parseUiArg(args.ui);
    if (ui === "invalid") {
      return JSON.stringify({
        error: "ui must be {width, height} (positive numbers) or null for a headless plugin",
      });
    }
    patch.ui = ui;
  }

  if (Object.keys(patch).length === 0) {
    return JSON.stringify({
      error: "no fields to update: pass at least one of name, description, icon, code, ui",
    });
  }

  await usePluginStore.getState().update(id, patch);
  return `plugin updated: ${id} "${patch.name ?? existing.name}".`;
};
