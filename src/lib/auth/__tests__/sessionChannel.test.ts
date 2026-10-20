import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authClientMock, clearDesktopAuth, CONFIG_ALL, resetAuthMocks, stubAuthConfig, stubDesktopAuth } from "@/test/authMocks";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/authClient", async () => (await import("@/test/authMocks")).authClientModule());

import { desktopAuth } from "../desktopAuth";
import { startSessionBridge } from "../sessionChannel";

const TOKEN = { token: "tok-1", verifier: "ver-1" };
let stops: Array<() => void> = [];
const start = () => {
  const stop = startSessionBridge();
  stops.push(stop);
  return stop;
};

beforeEach(resetAuthMocks);
afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
  clearDesktopAuth();
  vi.unstubAllGlobals();
});

describe("desktopAuth()", () => {
  it("is null on the web and on a shell without auth", () => {
    expect(desktopAuth()).toBeNull();
    (window as unknown as { penDesktop: unknown }).penDesktop = {};
    expect(desktopAuth()).toBeNull();
  });

  it("finds the bridge on window.penDesktop or window.penAgentPanel", () => {
    const { signIn } = stubDesktopAuth();
    expect(desktopAuth()?.signIn).toBe(signIn);
    clearDesktopAuth();
    const panelAuth = { signIn: vi.fn(), onToken: vi.fn() };
    (window as unknown as { penAgentPanel: unknown }).penAgentPanel = { version: 2, auth: panelAuth };
    expect(desktopAuth()).toBe(panelAuth);
  });
});

const CHANNEL_KEY = "better-auth.message";

describe("session bridge", () => {
  beforeEach(() => {
    localStorage.removeItem(CHANNEL_KEY);
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("exchanges the token, refetches here, tells Better Auth's other views and toasts", async () => {
    const fetchMock = stubAuthConfig(
      CONFIG_ALL,
      () => new Response(JSON.stringify({ user: { id: "u", email: "a@b.co" } }), { status: 200 }),
    );
    const desktop = stubDesktopAuth();
    start();

    desktop.deliver(TOKEN);
    await vi.waitFor(() => expect(authClientMock.$store.notify).toHaveBeenCalledWith("$sessionSignal"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/account\/desktop-exchange$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(TOKEN);
    const msg = JSON.parse(localStorage.getItem(CHANNEL_KEY)!);
    expect(msg).toMatchObject({ event: "session", data: { trigger: "getSession" } });
    expect(toast.success).toHaveBeenCalledWith("Signed in as a@b.co");
  });

  it("a failed exchange refetches nothing, broadcasts nothing and shows a toast", async () => {
    stubAuthConfig(CONFIG_ALL, () => new Response("{}", { status: 400 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const desktop = stubDesktopAuth();
    start();

    desktop.deliver(TOKEN);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith("Sign-in failed. Try again from the menu.");
    expect(authClientMock.$store.notify).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHANNEL_KEY)).toBeNull();
    warn.mockRestore();
  });

  it("unsubscribes from the shell when stopped", () => {
    const desktop = stubDesktopAuth();
    startSessionBridge()();
    expect(desktop.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
