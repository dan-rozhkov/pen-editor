import { AuthMenu } from "./auth/AuthMenu";
import { FileMenu } from "./Toolbar";
import { PrimitivesPanel } from "./PrimitivesPanel";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useLayers3DStore } from "@/store/layers3dStore";

/**
 * Height of the header row: 28px buttons + py-1.5 + 1px bottom border.
 * App.tsx publishes it as the `--canvas-header-h` CSS variable (0px when the
 * header is not rendered) for everything that must sit below it.
 */
export const CANVAS_HEADER_HEIGHT = 41;

/**
 * The canvas tab's header row, the same shape as the chat / doc / trace
 * headers: File menu on the left, the drawing tools centered, the account
 * menu on the right. Desktop only (on mobile the File menu stays in the
 * sidebar header); App.tsx hides it in present mode and with the UI hidden.
 */
export function CanvasHeader() {
  const isView = useEditorModeStore((s) => s.mode === "view");
  const isDev = useDevModeStore((s) => s.active);
  const is3DActive = useLayers3DStore((s) => s.active);
  // Drawing tools are pointless in read-only view mode, and the 3D layer
  // view has its own control bar.
  const showTools = !isView && !isDev && !is3DActive;

  return (
    <header
      data-testid="canvas-header"
      className="relative flex shrink-0 items-center gap-1 border-b border-border-default bg-surface-panel px-2 py-1.5"
    >
      <FileMenu />
      {showTools && (
        <div className="absolute left-1/2 -translate-x-1/2">
          <PrimitivesPanel variant="header" />
        </div>
      )}
      <div className="ml-auto">
        <AuthMenu variant="toolbar" />
      </div>
    </header>
  );
}
