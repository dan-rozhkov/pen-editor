import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { DotsSixIcon, XIcon } from "@phosphor-icons/react";

import { stopPlugin } from "@/lib/plugins/pluginHost";
import { usePluginPanelStore, type PluginPanelState } from "@/store/pluginPanelStore";
import { clampPositionToViewport, computeDragPosition } from "@/components/ui/popoverDrag";
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
        <PluginPanelWindow key={panel.plugin.id} panel={panel} />
      ))}
    </>
  );
}

function PluginPanelWindow({ panel }: { panel: PluginPanelState }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  // The iframe is owned by pluginHost (created in runPlugin, torn down in
  // dispose()) — this effect only re-parents it into the panel's visible DOM.
  // No cleanup needed here: closing the panel disposes the plugin instance,
  // which removes the iframe itself.
  useEffect(() => {
    bodyRef.current?.appendChild(panel.iframe);
  }, [panel.iframe]);

  // Tear down any in-progress drag/resize gesture's window listeners on
  // unmount (panel closed mid-drag), same rationale as popover.tsx.
  useEffect(
    () => () => {
      dragCleanupRef.current?.();
      resizeCleanupRef.current?.();
    },
    [],
  );

  const handleTitleBarPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragCleanupRef.current?.();

      const pluginId = panel.plugin.id;
      const origin = {
        pointer: { x: event.clientX, y: event.clientY },
        position: { x: panel.x, y: panel.y },
      };
      const size = { width: panel.width, height: panel.height };

      const onMove = (moveEvent: PointerEvent) => {
        const next = computeDragPosition(
          origin,
          { x: moveEvent.clientX, y: moveEvent.clientY },
          size,
          { width: window.innerWidth, height: window.innerHeight },
        );
        usePluginPanelStore.getState().move(pluginId, next.x, next.y);
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        dragCleanupRef.current = null;
      };
      dragCleanupRef.current = cleanup;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [panel.plugin.id, panel.x, panel.y, panel.width, panel.height],
  );

  const handleResizeHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeCleanupRef.current?.();

      const pluginId = panel.plugin.id;
      const startPointer = { x: event.clientX, y: event.clientY };
      const startSize = { width: panel.width, height: panel.height };

      const onMove = (moveEvent: PointerEvent) => {
        const width = startSize.width + (moveEvent.clientX - startPointer.x);
        const height = startSize.height + (moveEvent.clientY - startPointer.y);
        usePluginPanelStore.getState().resize(pluginId, width, height);
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        resizeCleanupRef.current = null;
      };
      resizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [panel.plugin.id, panel.width, panel.height],
  );

  // Keep the panel on screen when the viewport shrinks (window resize),
  // mirroring popover.tsx's torn-off-position clamp.
  useEffect(() => {
    const pluginId = panel.plugin.id;
    const onResize = () => {
      const current = usePluginPanelStore.getState().panels[pluginId];
      if (!current) return;
      const clamped = clampPositionToViewport(
        { x: current.x, y: current.y },
        { width: current.width, height: current.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      if (clamped.x !== current.x || clamped.y !== current.y) {
        usePluginPanelStore.getState().move(pluginId, clamped.x, clamped.y);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [panel.plugin.id]);

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
        {panel.plugin.icon && (
          <span aria-hidden className="shrink-0">
            {panel.plugin.icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{panel.plugin.name}</span>
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
          onClick={() => stopPlugin(panel.plugin.id)}
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
}
