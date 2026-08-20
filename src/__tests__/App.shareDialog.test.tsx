import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";

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
vi.mock("@/components/pwa/OfflineBanner", () => ({ OfflineBanner: () => <div data-testid="offline-banner-shim" /> }));
vi.mock("@/components/share/ShareDialog", () => ({ ShareDialog: () => <div data-testid="share-dialog-shim" /> }));

import App from "@/App";

describe("<App /> — ShareDialog mount", () => {
  beforeEach(() => {
    resetStores();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSharedViewStore.setState({ isSharedView: false });
  });

  afterEach(() => {
    cleanup();
  });

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
