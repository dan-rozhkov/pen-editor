import { create } from "zustand";

/** Open/closed state for the plugin manager panel, mirroring
 * `commandPaletteStore` — toggled from the "Manage plugins…" palette command
 * and read by `PluginManagerPanel`, which is mounted once at the app root. */
interface PluginManagerState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const usePluginManagerStore = create<PluginManagerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
