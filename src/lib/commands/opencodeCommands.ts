import { hasOpenCodeKey } from "@/lib/opencodeKey";
import { useOpenCodeKeyDialogStore } from "@/store/openCodeKeyDialogStore";
import type { PaletteCommand } from "./types";

/**
 * Opens the OpenCode BYOK key dialog (ChatPanel.tsx's model picker also
 * opens it, from a dropdown item), via the same open/close store —
 * mirrors `file-share` in shareCommands.ts, the existing precedent for a
 * palette command that opens a global dialog through a dedicated Zustand
 * store rather than prop-drilling. Label mirrors the dropdown item's own
 * conditional text (ChatPanel.tsx) so the palette never says "Connect" for
 * a key that is already saved.
 */
export function getOpenCodeCommands(): PaletteCommand[] {
  return [
    {
      id: "file-connect-opencode",
      label: hasOpenCodeKey() ? "OpenCode key" : "Connect OpenCode…",
      group: "File",
      keywords: ["opencode", "byok", "api key", "connect", "model"],
      run: () => {
        useOpenCodeKeyDialogStore.getState().setOpen(true);
      },
    },
  ];
}
