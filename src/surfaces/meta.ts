import { isDesktopBrowserAvailable } from "@/lib/tools/browser/desktopBrowser";

/**
 * Surface metadata: id, title, availability. Kept apart from the tool maps (canvasSurface.ts / browserSurface.ts) on
 * purpose. The tool modules import `lib/tools/*`, and some of those reach
 * `toolRegistry` again (pluginApi), so anything that imports the tool maps is
 * pulled into that import cycle. The store, switcher, palette commands and
 * App only need this file, and the tool maps are imported by `toolRegistry`
 * alone. It is also on the embed entry's graph (the keyboard code reads the
 * surface store), so it must stay light: Views live in `./views`, the agent
 * context builder in `./canvasContext`. Do NOT import a tool handler,
 * `toolRegistry`, a tool map, a View or a chat/cloud-browser module here.
 */
export interface SurfaceMeta {
  id: string;
  title: string;
  /** False when the surface cannot work in this environment. Default: true. */
  isAvailable?: () => boolean;
}

export const canvasMeta = {
  id: "canvas" as const,
  title: "Canvas",
} satisfies SurfaceMeta;

export const browserMeta = {
  id: "browser" as const,
  title: "Browser",
  // The desktop shell shows the browser as its own tab; there is nothing to
  // show in the main area.
  isAvailable: () => !isDesktopBrowserAvailable(),
} satisfies SurfaceMeta;

export type SurfaceId = (typeof canvasMeta | typeof browserMeta)["id"];

export type TypedSurfaceMeta = SurfaceMeta & { id: SurfaceId };

export const SURFACE_METAS: readonly TypedSurfaceMeta[] = [canvasMeta, browserMeta];

export const DEFAULT_SURFACE_ID: SurfaceId = "canvas";

export function getSurfaceMeta(id: SurfaceId): TypedSurfaceMeta {
  const meta = SURFACE_METAS.find((s) => s.id === id);
  if (!meta) throw new Error(`Unknown surface: ${id}`);
  return meta;
}

export function isSurfaceAvailable(id: SurfaceId): boolean {
  return getSurfaceMeta(id).isAvailable?.() ?? true;
}

/** The surfaces that can be shown in this environment. */
export function getAvailableSurfaces(): TypedSurfaceMeta[] {
  return SURFACE_METAS.filter((s) => s.isAvailable?.() ?? true);
}
