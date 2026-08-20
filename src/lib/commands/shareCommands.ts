import { useShareDialogStore } from "@/store/shareDialogStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import type { PaletteCommand } from "./types";

/**
 * "Share…" lives in its own module (not fileCommands.ts, which the data-layer
 * half of this feature owns) but in the same "File" palette group, right
 * alongside `file-open`. Its id deliberately does NOT start with
 * `file-export-` so `runCommand()` in registry.ts never mistakes it for an
 * export command and fires a spurious `document_exported`.
 */
export function getShareCommands(): PaletteCommand[] {
  return [
    {
      id: "file-share",
      label: "Share…",
      group: "File",
      keywords: ["share", "link", "publish", "public"],
      // A viewer of someone else's shared canvas must not be able to
      // re-share it as their own — see sharedViewStore.ts. The command is
      // still present in the palette's underlying list either way; the
      // guard here is the ⌘K-side equivalent of Toolbar.tsx hiding the menu
      // item for the same reason.
      run: () => {
        if (useSharedViewStore.getState().isSharedView) return;
        useShareDialogStore.getState().setOpen(true);
      },
    },
  ];
}
