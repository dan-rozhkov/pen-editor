import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudBrowserPanel } from "../CloudBrowserPanel";
import { useCloudBrowserStore } from "@/store/cloudBrowserStore";

const release = vi.fn(async (_chatId: string) => true);
const expire = vi.fn((chatId: string) => useCloudBrowserStore.getState().clearSession(chatId));
vi.mock("@/lib/cloudBrowser", () => ({
  releaseCloudBrowser: (id: string) => release(id),
  expireCloudBrowser: (id: string) => expire(id),
  getCloudBrowserBridge: () => undefined,
  cloudBrowserBridge: undefined,
}));

beforeEach(() => {
  release.mockClear();
  expire.mockClear();
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

  it("hides and clears the session once expiresAt passes", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      useCloudBrowserStore
        .getState()
        .setSession("chat-1", { liveViewUrl: "u", expiresAt: 1_000_000 + 5_000 });
      render(<CloudBrowserPanel chatId="chat-1" />);
      expect(screen.getByTitle("Cloud browser live view")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(5_001);
      });
      expect(screen.queryByTitle("Cloud browser live view")).toBeNull();
      expect(expire).toHaveBeenCalledWith("chat-1");
      expect(useCloudBrowserStore.getState().sessions["chat-1"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes stale at lastUsedAt + idleMs when that is sooner than expiresAt", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(2_000_000);
      useCloudBrowserStore.getState().setSession("chat-1", {
        liveViewUrl: "u",
        expiresAt: 2_000_000 + 600_000,
        lastUsedAt: 2_000_000,
        idleMs: 30_000,
      });
      render(<CloudBrowserPanel chatId="chat-1" />);
      act(() => {
        vi.advanceTimersByTime(29_000);
      });
      expect(screen.getByTitle("Cloud browser live view")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1_500);
      });
      expect(screen.queryByTitle("Cloud browser live view")).toBeNull();
      expect(expire).toHaveBeenCalledWith("chat-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire early for a far-future expiry (setTimeout overflow)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      useCloudBrowserStore
        .getState()
        .setSession("chat-1", { liveViewUrl: "u", expiresAt: 1_000_000 + 40 * 86_400_000 });
      render(<CloudBrowserPanel chatId="chat-1" />);
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(expire).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
});
