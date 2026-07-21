import { create } from "zustand";
import { generateId } from "@/types/scene";
import type { PenPlugin } from "@/lib/plugins/types";
import { stopPlugin } from "@/lib/plugins/pluginHost";
import { deletePlugin, getAllPlugins, putPlugin } from "@/utils/pluginDb";

/** Fields the caller of `install` supplies; `id` is optional (assigned/deduped
 * here) and `createdAt`/`updatedAt` are always stamped fresh. */
export type PluginInstallInput = Omit<PenPlugin, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export type PluginUpdatePatch = Partial<
  Pick<PenPlugin, "name" | "description" | "icon" | "code" | "ui">
>;

interface PluginStoreState {
  plugins: PenPlugin[];
  hydrated: boolean;
  /** Hydrate `plugins` from IndexedDB. Safe to call more than once — a no-op
   * after the first successful run. */
  init: () => Promise<void>;
  /** Persist a new plugin. If `id` is omitted or collides with an already
   * installed plugin, a fresh id is generated instead of overwriting. */
  install: (input: PluginInstallInput) => Promise<PenPlugin>;
  update: (id: string, patch: PluginUpdatePatch) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * In-memory metadata list for installed plugins, hydrated from `pluginDb` on
 * init. Metadata-only mutations here never affect canvas rendering (running
 * a plugin mutates the scene through the existing tool handlers, whose own
 * stores already schedule a repaint), so this store is deliberately NOT
 * subscribed in `renderScheduler.ts`'s markActivity allowlist.
 */
export const usePluginStore = create<PluginStoreState>((set, get) => ({
  plugins: [],
  hydrated: false,

  init: async () => {
    if (get().hydrated) return;
    const plugins = await getAllPlugins();
    set({ plugins, hydrated: true });
  },

  install: async (input) => {
    const existingIds = new Set(get().plugins.map((p) => p.id));
    const id = input.id && !existingIds.has(input.id) ? input.id : generateId();
    const now = Date.now();
    const plugin: PenPlugin = { ...input, id, createdAt: now, updatedAt: now };
    await putPlugin(plugin);
    set((s) => ({ plugins: [...s.plugins.filter((p) => p.id !== id), plugin] }));
    return plugin;
  },

  update: async (id, patch) => {
    const current = get().plugins.find((p) => p.id === id);
    if (!current) return;
    const updated: PenPlugin = { ...current, ...patch, updatedAt: Date.now() };
    await putPlugin(updated);
    set((s) => ({ plugins: s.plugins.map((p) => (p.id === id ? updated : p)) }));
  },

  rename: async (id, name) => {
    await get().update(id, { name });
  },

  remove: async (id) => {
    stopPlugin(id);
    await deletePlugin(id);
    set((s) => ({ plugins: s.plugins.filter((p) => p.id !== id) }));
  },
}));
