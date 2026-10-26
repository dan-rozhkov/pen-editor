import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearOpenCodeKey } from "@/lib/opencodeKey";
import { toolHandlers, type ToolHandler } from "@/lib/toolRegistry";
import { sse } from "@/test/sseStream";
import { setPenDesktop, stubBrowser } from "./helpers";
import { browseAgent } from "../browseAgent";

// Playwright export: a run that keeps a trace executes its nested browse_act / qa_assert with `repro: true`,
// and the model never sees the `__repro` capture.

const toolTurn = (toolName: string, input: unknown, toolCallId: string): Response =>
  sse([
    { type: "start" },
    { type: "start-step" },
    { type: "tool-input-available", toolCallId, toolName, input },
    { type: "finish-step" },
    { type: "finish" },
  ]);

interface Captured {
  body: Record<string, unknown>;
}

function stubFetch(script: Array<() => Response>) {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/browse/traces") || String(input).includes("/api/browser/")) {
        return new Response(JSON.stringify({ id: "t" }), { status: 503 });
      }
      captured.push({ body: JSON.parse(String(init?.body)) });
      const next = script[captured.length - 1];
      if (!next) throw new Error("unexpected extra request");
      return next();
    }),
  );
  return captured;
}

const outputsOf = (captured: Captured[]): string[] =>
  (captured.at(-1)!.body.messages as Array<{ parts: Array<Record<string, unknown>> }>)
    .flatMap((m) => m.parts)
    .filter((p) => typeof p.output === "string")
    .map((p) => p.output as string);

const CAPTURE = { locator: { kind: "testid", value: "go" } };
const ACT = { action: "press", key: "Enter" };

describe("browse_agent repro (Playwright export)", () => {
  let saved: Record<string, ToolHandler | undefined>;
  const stubbed = ["browse_open"];
  beforeEach(() => {
    saved = Object.fromEntries(stubbed.map((n) => [n, toolHandlers[n]]));
    toolHandlers.browse_open = async () => JSON.stringify({ ok: true });
    clearOpenCodeKey();
  });
  afterEach(() => {
    for (const n of stubbed) {
      if (saved[n]) toolHandlers[n] = saved[n];
      else delete toolHandlers[n];
    }
    delete window.penDesktop;
    vi.unstubAllGlobals();
  });

  const bridge = () => {
    const act = vi.fn(async (_args: Record<string, unknown>) => ({ ok: true, __repro: CAPTURE }));
    const assert = vi.fn(async (_args: Record<string, unknown>) => ({ ok: true, passed: true, results: [{ check: { type: "text", text: "Hi" }, passed: true }] }));
    return { act, assert };
  };
  const script = () =>
    stubFetch([
      () => toolTurn("browse_act", ACT, "c1"),
      () => toolTurn("qa_assert", { checks: [{ type: "text", text: "Hi" }] }, "c2"),
      () => toolTurn("qa_verdict", { verdict: "pass", reason: "ok" }, "c3"),
    ]);
  const ctx = { sessionId: "chat-1", toolCallId: "tc-r" };

  it("a QA run with a trace: act and assert get repro: true, the trace stores the setup, the model sees no __repro", async () => {
    const { act, assert } = bridge();
    const save = vi.fn(async () => ({ id: "local-1" }));
    setPenDesktop(stubBrowser({ act, assert }));
    window.penDesktop!.traces = { save, read: async () => ({ error: "n/a" }) };
    const captured = script();
    await browseAgent({ goal: "g", qa: true, url: "https://shop.test" }, ctx);
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ repro: true }));
    expect(assert).toHaveBeenCalledWith(expect.objectContaining({ repro: true }));
    const outputs = outputsOf(captured);
    expect(outputs.length).toBeGreaterThan(0);
    for (const o of outputs) expect(o).not.toContain("__repro");
    const manifest = (save.mock.calls[0] as unknown as [{ manifest: { repro?: unknown; steps: Array<{ repro?: unknown }> } }])[0].manifest;
    expect(manifest.repro).toBeDefined();
    expect(manifest.steps.some((s) => s.repro)).toBe(true);
  });

  it("a run without a trace: act and assert carry no repro", async () => {
    const { act, assert } = bridge();
    // A desktop shell without a trace save bridge keeps no trace.
    setPenDesktop(stubBrowser({ act, assert }));
    const captured = script();
    await browseAgent({ goal: "g", qa: true, url: "https://shop.test" }, ctx);
    expect(act).toHaveBeenCalled();
    expect(act.mock.calls[0]![0]).not.toHaveProperty("repro");
    expect(assert.mock.calls[0]![0]).not.toHaveProperty("repro");
    for (const o of outputsOf(captured)) expect(o).not.toContain("__repro");
  });
});
