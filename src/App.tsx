import { lazy, Suspense, useEffect } from "react";
import { track } from "./lib/analytics";
import { markEditorOpened } from "./lib/analytics/sessionTiming";
import { loadModels } from "./lib/chatModels";
import { reconcileModels } from "./store/chatStore";
import { useCustomFontStore } from "./store/customFontStore";
import { usePluginStore } from "./store/pluginStore";
import { useSceneStore } from "./store/sceneStore";
import { LeftRail } from "./components/LeftRail";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightPanel } from "./components/RightPanel";
import { PrimitivesPanel } from "./components/PrimitivesPanel";
import { PresentOverlay } from "./components/PresentOverlay";
import { CommandPalette } from "./components/CommandPalette";
import { PluginPanels } from "./components/plugins/PluginPanels";
import { PresentController } from "./components/PresentController";
import { ReadOnlyProvider } from "./components/ReadOnlyProvider";
import { FpsDisplay } from "./components/canvas/CanvasOverlays";
import { Rulers } from "./components/canvas/Rulers";
import { CanvasContextMenu } from "./components/canvas/CanvasContextMenu";
import { useUIVisibilityStore } from "./store/uiVisibilityStore";
import { useEditorModeStore } from "./store/editorModeStore";
import { useDevModeStore } from "./store/devModeStore";
import { useLayers3DStore } from "./store/layers3dStore";
import { useIsMobile } from "./hooks/useIsMobile";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { launchShowcaseAgentChat } from "./lib/launchShowcaseAgentChat";
import { startWebMcp, stopWebMcp } from "./lib/webmcp";
import { importShowcaseScreensFromHandoff } from "./lib/importShowcaseScreens";
import { OfflineBanner } from "./components/status/OfflineBanner";
import { ShareDialog } from "./components/share/ShareDialog";
import { useSharedViewStore } from "./store/sharedViewStore";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import "./store/uiThemeStore"; // Initialize the editor theme store after the shared page bootstrap.

const PixiCanvas = lazy(() => import("./pixi/PixiCanvas").then((m) => ({ default: m.PixiCanvas })));

function App() {
  const isUIHidden = useUIVisibilityStore((s) => s.isUIHidden);
  const mode = useEditorModeStore((s) => s.mode);
  const is3DActive = useLayers3DStore((s) => s.active);
  const isMobile = useIsMobile();
  const isOnline = useOnlineStatus();
  const isSharedView = useSharedViewStore((s) => s.isSharedView);

  const isPresent = mode === "present";
  const isView = mode === "view";
  const isDev = useDevModeStore((s) => s.active);

  // Fires once per mount, before the two showcase-handoff effects below
  // consume (and clear) their sessionStorage payloads — React runs a single
  // component's passive effects in declaration order within one commit, so
  // this synchronous read race-frees the "was a handoff pending" check.
  // `is_first_session` is a plain localStorage marker: unset on a visitor's
  // very first editor load, set here, so every load after the first reads
  // it as already present. Neither key stores anything but presence/a
  // boolean — see the NO PII rule in src/lib/analytics/index.ts.
  useEffect(() => {
    const EDITOR_SEEN_KEY = "pen.editorSeen";
    let isFirstSession = false;
    try {
      isFirstSession = !localStorage.getItem(EDITOR_SEEN_KEY);
      localStorage.setItem(EDITOR_SEEN_KEY, "1");
    } catch {
      // Private-mode Safari etc. — treat as not-first rather than crash.
    }
    // Keys owned by showcaseAgentHandoff.ts / showcaseScreenHandoff.ts;
    // read directly (not exported) since only presence is needed here,
    // before those modules' own effects consume (and clear) them.
    let viaHandoff = false;
    try {
      viaHandoff =
        sessionStorage.getItem("pen:showcase-agent-prompt:v1") !== null ||
        sessionStorage.getItem("pen:showcase-editor-screens:v1") !== null;
    } catch {
      // Ignore — falls back to false, an honest "unknown" rather than a guess.
    }
    markEditorOpened();
    track("editor_opened", {
      is_first_session: isFirstSession,
      via_showcase_handoff: viaHandoff,
    });
  }, []);

  // Pull the authoritative chat model list from the backend, then drop any saved
  // selection it no longer allows. Falls back to the hardcoded list on failure.
  useEffect(() => {
    loadModels().then(reconcileModels);
  }, []);

  useEffect(() => {
    launchShowcaseAgentChat();
  }, []);

  // "Open in Editor" handoff (FIR-62): a showcase card's screens, dropped
  // onto the canvas the first time the editor mounts after the click. See
  // importShowcaseScreens.ts for why this needs an async fetch (the S3
  // htmlUrl itself can't be read cross-origin) rather than reading
  // everything synchronously like launchShowcaseAgentChat above.
  useEffect(() => {
    void importShowcaseScreensFromHandoff();
  }, []);

  // Re-register every custom (uploaded) font's FontFace with the browser so
  // text using it renders correctly after a reload, instead of falling back.
  useEffect(() => {
    useCustomFontStore.getState().restoreCustomFonts();
  }, []);

  // Hydrate the installed-plugin list from IndexedDB so plugins survive a
  // reload. Gated to edit mode — present/view (and dev-mode-only sessions,
  // e.g. embedded/read-only viewers) never need the plugin library, and
  // `init()` is idempotent so switching into edit mode later still hydrates.
  useEffect(() => {
    if (mode !== "edit") return;
    void usePluginStore.getState().init();
  }, [mode]);

  // Read-only view mode is entered only via the `?view` URL parameter
  // (e.g. ?view or ?view=1). There is no in-app toggle.
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    if (view !== null && view !== "0" && view !== "false") {
      useEditorModeStore.getState().enterView();
    }
  }, []);

  // Publish the editor's tools to in-page agents over WebMCP
  // (src/lib/webmcp/). Mounted here rather than in main.tsx's startBridges()
  // on purpose: this route is where a document exists, and the showcase at
  // "/" must keep the editor's module graph out of its entry bundle.
  //
  // Declared *after* the `?view` effect above, and that ordering is load
  // bearing: passive effects in one component run in declaration order, so
  // registering first would advertise the editing tools on `/app?view` a
  // moment before view mode is entered. The call-time gate in
  // registerTools.ts would still refuse them, but discovery would have
  // promised an agent something this page will never do.
  // Torn down on unmount: the tools cannot be unregistered (no browser API
  // for it), so the surface is marked unowned instead and refuses calls
  // until an editor mounts again — otherwise browser Back to the showcase
  // would leave an in-page agent editing a document nothing renders.
  useEffect(() => {
    void startWebMcp();
    return () => stopWebMcp();
  }, []);

  // Dev-only synthetic document seeding for perf work, via `?perf=N` (approx
  // total node count). Dynamically imported so the generator is tree-shaken
  // from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const perf = new URLSearchParams(window.location.search).get("perf");
    if (!perf) return;
    void import("./dev/perfScene").then(({ generatePerfScene }) => {
      const total = Math.max(100, parseInt(perf, 10) || 5000);
      const frames = Math.max(1, Math.round(total / 60));
      const scene = generatePerfScene(frames, 60);
      useSceneStore.setState({ ...scene, _cachedTree: null });
    });
  }, []);

  return (
    // Single app-wide TooltipProvider: shares hover-delay grouping across
    // every IconButton/Tooltip so sweeping across a row of icon buttons
    // doesn't re-trigger the open delay on each one. Do not mount another
    // provider closer to the leaves.
    <TooltipProvider delay={400} closeDelay={0}>
    <div className="w-full h-full relative overflow-hidden">
      {/* Canvas — always full window, behind everything. `isolate` creates a
          stacking context so the embed DOM overlay (and other canvas overlays,
          which use positive z-index) stay trapped beneath the UI panels below. */}
      <div className="absolute inset-0 isolate">
        {/* CanvasContextMenu always wraps PixiCanvas — swapping this element
            based on mode would remount PixiCanvas (destroying/recreating the
            WebGL context) on every present/view toggle. The menu suppresses
            itself internally during present mode instead. */}
        <CanvasContextMenu>
          <Suspense fallback={null}>
            <PixiCanvas />
          </Suspense>
        </CanvasContextMenu>
      </div>

      {/* Sonner toast portal — hosts the editor's toasts. Themed with the
          editor's UI theme. */}
      <Toaster />

      {/* Keeps the present-mode frame fitted to the window; no-op otherwise. */}
      <PresentController />

      {/* Present mode hides all editor chrome and shows only the slide controls. */}
      {isPresent && <PresentOverlay />}

      {/* Offline status pill — rendered above the canvas/UI stack. Non-blocking
          (pointer-events-none), so it never intercepts canvas or sidebar
          interaction. PixiCanvas stays mounted; only backend-dependent
          features are unavailable while offline. */}
      {!isOnline && !isPresent && <OfflineBanner />}

      {/* Cmd+/ or Cmd+K search overlay — lists every tool/menu action from
          the command registry. Edit-mode only: its commands mutate the scene
          directly and would otherwise bypass the read-only guarantee that
          `canEditScene` enforces for view/present mode. */}
      {mode === "edit" && <CommandPalette />}

      {/* Floating windows for running UI plugins (`PenPlugin.ui` set) —
          plugins only run in edit mode. The plugin manager list itself now
          lives in the left sidebar's Toolbox section (PluginsPanel), not a
          modal here. */}
      {mode === "edit" && <PluginPanels />}

      {/* Share dialog: mounted here (not in Toolbar, where it used to live)
          because Toolbar itself only renders while the left sidebar's
          active section is Pages/Slides, and not at all on mobile with the
          panel closed — so ⌘K -> "Share…" (shareCommands.ts) had nowhere
          to actually show a dialog on Assets/Variables/Styles/mobile, and
          it would pop open unexpectedly later once the user switched back
          to Pages. The File-menu item stays in Toolbar; it only flips
          shareDialogStore. Gated the same way CommandPalette/PluginPanels
          are dropped in present mode, plus out of the shared-canvas viewer
          (a visitor there must not be able to re-share someone else's
          canvas as their own — see sharedViewStore.ts). */}
      {mode !== "present" && !isSharedView && <ShareDialog />}

      {/* UI panels — overlay on top of canvas */}
      {!isUIHidden && !isPresent && (
        <div className="absolute inset-0 flex flex-row pointer-events-none">
          {/* Left rail + sidebar — layers panel is read-only in view mode. */}
          <div className="pointer-events-auto flex flex-row">
            <LeftRail />
            <ReadOnlyProvider value={isView}>
              <LeftSidebar />
            </ReadOnlyProvider>
          </div>
          {/* Center area — tools/right panel are hidden on mobile, which keeps
              only the left rail (and its full-width overlay panel). */}
          {!isMobile && (
            <>
              <div className="flex-1 h-full relative">
                {/* Drawing tools are pointless in read-only view mode, and
                    the 3D layer view's own control bar occupies the same
                    bottom-center slot — hide the draw palette in both. */}
                {!isView && !isDev && !is3DActive && (
                  <div className="pointer-events-auto">
                    <PrimitivesPanel />
                  </div>
                )}
                {!isView && !is3DActive && <Rulers />}
                <FpsDisplay />
              </div>
              {/* Right sidebar — read-only in view mode (inspect, no edits);
                  swapped for the read-only InspectPanel in dev mode. */}
              <div className="pointer-events-auto">
                <ReadOnlyProvider value={isView || isDev}>
                  <RightPanel />
                </ReadOnlyProvider>
              </div>
            </>
          )}
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

export default App;
