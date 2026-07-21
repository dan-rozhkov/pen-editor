import { memo, useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { DotsSixIcon, XIcon } from "@phosphor-icons/react";

import { getRunningPlugin, stopPlugin } from "@/lib/plugins/pluginHost";
import { usePluginPanelStore, type PluginPanelState } from "@/store/pluginPanelStore";
import { usePluginStore } from "@/store/pluginStore";
import { computeDragPosition } from "@/components/ui/popoverDrag";
import { usePointerDragGesture } from "@/hooks/usePointerDragGesture";
import { IconButton } from "@/components/ui/IconButton";

/**
 * Floating windows for running UI plugins (`PenPlugin.ui` set). One window
 * per entry in `pluginPanelStore`; the plugin's sandboxed iframe (created and
 * owned by `pluginHost.runPlugin`) is re-parented into each window's body.
 * Rendered once near the top of `App.tsx`, gated to edit mode alongside the
 * rest of the plugin UI.
 */
export function PluginPanels() {
  const panels = usePluginPanelStore((s) => s.panels);
  return (
    <>
      {Object.values(panels).map((panel) => (
        <PluginPanelWindow key={panel.pluginId} panel={panel} />
      ))}
    </>
  );
}

/**
 * Memoized so dragging/resizing one panel doesn't re-render every other open
 * panel: `PluginPanels` subscribes to the whole `panels` record, but `open`/
 * `move`/`resize` only replace the touched entry (see `pluginPanelStore.ts`),
 * so every *other* panel's `panel` prop keeps its old reference — memo turns
 * that into an actual skipped re-render instead of a wasted one.
 */
const PluginPanelWindow = memo(function PluginPanelWindow({ panel }: { panel: PluginPanelState }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // Plugin metadata for the titlebar: read live from `pluginStore` by id so a
  // rename doesn't go stale here (the panel only keeps geometry + iframe,
  // not a `PenPlugin` snapshot). Plugins run directly against `pluginHost`
  // without going through `pluginStore` (e.g. the e2e/dev harness) fall back
  // to the running instance's own copy.
  const installedPlugin = usePluginStore((s) => s.plugins.find((p) => p.id === panel.pluginId));
  const runningPlugin = installedPlugin ? undefined : getRunningPlugin(panel.pluginId)?.plugin;
  const name = installedPlugin?.name ?? runningPlugin?.name ?? panel.pluginId;
  const icon = installedPlugin?.icon ?? runningPlugin?.icon;

  const drag = usePointerDragGesture();
  const resizeDrag = usePointerDragGesture();

  // The iframe is owned by pluginHost (created in runPlugin, torn down in
  // dispose()) — this effect only re-parents it into the panel's visible DOM.
  // No cleanup needed here: closing the panel disposes the plugin instance,
  // which removes the iframe itself.
  useEffect(() => {
    bodyRef.current?.appendChild(panel.iframe);
  }, [panel.iframe]);

  // Tear down any in-progress drag/resize gesture's window listeners on
  // unmount (panel closed mid-drag), same rationale as popover.tsx.
  useEffect(() => () => {
    drag.cancel();
    resizeDrag.cancel();
  }, [drag, resizeDrag]);

  const handleTitleBarPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pluginId = panel.pluginId;
      const origin = {
        pointer: { x: event.clientX, y: event.clientY },
        position: { x: panel.x, y: panel.y },
      };
      const size = { width: panel.width, height: panel.height };

      drag.start(event, (moveEvent) => {
        const next = computeDragPosition(
          origin,
          { x: moveEvent.clientX, y: moveEvent.clientY },
          size,
          { width: window.innerWidth, height: window.innerHeight },
        );
        usePluginPanelStore.getState().move(pluginId, next.x, next.y);
      });
    },
    [drag, panel.pluginId, panel.x, panel.y, panel.width, panel.height],
  );

  const handleResizeHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pluginId = panel.pluginId;
      const startPointer = { x: event.clientX, y: event.clientY };
      const startSize = { width: panel.width, height: panel.height };

      resizeDrag.start(event, (moveEvent) => {
        const width = startSize.width + (moveEvent.clientX - startPointer.x);
        const height = startSize.height + (moveEvent.clientY - startPointer.y);
        usePluginPanelStore.getState().resize(pluginId, width, height);
      });
    },
    [resizeDrag, panel.pluginId, panel.width, panel.height],
  );

  // Keep the panel on screen when the viewport shrinks (window resize):
  // shrink its size to fit first, then clamp position — mirrors popover.tsx's
  // torn-off-position clamp, but also fixes the resize handle (bottom-right
  // corner) ending up off-screen when only position used to be clamped.
  useEffect(() => {
    const pluginId = panel.pluginId;
    const onResize = () => {
      usePluginPanelStore.getState().fitToViewport(pluginId, window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [panel.pluginId]);

  return (
    <div
      className="fixed z-[10040] flex flex-col overflow-hidden rounded-xl border border-border-light bg-surface-panel text-text-primary shadow-lg"
      style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height }}
    >
      <div
        className="flex h-8 shrink-0 cursor-grab touch-none select-none items-center gap-1.5 border-b border-border-light bg-surface-elevated px-2 text-xs font-medium text-text-primary active:cursor-grabbing"
        onPointerDown={handleTitleBarPointerDown}
      >
        <DotsSixIcon size={12} weight="bold" className="shrink-0 text-text-muted" />
        {icon && (
          <span aria-hidden className="shrink-0">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <IconButton
          tooltip="Close"
          size="icon-sm"
          variant="ghost"
          // Stop the pointerdown here so it never bubbles to the titlebar's
          // own handler above: `setPointerCapture` there would otherwise
          // hijack this button's click (pointer capture redirects the
          // eventual click's target to the capturing element), and the
          // close button would silently stop responding to clicks.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => stopPlugin(panel.pluginId)}
        >
          <XIcon />
        </IconButton>
      </div>

      <div ref={bodyRef} className="relative min-h-0 flex-1" />

      <div
        role="presentation"
        title="Resize"
        className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize touch-none"
        onPointerDown={handleResizeHandlePointerDown}
      />
    </div>
  );
});
