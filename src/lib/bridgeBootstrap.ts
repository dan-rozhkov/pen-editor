// Starts the desktop/WebSocket MCP bridges and the menu-command bridge. Split
// out of main.tsx so this ordering logic — dynamic imports plus the
// desktop-then-websocket sequencing — can be unit-tested without pulling in
// React rendering.
//
// desktopBridge/desktopMcpBridge/mcpBridge statically import the command
// registry and the full tool-execution registry respectively (menu dispatch,
// MCP-bridged tool calls) — both drag in most of the editor's module graph
// (sceneStore, selectionStore, canvasRefStore, pixi.js, ...). All three are
// no-ops on an ordinary web visit anyway (desktopBridge/desktopMcpBridge bail
// without `window.penDesktop`; mcpBridge bails without `VITE_MCP_WS_TOKEN`),
// so check the same conditions *before* importing rather than after, to keep
// the showcase entry bundle free of the editor's weight. Same runtime
// behavior, lazier import.
//
// Ordering matters for one case: a dev bundle built with VITE_MCP_WS_TOKEN
// *and* loaded inside the desktop shell must not start both bridges (see
// mcpBridge.ts's startMcpBridgeIfConfigured doc comment) — two independent
// paths into the same toolHandlers could interleave scene mutations. The
// desktop bridge registration must fully settle (synchronously, inside its
// own .then) before the WS bridge's own dynamic import even starts, so this
// is a promise chain rather than two independent `if` blocks racing.
//
// Failure must fall back, not silently disable both bridges: if the dynamic
// import of desktopMcpBridge.ts fails (a stale chunk after a deploy) or
// initDesktopMcpBridge() itself throws (e.g. the shell's registerMcpBridge
// throws across IPC), the promise this chain builds on would otherwise
// reject with nothing to catch it — the WS bridge's `.then` below would then
// never run, and in a production desktop build (no VITE_MCP_WS_TOKEN)
// nothing would even subscribe to the rejection, guaranteeing an unhandled
// rejection. Catching here means the desktop path failing still lets the WS
// bridge start when it's configured.
export function startBridges(): void {
  const desktopMcpBridgeReady: Promise<void> = window.penDesktop
    ? import('@/lib/desktopMcpBridge')
        .then(({ initDesktopMcpBridge }) => {
          initDesktopMcpBridge()
        })
        .catch((error) => {
          console.error(
            '[bridgeBootstrap] initDesktopMcpBridge failed; falling back to the WebSocket bridge if configured',
            error,
          )
        })
    : Promise.resolve()

  if (window.penDesktop) {
    // Same stale-chunk-after-a-deploy scenario as the desktopMcpBridge chain
    // above: an uncaught rejection here would be a genuinely unhandled
    // promise rejection at boot (this chain is never awaited by anything),
    // and for this specific chain the failure mode is silent — the desktop
    // File menu just stops working, with no render error for
    // RootErrorBoundary/recoverFromFatalError to ever see.
    import('@/lib/desktopBridge')
      .then(({ initDesktopBridge }) => initDesktopBridge())
      .catch((error) => {
        console.error('[bridgeBootstrap] initDesktopBridge failed; the desktop File menu will not work', error)
      })
  }
  if (import.meta.env.VITE_MCP_WS_TOKEN) {
    desktopMcpBridgeReady.then(() => {
      // Same reasoning as above, applied to the WS bridge's own dynamic
      // import (as opposed to desktopMcpBridgeReady's .catch, which only
      // covers the desktop-MCP chain that precedes this one).
      import('@/lib/mcpBridge')
        .then(({ startMcpBridgeIfConfigured }) => startMcpBridgeIfConfigured())
        .catch((error) => {
          console.error('[bridgeBootstrap] startMcpBridgeIfConfigured failed to load', error)
        })
    })
  }
}
