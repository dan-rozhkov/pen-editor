import type { Surface } from "@sideform/agent-harness/surface";
import { browserSurface } from "./browserSurface";
import { canvasSurface } from "./canvasSurface";
import type { ToolExecutionContext } from "./toolTypes";

export { sharedTools } from "./sharedTools";
export type { ToolExecutionContext, ToolHandler } from "./toolTypes";

/**
 * Every surface of the app WITH its tool map. Imported by `lib/toolRegistry`
 * only; everything else (store, switcher, commands, App) uses `./meta`, which
 * has no tool imports. To add one: create `<name>Surface.ts` that spreads a
 * meta entry from `./meta`, add the tool map, and append it here and to
 * `SURFACE_METAS`.
 */
export const SURFACES = [canvasSurface, browserSurface] as const;

export function getSurface(id: (typeof SURFACES)[number]["id"]): Surface<ToolExecutionContext> {
  const surface = SURFACES.find((s) => s.id === id);
  if (!surface) throw new Error(`Unknown surface: ${id}`);
  return surface;
}
