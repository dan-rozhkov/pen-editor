import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionMcpBridge } from "@/hooks/useSessionMcpBridge";
import { useAuthStore } from "@/lib/auth/authState";
import { useMcpBridgeStore } from "@/store/mcpBridgeStore";

class SocketStub {
  static OPEN = 1;
  static instances: SocketStub[] = [];
  readyState = 0;
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    SocketStub.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
  send() {}
}

const signIn = () => act(() => useAuthStore.getState().setSession("user-1"));
const signOut = () => act(() => useAuthStore.getState().setSession(null));

beforeEach(() => {
  SocketStub.instances = [];
  useAuthStore.setState({ status: "unknown", userId: null });
  useMcpBridgeStore.setState({ status: "off" });
  vi.stubGlobal("WebSocket", SocketStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { penDesktop?: unknown }).penDesktop;
});

describe("useSessionMcpBridge", () => {
  it("stays disconnected while signed out", () => {
    renderHook(() => useSessionMcpBridge(true));
    signOut();
    expect(SocketStub.instances).toHaveLength(0);
  });

  it("connects without a token once signed in, and disconnects on sign-out", () => {
    renderHook(() => useSessionMcpBridge(true));
    signIn();

    expect(SocketStub.instances).toHaveLength(1);
    expect(SocketStub.instances[0].url).toMatch(/\/api\/mcp\/ws$/);
    expect(SocketStub.instances[0].url).not.toContain("token");

    signOut();
    expect(SocketStub.instances[0].closed).toBe(true);
    expect(useMcpBridgeStore.getState().status).toBe("off");
  });

  it("disconnects when the editor unmounts", () => {
    const { unmount } = renderHook(() => useSessionMcpBridge(true));
    signIn();
    unmount();
    expect(SocketStub.instances[0].closed).toBe(true);
  });

  it("reconnects as the new account when the user id changes", () => {
    renderHook(() => useSessionMcpBridge(true));
    signIn();
    expect(SocketStub.instances).toHaveLength(1);

    act(() => useAuthStore.getState().setSession("user-2"));
    expect(SocketStub.instances[0].closed).toBe(true);
    expect(SocketStub.instances).toHaveLength(2);
    expect(SocketStub.instances[1].closed).toBe(false);
  });

  it("does nothing in the read-only shared viewer", () => {
    renderHook(() => useSessionMcpBridge(false));
    signIn();
    expect(SocketStub.instances).toHaveLength(0);
  });

  it("yields to the desktop shell", () => {
    (window as unknown as { penDesktop: unknown }).penDesktop = {};
    renderHook(() => useSessionMcpBridge(true));
    signIn();
    expect(SocketStub.instances).toHaveLength(0);
  });
});
