import { useState, type ReactNode } from "react";
import { CodeIcon, CopySimpleIcon } from "@phosphor-icons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useSelectionStore } from "@/store/selectionStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { copyAsCss, copyAsSvg } from "./copyAsActions";

/**
 * Right-click context menu on the canvas — the mouse-driven counterpart to
 * the Cmd/Ctrl+Shift+C / +S "Copy as CSS/SVG" hotkeys wired in
 * `useCanvasKeyboardShortcuts.ts`. Both entry points call the same
 * {@link copyAsCss}/{@link copyAsSvg} actions in `copyAsActions.ts`.
 *
 * `children` (the Suspense/PixiCanvas subtree) is ALWAYS wrapped by
 * `ContextMenuTrigger` in the same element, in every mode — App.tsx relies
 * on this component never swapping that wrapper for a bare fragment, since
 * doing so would remount PixiCanvas (destroying/recreating the WebGL
 * context). Present mode (slideshow) instead suppresses the menu via
 * `ContextMenu`'s controlled `open` prop, forcing it closed and ignoring
 * open attempts while presenting. View mode (read-only inspect) is
 * unaffected — "Copy as CSS/SVG" is a read-only operation and stays
 * available there.
 *
 * PixiJS's own `contextmenu` listener only calls `preventDefault()` (no
 * `stopPropagation()`), so the native event still bubbles up to this
 * trigger and opens the menu.
 */
export function CanvasContextMenu({ children }: { children: ReactNode }) {
  const hasSelection = useSelectionStore((s) => s.selectedIds.length > 0);
  const isPresent = useEditorModeStore((s) => s.mode === "present");
  const [open, setOpen] = useState(false);

  // Reset the internal open state the moment present mode is entered (React's
  // "adjust state during render" pattern — not an effect, so it applies
  // before paint and doesn't trigger a cascading-render lint warning). This
  // stops a menu that was open right before presenting from spuriously
  // reopening once present mode exits (open is only forced false via the
  // `open={isPresent ? false : open}` prop below *while* isPresent is true;
  // without this reset the stale `true` would resurface on exit).
  const [wasPresent, setWasPresent] = useState(isPresent);
  if (isPresent !== wasPresent) {
    setWasPresent(isPresent);
    if (isPresent) setOpen(false);
  }

  return (
    <ContextMenu
      open={isPresent ? false : open}
      onOpenChange={(next) => {
        if (!isPresent) setOpen(next);
      }}
    >
      <ContextMenuTrigger className="h-full w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuLabel>Copy as</ContextMenuLabel>
          <ContextMenuItem disabled={!hasSelection} onClick={() => void copyAsCss()}>
            <CodeIcon />
            Copy as CSS
          </ContextMenuItem>
          <ContextMenuItem disabled={!hasSelection} onClick={() => void copyAsSvg()}>
            <CopySimpleIcon />
            Copy as SVG
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
