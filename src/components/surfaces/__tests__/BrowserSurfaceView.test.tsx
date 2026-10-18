import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BrowserSurfaceView } from "../BrowserSurfaceView";
import { useChatStore } from "@/store/chatStore";
import { useCloudBrowserStore } from "@/store/cloudBrowserStore";
import { useSurfaceStore } from "@/store/surfaceStore";

beforeEach(() => {
  useChatStore.setState({ activeChatId: "chat-1" });
  useCloudBrowserStore.setState({ sessions: {} });
  useSurfaceStore.setState({ activeSurfaceId: "canvas", browserChatId: null });
});

afterEach(() => {
  cleanup();
  delete window.penDesktop;
});

const SESSION = { liveViewUrl: "https://live.example/v/1", expiresAt: null };

describe("<BrowserSurfaceView />", () => {
  it("fills the area with the live view of this chat's cloud session", () => {
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    render(<BrowserSurfaceView />);
    const frame = screen.getByTitle("Cloud browser live view");
    expect(frame.getAttribute("src")).toBe(SESSION.liveViewUrl);
  });

  it("ignores another chat's session", () => {
    useCloudBrowserStore.getState().setSession("other", SESSION);
    render(<BrowserSurfaceView />);
    expect(screen.queryByTitle("Cloud browser live view")).toBeNull();
    expect(screen.getByText(/opens a browser here/i)).toBeTruthy();
  });

  it("shows the session of the chat it was opened from, not the active chat's", () => {
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    useCloudBrowserStore.getState().setSession("chat-2", { ...SESSION, liveViewUrl: "https://live.example/v/2" });
    useSurfaceStore.getState().setActiveSurface("browser", { chatId: "chat-2" });
    render(<BrowserSurfaceView />);
    expect(screen.getByTitle("Cloud browser live view").getAttribute("src")).toBe("https://live.example/v/2");
  });

  it("falls back to the active chat once the pinned chat's session is gone", () => {
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    useSurfaceStore.getState().setActiveSurface("browser", { chatId: "chat-2" });
    render(<BrowserSurfaceView />);
    expect(screen.getByTitle("Cloud browser live view").getAttribute("src")).toBe(SESSION.liveViewUrl);
  });

  it("explains that the browser is a desktop tab on desktop", () => {
    window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
    useCloudBrowserStore.getState().setSession("chat-1", SESSION);
    render(<BrowserSurfaceView />);
    expect(screen.getByText(/tab of the desktop app/i)).toBeTruthy();
    expect(screen.queryByTitle("Cloud browser live view")).toBeNull();
  });

  it("shows an empty state without a session", () => {
    render(<BrowserSurfaceView />);
    expect(screen.getByText(/opens a browser here/i)).toBeTruthy();
  });
});
