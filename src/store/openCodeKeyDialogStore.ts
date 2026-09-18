import { create } from "zustand";

/**
 * Whether the OpenCode BYOK key dialog (OpenCodeKeyDialog.tsx) is open.
 * Split out from the chat model picker's own local state (ChatPanel.tsx)
 * so the `file-connect-opencode` palette command can open the same dialog
 * instance without prop drilling — the same reasoning as
 * shareDialogStore.ts for `file-share`.
 */
interface OpenCodeKeyDialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useOpenCodeKeyDialogStore = create<OpenCodeKeyDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
