import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textTurn } from "@/test/sseStream";
import { cleanupBrowseAgentTest } from "./helpers";
import { browseAgent } from "../browseAgent";
import { appSessionId, runSessionForCall } from "../isolation";
import { resetBrowserBridgeCacheForTests } from "../bridge";
import { toolHandlers } from "@/lib/toolRegistry";
import * as limiter from "@/lib/browseRunLimiter";

type Bridge = Record<string, ReturnType<typeof vi.fn>>;
const bridgeOf = (): Bridge => ({
  open: vi.fn(async () => ({})),
  act: vi.fn(async () => ({})),
  snapshot: vi.fn(async () => ({})),
  perform: vi.fn(async () => ({})),
  clearActEmulation: vi.fn(async () => ({ ok: true })),
  launchApp: vi.fn(async () => ({})),
  releaseApp: vi.fn(async () => ({ ok: true })),
});

let shared: Bridge;
let byId: Map<string, Bridge>;
let isolated: ReturnType<typeof vi.fn>;
let closeSession: ReturnType<typeof vi.fn>;
let openCtx: Array<{ sessionId?: string; browserSession?: string }>;

function install(withIsolated = true) {
  window.penDesktop = {
    onMenuCommand: () => () => {},
    browser: { ...shared, ...(withIsolated ? { isolated, closeSession } : {}) },
  } as never;
}

beforeEach(() => {
  resetBrowserBridgeCacheForTests();
  shared = bridgeOf();
  byId = new Map();
  isolated = vi.fn((id: string) => {
    const b = bridgeOf();
    byId.set(id, b);
    return b;
  });
  closeSession = vi.fn(async () => ({ ok: true }));
  openCtx = [];
  toolHandlers.browse_open = async (_a, c) => {
    openCtx.push({ sessionId: c?.sessionId, browserSession: (c as { browserSession?: string } | undefined)?.browserSession });
    return JSON.stringify({ url: "x" });
  };
  vi.stubGlobal("fetch", vi.fn(async () => textTurn("ok")));
  install();
});

afterEach(() => cleanupBrowseAgentTest(() => {}));

describe("browse_agent native-app run: per-run app session", () => {
  it("gives two chats different sessions, and the same chat two runs different ones", async () => {
    await browseAgent({ goal: "g", app: "Calculator" }, { sessionId: "chat-1", toolCallId: "tc-1" });
    await browseAgent({ goal: "g", app: "TextEdit" }, { sessionId: "chat-2", toolCallId: "tc-2" });
    await browseAgent({ goal: "g", app: "Calculator" }, { sessionId: "chat-1", toolCallId: "tc-3" });
    const sessions = openCtx.map((c) => c.browserSession);
    expect(sessions.every((id) => typeof id === "string" && /^app-[A-Za-z0-9_-]{1,60}$/.test(id))).toBe(true);
    expect(new Set(sessions).size).toBe(3);
    expect(runSessionForCall("tc-1")).toBe(sessions[0]);
    expect(runSessionForCall("tc-3")).toBe(sessions[2]);
    expect(sessions[0]).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("two concurrent runs of one chat use separate sessions; finishing one releases only its own app", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => (releaseFirst = r));
    toolHandlers.browse_open = async (_a, c) => {
      const id = (c as { browserSession?: string }).browserSession;
      openCtx.push({ sessionId: c?.sessionId, browserSession: (c as { browserSession?: string } | undefined)?.browserSession });
      if (id === runSessionForCall("tc-a")) await gate;
      return JSON.stringify({ url: "x" });
    };
    const a = browseAgent({ goal: "g", app: "Calculator" }, { sessionId: "chat-conc", toolCallId: "tc-a" });
    const b = browseAgent({ goal: "g", app: "TextEdit" }, { sessionId: "chat-conc", toolCallId: "tc-b" });
    await b;
    const idA = runSessionForCall("tc-a")!;
    const idB = runSessionForCall("tc-b")!;
    expect(idA).toBeDefined();
    expect(idA).not.toBe(idB);
    // B is done: only B's bridge released, only B's session closed; A still running.
    expect(byId.get(idB)!.releaseApp).toHaveBeenCalledTimes(1);
    expect(byId.get(idA)?.releaseApp ?? vi.fn()).not.toHaveBeenCalled();
    expect(closeSession).toHaveBeenCalledWith(idB);
    expect(closeSession).not.toHaveBeenCalledWith(idA);
    releaseFirst();
    await a;
    expect(byId.get(idA)!.releaseApp).toHaveBeenCalledTimes(1);
    expect(closeSession).toHaveBeenCalledWith(idA);
    expect(shared.releaseApp).not.toHaveBeenCalled();
  });

  it("releases the app on the session's bridge and closes the session at the end", async () => {
    await browseAgent({ goal: "g", app: "Calculator" }, { sessionId: "chat-release", toolCallId: "tc-1" });
    const id = runSessionForCall("tc-1")!;
    expect(id).toMatch(/^app-/);
    const bridge = byId.get(id)!;
    expect(bridge.releaseApp).toHaveBeenCalledTimes(1);
    expect(bridge.clearActEmulation).toHaveBeenCalledTimes(1);
    expect(shared.releaseApp).not.toHaveBeenCalled();
    expect(shared.clearActEmulation).not.toHaveBeenCalled();
    expect(closeSession).toHaveBeenCalledTimes(1);
    expect(closeSession).toHaveBeenCalledWith(id);
  });

  it("takes no browse slot", async () => {
    const spy = vi.spyOn(limiter, "acquireBrowseSlot");
    const before = { ...limiter.browseRunCounts() };
    let during: ReturnType<typeof limiter.browseRunCounts> | undefined;
    toolHandlers.browse_open = async () => {
      during = { ...limiter.browseRunCounts() };
      return JSON.stringify({ url: "x" });
    };
    await browseAgent({ goal: "g", app: "Calculator" }, { sessionId: "chat-slot", toolCallId: "tc-1" });
    expect(spy).not.toHaveBeenCalled();
    expect(during).toEqual(before);
  });

  it("keeps the id valid for the shell when ids are long or have odd characters", () => {
    expect(appSessionId("c".repeat(300), "t".repeat(300))).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(appSessionId("c", "x".repeat(100) + "1")).not.toBe(appSessionId("c", "x".repeat(100) + "2"));
    // A repeated tool call id still gets a fresh id (a closed id is dead for good).
    expect(appSessionId("chat-1", "t")).not.toBe(appSessionId("chat-1", "t"));
    expect(appSessionId("chat-1", "t")).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(appSessionId("chat-1")).toMatch(/^app-[A-Za-z0-9_-]+$/);
    expect(appSessionId("chat-1")).not.toBe(appSessionId("chat-1"));
  });

  it("an isolated QA app run keeps its own per-run session and closes it", async () => {
    await browseAgent({ goal: "g", app: "Calculator", qa: true }, { sessionId: "chat-1", toolCallId: "tc-1" });
    const id = isolated.mock.calls[0][0] as string;
    expect(id.startsWith("qa-")).toBe(true);
    expect(closeSession).toHaveBeenCalledWith(id);
  });

  it("a run without app keeps the shared browser", async () => {
    await browseAgent({ goal: "g", url: "https://a.test" }, { sessionId: "chat-1", toolCallId: "tc-1" });
    expect(isolated).not.toHaveBeenCalled();
    expect(closeSession).not.toHaveBeenCalled();
    expect(openCtx.every((c) => c.browserSession === undefined)).toBe(true);
  });

  it("without a chat id the app run keeps the shared bridge", async () => {
    await browseAgent({ goal: "g", app: "Calculator" }, { toolCallId: "tc-1" });
    expect(isolated).not.toHaveBeenCalled();
    expect(openCtx[0]?.browserSession).toBeUndefined();
    expect(shared.releaseApp).toHaveBeenCalledTimes(1);
  });

  it("a shell without browser.isolated keeps the shared bridge", async () => {
    install(false);
    await browseAgent({ goal: "g", app: "Calculator" }, { sessionId: "chat-1", toolCallId: "tc-1" });
    expect(openCtx[0]?.browserSession).toBeUndefined();
    expect(shared.releaseApp).toHaveBeenCalledTimes(1);
  });
});
