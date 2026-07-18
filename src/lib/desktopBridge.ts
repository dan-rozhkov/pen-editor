import { getCommands } from "@/lib/commands/registry";

/**
 * Bridge to the Electron shell (pen-editor-desktop). The desktop preload
 * exposes window.penDesktop; native menu items send command-palette ids
 * (e.g. "file-open") which we dispatch through the existing registry.
 * On the web window.penDesktop is absent and this is a no-op.
 */
export interface PenDesktopApi {
  onMenuCommand(cb: (commandId: string) => void): () => void;
}

declare global {
  interface Window {
    penDesktop?: PenDesktopApi;
  }
}

export function initDesktopBridge(): () => void {
  const api = window.penDesktop;
  if (!api) return () => {};
  return api.onMenuCommand((commandId) => {
    const command = getCommands().find((c) => c.id === commandId);
    if (command) {
      command.run();
    } else {
      console.warn(`[desktopBridge] unknown menu command id: ${commandId}`);
    }
  });
}
