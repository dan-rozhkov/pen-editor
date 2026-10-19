import { afterEach, describe, expect, it, vi } from "vitest";
import { textTurn } from "@/test/sseStream";
import { setPenDesktop, stubBrowser } from "./helpers";
import { BROWSE_AGENT_DEADLINE_MS } from "../browseAgent";
import { APP_LAUNCH_ALLOWANCE_MS } from "../isolation";

// Captures the options the handler gives the package session.
const sessionOptions: Array<Record<string, unknown>> = [];
vi.mock("@sideform/browser-agent/agent/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sideform/browser-agent/agent/session")>();
  return {
    ...actual,
    createBrowseAgentSession: (opts: Parameters<typeof actual.createBrowseAgentSession>[0]) => {
      sessionOptions.push(opts as unknown as Record<string, unknown>);
      return actual.createBrowseAgentSession(opts);
    },
  };
});

import { browseAgent } from "../browseAgent";
import { toolHandlers } from "@/lib/toolRegistry";

afterEach(() => {
  delete window.penDesktop;
  vi.unstubAllGlobals();
  sessionOptions.length = 0;
});

async function run(args: Record<string, unknown>) {
  setPenDesktop(stubBrowser({ launchApp: async () => ({}), releaseApp: async () => ({}) }));
  toolHandlers.browse_open = async () => JSON.stringify({ url: "x" });
  vi.stubGlobal("fetch", vi.fn(async () => textTurn("ok")));
  await browseAgent({ goal: "g", ...args }, { sessionId: "chat-1", toolCallId: "tc-1" });
  return sessionOptions[0];
}

describe("browse_agent inner deadline", () => {
  it("adds the app allowance to the inner deadline only when app is set", async () => {
    const withApp = await run({ app: "Notes" });
    expect(withApp.deadlineMs).toBe(BROWSE_AGENT_DEADLINE_MS + APP_LAUNCH_ALLOWANCE_MS);
    sessionOptions.length = 0;
    const plain = await run({ url: "https://a.test" });
    expect(plain.deadlineMs).toBeUndefined();
  });
});
