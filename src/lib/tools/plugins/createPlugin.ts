import { usePluginStore } from "@/store/pluginStore";
import type { ToolHandler } from "../../toolRegistry";
import { normalizeIcon, parseUiArg, validateCodeLength } from "./shared";

/**
 * create_plugin — install a new AI-authored plugin (client-executed tool;
 * see the backend `plugin` skill for the pen.* API the agent writes `code`
 * against). Validation mirrors the backend zod schema defensively (a
 * misbehaving model could still send a malformed payload): non-empty
 * name/description/code, code size cap, and a well-formed `ui`/`icon`.
 */
export const createPlugin: ToolHandler = async (args) => {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const description = typeof args.description === "string" ? args.description.trim() : "";
  const code = typeof args.code === "string" ? args.code : "";

  if (!name) return JSON.stringify({ error: "name is required" });
  if (!description) return JSON.stringify({ error: "description is required" });
  if (!code) return JSON.stringify({ error: "code is required" });
  const codeLengthError = validateCodeLength(code);
  if (codeLengthError) return JSON.stringify({ error: codeLengthError });

  const icon = normalizeIcon(args.icon);
  if (icon === "invalid") {
    return JSON.stringify({ error: "icon must be a string (single emoji) or omitted" });
  }

  const ui = parseUiArg(args.ui);
  if (ui === "invalid") {
    return JSON.stringify({
      error: "ui must be {width, height} (positive numbers) or null/omitted for a headless plugin",
    });
  }

  const plugin = await usePluginStore.getState().install({
    name,
    description,
    icon,
    code,
    ui,
    source: "ai",
  });

  return `plugin installed: ${plugin.id} "${plugin.name}". User can run it from the command palette or plugins panel.`;
};
