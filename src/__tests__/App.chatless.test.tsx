import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";
import { resetChatModeForTests } from "@/lib/chatMode";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

/**
 * `/app?chat=off`: App mounts the real LeftRail + LeftSidebar (only their
 * heavy panels are shimmed) so we can assert the Agents section is gone, the
 * chat-only startup work is skipped, and WebMCP still starts.
 */

vi.mock("@/pixi/PixiCanvas", () => ({ PixiCanvas: () => <div data-testid="pixi-shim" /> }));
vi.mock("@/components/RightPanel", () => ({ RightPanel: () => <div data-testid="right-panel-shim" /> }));
vi.mock("@/components/CanvasHeader", () => ({ CANVAS_HEADER_HEIGHT: 41, CanvasHeader: () => <div data-testid="canvas-header-shim" /> }));
vi.mock("@/components/PresentOverlay", () => ({ PresentOverlay: () => null }));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/plugins/PluginPanels", () => ({ PluginPanels: () => null }));
vi.mock("@/components/canvas/CanvasOverlays", () => ({ FpsDisplay: () => null }));
vi.mock("@/components/canvas/Rulers", () => ({ Rulers: () => null }));
vi.mock("@/components/canvas/CanvasContextMenu", () => ({ CanvasContextMenu: (p: { children: ReactNode }) => p.children }));
vi.mock("@/components/share/ShareDialog", () => ({ ShareDialog: () => null }));
vi.mock("@/components/status/OfflineBanner", () => ({ OfflineBanner: () => null }));
vi.mock("@/components/Toolbar", () => ({ Toolbar: () => <div data-testid="toolbar-shim" /> }));
vi.mock("@/components/layers", () => ({ LayersPanel: () => <div data-testid="layers-shim" /> }));
vi.mock("@/components/PagesPanel", () => ({ PagesPanel: () => <div data-testid="pages-shim" /> }));
vi.mock("@/components/chat/ChatPanel", () => ({ ChatPanelContent: () => <div data-testid="chat-shim" /> }));
vi.mock("@/hooks/useSessionMcpBridge", () => ({ useSessionMcpBridge: vi.fn() }));
vi.mock("@/lib/importShowcaseScreens", () => ({ importShowcaseScreensFromHandoff: vi.fn(async () => {}) }));
vi.mock("@/lib/webmcp", () => ({ startWebMcp: vi.fn(async () => {}), stopWebMcp: vi.fn() }));
vi.mock("@/lib/chatModels", async (orig) => ({
  ...(await orig<typeof import("@/lib/chatModels")>()),
  loadModels: vi.fn(async () => {}),
}));
vi.mock("@/store/chatStore", async (orig) => ({
  ...(await orig<typeof import("@/store/chatStore")>()),
  reconcileModels: vi.fn(),
}));

import App from "@/App";
import { loadModels } from "@/lib/chatModels";
import { storeShowcaseAgentPrompt } from "@/lib/showcaseAgentHandoff";
import { useChatStore } from "@/store/chatStore";
import { importShowcaseScreensFromHandoff } from "@/lib/importShowcaseScreens";
import { startWebMcp } from "@/lib/webmcp";

function open(search: string) {
  window.history.replaceState(null, "", `/app${search}`);
  resetChatModeForTests();
}

describe("<App /> chatless mode", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });
  afterEach(() => {
    cleanup();
    open("");
    sessionStorage.clear();
  });

  it("?chat=off: no Agents rail item or pane, chat startup skipped, tooling still on", () => {
    open("?chat=off");
    storeShowcaseAgentPrompt("design a todo app");
    const chatsBefore = useChatStore.getState().chats.length;
    useLeftSidebarStore.setState({ activeSection: "pages" });
    render(<App />);
    expect(screen.queryByTestId("rail-agents")).toBeNull();
    expect(screen.queryByTestId("chat-shim")).toBeNull();
    expect(screen.getByTestId("rail-pages")).toBeTruthy();
    // The header row (File menu + tools) is part of the chatless canvas tab.
    expect(screen.getByTestId("canvas-header-shim")).toBeTruthy();
    // loadModels still runs: it also carries image-ops capabilities + vision metadata.
    expect(loadModels).toHaveBeenCalled();
    // The showcase prompt is neither consumed nor turned into a chat.
    expect(sessionStorage.getItem("pen:showcase-agent-prompt:v1")).toBe("design a todo app");
    expect(useChatStore.getState().chats.length).toBe(chatsBefore);
    expect(importShowcaseScreensFromHandoff).toHaveBeenCalled();
    expect(startWebMcp).toHaveBeenCalled();
  });

  it("?chat=off with a stale agents section renders the normal default instead", () => {
    open("?chat=off");
    useLeftSidebarStore.setState({ activeSection: "agents" });
    render(<App />);
    expect(screen.queryByTestId("chat-shim")).toBeNull();
    expect(screen.getByTestId("pages-shim")).toBeTruthy();
  });

  it("without the flag: Agents rail item and pane are present, chat startup runs", () => {
    open("");
    storeShowcaseAgentPrompt("design a todo app");
    useLeftSidebarStore.setState({ activeSection: "agents" });
    render(<App />);
    expect(screen.getByTestId("rail-agents")).toBeTruthy();
    expect(screen.getByTestId("chat-shim")).toBeTruthy();
    expect(loadModels).toHaveBeenCalled();
    expect(sessionStorage.getItem("pen:showcase-agent-prompt:v1")).toBeNull();
    expect(startWebMcp).toHaveBeenCalled();
  });
});
