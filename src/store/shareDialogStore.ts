import { create } from "zustand";

/**
 * Whether the "Share…" dialog is open. Split out from `shareStore.ts` (which
 * owns network status, not UI visibility) so both the File menu item
 * (Toolbar.tsx) and the `file-share` palette command (shareCommands.ts) can
 * open the same dialog instance without prop drilling or a second dialog
 * mount.
 */
interface ShareDialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useShareDialogStore = create<ShareDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
