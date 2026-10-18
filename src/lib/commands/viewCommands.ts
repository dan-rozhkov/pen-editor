import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useUIVisibilityStore } from "@/store/uiVisibilityStore";
import { usePixelGridStore } from "@/store/pixelGridStore";
import { useGuidesStore } from "@/store/guidesStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { useRenderModeStore } from "@/store/renderModeStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { getAvailableSurfaces } from "@/surfaces/meta";
import { canSwitchSurfaces } from "@/surfaces/effectiveSurface";
import { formatShortcut } from "./shortcutFormat";
import type { PaletteCommand } from "./types";
import { getCanvasViewportMetrics } from "@/utils/canvasViewport";

function fitToContent(): void {
  const { width, height } = getCanvasViewportMetrics();
  const nodes = useSceneStore.getState().getNodes();
  useViewportStore.getState().fitToContent(nodes, width, height);
}

export function getViewCommands(): PaletteCommand[] {
  return [
    { id: "view-zoom-to-fit", label: "Zoom to fit", group: "View", shortcut: formatShortcut(["mod", "0"]), run: fitToContent },
    {
      id: "view-toggle-ui",
      label: "Toggle UI",
      group: "View",
      shortcut: formatShortcut(["mod", "\\"]),
      keywords: ["hide panels", "show panels"],
      run: () => useUIVisibilityStore.getState().toggleUI(),
    },
    {
      id: "view-toggle-pixel-grid",
      label: "Toggle pixel grid",
      group: "View",
      run: () => usePixelGridStore.getState().togglePixelGrid(),
    },
    {
      id: "view-toggle-rulers",
      label: "Toggle rulers",
      group: "View",
      shortcut: formatShortcut(["shift", "R"]),
      run: () => useGuidesStore.getState().toggleShowRulers(),
    },
    {
      id: "view-toggle-outline-mode",
      label: "Toggle outline mode",
      group: "View",
      shortcut: formatShortcut(["mod", "shift", "O"]),
      keywords: ["wireframe", "outline view"],
      run: () => useRenderModeStore.getState().toggle(),
    },
    {
      id: "view-enter-present",
      label: "Present",
      group: "View",
      shortcut: formatShortcut(["mod", "⏎"]),
      keywords: ["present mode", "slideshow", "fullscreen"],
      run: () => useEditorModeStore.getState().enterPresent(),
    },
    // One command per surface (src/surfaces/), ids "view-surface-<id>", only
    // where switching is offered at all (not mobile/view/dev/present/shared/
    // hidden UI).
    ...(canSwitchSurfaces() ? getAvailableSurfaces() : []).map((surface) => ({
      id: `view-surface-${surface.id}`,
      label: `Show ${surface.title}`,
      group: "View" as const,
      keywords: ["surface", "main area", surface.id],
      run: () => useSurfaceStore.getState().setActiveSurface(surface.id),
    })),
    {
      id: "view-light-theme",
      label: "Light theme",
      group: "View",
      run: () => useUIThemeStore.getState().setUITheme("light"),
    },
    {
      id: "view-dark-theme",
      label: "Dark theme",
      group: "View",
      run: () => useUIThemeStore.getState().setUITheme("dark"),
    },
  ];
}
