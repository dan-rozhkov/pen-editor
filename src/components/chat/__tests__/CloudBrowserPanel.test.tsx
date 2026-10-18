import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudBrowserPanel } from "../CloudBrowserPanel";
import { useCloudBrowserStore } from "@/store/cloudBrowserStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { useChatStore } from "@/store/chatStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useUIVisibilityStore } from "@/store/uiVisibilityStore";
import { useSharedViewStore } from "@/store/sharedViewStore";

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => mobile.value,
  isMobileViewport: () => mobile.value,
}));

const release = vi.fn(async (_chatId: string) => true);
vi.mock("@/lib/cloudBrowser", () => ({
  releaseCloudBrowser: (id: string) => release(id),
  getCloudBrowserBridge: () => undefined,
  cloudBrowserBridge: undefined,
}));

beforeEach(() => {
  mobile.value = false;
  useSurfaceStore.setState({ activeSurfaceId: "canvas", browserChatId: null });
  release.mockClear();
  useChatStore.setState({ activeChatId: "chat-1" });
  useEditorModeStore.setState({ mode: "edit" });
  useDevModeStore.setState({ active: false });
  useUIVisibilityStore.setState({ isUIHidden: false });
  useSharedViewStore.setState({ isSharedView: false });
  useCloudBrowserStore.setState({ sessions: {} });
});

afterEach(() => {
  cleanup();
  delete window.penDesktop;
});

const SESSION = { liveViewUrl: "https://live.example/v/1", expiresAt: null };

describe("<CloudBrowserPanel />", () => {
  it("renders nothing without a session for this chat", () => {
    useCloudBrowserStore.getState().setSession("other", SESSION);
    const { container } = render(<CloudBrowserPanel chatId="chat-1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing in the desktop shell", () => {
    window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    const { container } = render(<CloudBrowserPanel chatId="chat-1" />);
    expect(container.firstChild).toBeNull();
  });

  it("still shows for a penDesktop without .browser (cloud bridge is in use)", () => {
    window.penDesktop = { onMenuCommand: () => () => {} };
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    render(<CloudBrowserPanel chatId="chat-1" />);
    expect(screen.getByTitle("Cloud browser live view")).toBeTruthy();
  });

  it("shows a sandboxed live-view iframe and an open-in-new-tab link", () => {
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    render(<CloudBrowserPanel chatId="chat-1" />);

    const frame = screen.getByTitle("Cloud browser live view");
    expect(frame.getAttribute("src")).toBe(SESSION.liveViewUrl);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    const link = screen.getByRole("button", { name: "Open in new tab" });
    expect(link?.getAttribute("href")).toBe(SESSION.liveViewUrl);
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("collapses and expands the iframe", () => {
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    render(<CloudBrowserPanel chatId="chat-1" />);
    fireEvent.click(screen.getByLabelText("Collapse browser view"));
    expect(screen.queryByTitle("Cloud browser live view")).toBeNull();
    fireEvent.click(screen.getByLabelText("Expand browser view"));
    expect(screen.getByTitle("Cloud browser live view")).toBeTruthy();
  });

  it("releases the session on Close browser", () => {
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    render(<CloudBrowserPanel chatId="chat-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close browser" }));
    expect(release).toHaveBeenCalledWith("chat-1");
  });

  it("opens the browser surface in the main area", () => {
    useSurfaceStore.setState({ activeSurfaceId: "canvas" });
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    render(<CloudBrowserPanel chatId="chat-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Open in main area" }));
    expect(useSurfaceStore.getState().activeSurfaceId).toBe("browser");
    expect(useSurfaceStore.getState().browserChatId).toBe("chat-1");
  });

  it("keeps no live-view iframe while the main area shows the browser, and offers a way back", () => {
    useSurfaceStore.setState({ activeSurfaceId: "browser" });
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    render(<CloudBrowserPanel chatId="chat-1" />);
    expect(screen.queryByTitle("Cloud browser live view")).toBeNull();
    expect(screen.getByText("Shown in main area")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show here" }));
    expect(useSurfaceStore.getState().activeSurfaceId).toBe("canvas");
  });

  it("only the chat whose session the main area shows gives up its iframe", () => {
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    useCloudBrowserStore.getState().setSession("chat-2", { ...SESSION, liveViewUrl: "https://live.example/v/2" });
    useSurfaceStore.getState().setActiveSurface("browser", { chatId: "chat-2" });
    render(
      <>
        <CloudBrowserPanel chatId="chat-1" />
        <CloudBrowserPanel chatId="chat-2" />
      </>,
    );
    expect(screen.getAllByText("Shown in main area")).toHaveLength(1);
    const frames = screen.getAllByTitle("Cloud browser live view");
    expect(frames).toHaveLength(1);
    expect(frames[0].getAttribute("src")).toBe("https://live.example/v/1");
  });

  it("when the pinned chat's session ends, the active chat's panel takes over the main area", () => {
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    useCloudBrowserStore.getState().setSession("chat-2", SESSION);
    useSurfaceStore.getState().setActiveSurface("browser", { chatId: "chat-2" });
    useCloudBrowserStore.getState().clearSession("chat-2");
    render(<CloudBrowserPanel chatId="chat-1" />);
    expect(screen.getByText("Shown in main area")).toBeTruthy();
  });

  it.each([
    ["mobile", () => { mobile.value = true; }],
    ["dev mode", () => useDevModeStore.setState({ active: true })],
    ["view mode", () => useEditorModeStore.setState({ mode: "view" })],
    ["hidden UI", () => useUIVisibilityStore.setState({ isUIHidden: true })],
    ["the shared viewer", () => useSharedViewStore.setState({ isSharedView: true })],
  ])("in %s offers no main-area button and keeps its iframe even if the browser surface is stored", (_n, enter) => {
    enter();
    useSurfaceStore.setState({ activeSurfaceId: "browser" });
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    render(<CloudBrowserPanel chatId="chat-1" />);
    expect(screen.queryByRole("button", { name: "Open in main area" })).toBeNull();
    expect(screen.getByTitle("Cloud browser live view")).toBeTruthy();
  });
});
