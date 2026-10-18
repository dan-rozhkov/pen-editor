import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { useUIVisibilityStore } from "@/store/uiVisibilityStore";
import { isCanvasInputActive } from "@/surfaces/effectiveSurface";

/**
 * Finding C: <ShareDialog/> moved from Toolbar (which only renders while
 * the left sidebar's active section is Pages/Slides, and not at all on
 * mobile with the panel closed) to App.tsx, so ⌘K -> "Share…" always has a
 * mounted dialog to open regardless of which section is active. This suite
 * exercises only that mount/gating decision — every other child of App is
 * stubbed to a lightweight shim so the test doesn't drag in PixiJS/WebGL,
 * chat, or the rest of the editor shell.
 */

vi.mock("@/pixi/PixiCanvas", () => ({ PixiCanvas: () => <div data-testid="pixi-shim" /> }));
vi.mock("@/components/LeftRail", () => ({ LeftRail: () => <div data-testid="left-rail-shim" /> }));
vi.mock("@/components/LeftSidebar", () => ({ LeftSidebar: () => <div data-testid="left-sidebar-shim" /> }));
vi.mock("@/components/RightPanel", () => ({ RightPanel: () => <div data-testid="right-panel-shim" /> }));
vi.mock("@/components/PrimitivesPanel", () => ({ PrimitivesPanel: () => <div data-testid="primitives-shim" /> }));
vi.mock("@/components/PresentOverlay", () => ({ PresentOverlay: () => <div data-testid="present-overlay-shim" /> }));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => <div data-testid="command-palette-shim" /> }));
vi.mock("@/components/plugins/PluginPanels", () => ({ PluginPanels: () => <div data-testid="plugin-panels-shim" /> }));
vi.mock("@/components/canvas/CanvasOverlays", () => ({ FpsDisplay: () => null }));
vi.mock("@/components/canvas/Rulers", () => ({ Rulers: () => null }));
vi.mock("@/components/canvas/CanvasContextMenu", () => ({
  CanvasContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => mobile.value,
  isMobileViewport: () => mobile.value,
}));
vi.mock("@/lib/launchShowcaseAgentChat", () => ({ launchShowcaseAgentChat: vi.fn() }));
vi.mock("@/lib/importShowcaseScreens", () => ({ importShowcaseScreensFromHandoff: vi.fn(async () => {}) }));
vi.mock("@/lib/chatModels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chatModels")>();
  return { ...actual, loadModels: vi.fn(async () => {}) };
});
vi.mock("@/store/chatStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/chatStore")>();
  return { ...actual, reconcileModels: vi.fn() };
});
vi.mock("@/components/status/OfflineBanner", () => ({ OfflineBanner: () => <div data-testid="offline-banner-shim" /> }));
vi.mock("@/components/share/ShareDialog", () => ({ ShareDialog: () => <div data-testid="share-dialog-shim" /> }));

import App from "@/App";

function useFreshApp() {
  beforeEach(() => {
    resetStores();
    mobile.value = false;
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSharedViewStore.setState({ isSharedView: false });
    useSurfaceStore.setState({ activeSurfaceId: "canvas" });
    useUIVisibilityStore.setState({ isUIHidden: false });
  });

  afterEach(() => {
    cleanup();
    delete window.penDesktop;
  });
}

describe("<App /> — ShareDialog mount", () => {
  useFreshApp();

  it("mounts ShareDialog in edit mode regardless of the left sidebar's active section", () => {
    render(<App />);
    expect(screen.getByTestId("share-dialog-shim")).toBeTruthy();
  });

  it("does not mount ShareDialog in present mode", () => {
    useEditorModeStore.setState({ mode: "present", presentFrameIds: ["f1"], presentIndex: 0 });
    render(<App />);
    expect(screen.queryByTestId("share-dialog-shim")).toBeNull();
  });

  it("does not mount ShareDialog in the shared-canvas viewer", () => {
    useSharedViewStore.setState({ isSharedView: true });
    render(<App />);
    expect(screen.queryByTestId("share-dialog-shim")).toBeNull();
  });
});

describe("<App /> — surfaces", () => {
  useFreshApp();

  it("shows the canvas chrome and no browser view on the canvas surface", () => {
    render(<App />);
    expect(screen.getByTestId("right-panel-shim")).toBeTruthy();
    expect(screen.getByTestId("primitives-shim")).toBeTruthy();
    expect(screen.queryByTestId("browser-surface-view")).toBeNull();
  });

  it("lays the browser view over the canvas and hides canvas-only chrome, keeping the canvas mounted", async () => {
    useSurfaceStore.setState({ activeSurfaceId: "browser" });
    render(<App />);
    expect(await screen.findByTestId("browser-surface-view", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId("right-panel-shim")).toBeNull();
    expect(screen.queryByTestId("primitives-shim")).toBeNull();
    expect(screen.getByTestId("left-sidebar-shim")).toBeTruthy();
    expect(screen.getByTestId("pixi-shim")).toBeTruthy();
  });

  it("switches surface from the switcher", async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("surface-tab-browser"));
    expect(await screen.findByTestId("browser-surface-view", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId("right-panel-shim")).toBeNull();
    fireEvent.click(screen.getByTestId("surface-tab-canvas"));
    expect(screen.queryByTestId("browser-surface-view")).toBeNull();
    expect(screen.getByTestId("right-panel-shim")).toBeTruthy();
  });

  it("offers no switcher on mobile and falls back to the canvas from a stale browser surface", () => {
    mobile.value = true;
    useSurfaceStore.setState({ activeSurfaceId: "browser" });
    render(<App />);
    expect(screen.queryByTestId("surface-tab-browser")).toBeNull();
    expect(screen.queryByTestId("browser-surface-view")).toBeNull();
    expect(useSurfaceStore.getState().activeSurfaceId).toBe("canvas");
  });

  it.each([
    ["view mode", () => useEditorModeStore.setState({ mode: "view" })],
    ["the shared-canvas viewer", () => useSharedViewStore.setState({ isSharedView: true })],
  ])("offers no switcher in %s and returns to the canvas", (_name, enter) => {
    enter();
    useSurfaceStore.setState({ activeSurfaceId: "browser" });
    render(<App />);
    expect(screen.queryByTestId("surface-tab-browser")).toBeNull();
    expect(screen.queryByTestId("browser-surface-view")).toBeNull();
    expect(useSurfaceStore.getState().activeSurfaceId).toBe("canvas");
  });

  it("with the UI hidden and the browser requested, shows the canvas (no stale browser) and keeps canvas shortcuts live", () => {
    useUIVisibilityStore.setState({ isUIHidden: true });
    useSurfaceStore.setState({ activeSurfaceId: "browser" });
    render(<App />);
    expect(screen.queryByTestId("browser-surface-view")).toBeNull();
    expect(screen.getByTestId("pixi-shim")).toBeTruthy();
    expect(useSurfaceStore.getState().activeSurfaceId).toBe("canvas");
    expect(isCanvasInputActive()).toBe(true);
  });

  it("offers no switcher in the desktop shell, where the browser surface is unavailable", () => {
    window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
    render(<App />);
    expect(screen.queryByTestId("surface-tab-canvas")).toBeNull();
    expect(screen.queryByTestId("surface-tab-browser")).toBeNull();
  });
});
