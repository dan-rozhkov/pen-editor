import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberRunSession } from "@/lib/tools/browser/isolation";
import { getPanelClient, resetPanelRuntimeForTests } from "../panelRuntime";
import { revealToolTab } from "../revealToolTab";
import { attachScriptedCanvas, createFakeCanvasBridge, tab } from "./fakeCanvasBridge";

type PanelApi = NonNullable<Window["penAgentPanel"]>;

const QA_INPUT = { qa: true, goal: "Sign up" };

function installPanel(tabs = [tab(1), tab(2)], revealAgentTab: unknown = vi.fn(async () => true)) {
  const fake = createFakeCanvasBridge(tabs);
  const activateTab = vi.fn();
  fake.bridge.activateTab = activateTab;
  window.penAgentPanel = { version: 2, canvas: fake.bridge, browser: { revealAgentTab, isolated: vi.fn() } as unknown as PanelApi["browser"] };
  return { fake, activateTab, revealAgentTab: revealAgentTab as ReturnType<typeof vi.fn> };
}

afterEach(() => {
  resetPanelRuntimeForTests();
  delete window.penAgentPanel;
});

describe("revealToolTab: canvas tools", () => {
  it("activates the tab the call was sent to", async () => {
    const { fake, activateTab } = installPanel();
    attachScriptedCanvas(fake);
    await getPanelClient()!.callTool("s", "batch_design", {}, { toolCallId: "c1", timeoutMs: 1000 });
    await revealToolTab({ sessionId: "s", toolCallId: "c1", toolName: "batch_design" });
    expect(activateTab).toHaveBeenCalledWith(1);
  });

  it("falls back to the chat's live binding for an unknown call", async () => {
    const { fake, activateTab } = installPanel();
    attachScriptedCanvas(fake);
    await getPanelClient()!.callTool("s", "batch_design", {}, { toolCallId: "c1", timeoutMs: 1000 });
    await revealToolTab({ sessionId: "s", toolCallId: "unknown", toolName: "batch_get" });
    expect(activateTab).toHaveBeenCalledWith(1);
  });

  it("does not fall back for a call whose tab is gone", async () => {
    const { fake, activateTab } = installPanel();
    attachScriptedCanvas(fake);
    await getPanelClient()!.callTool("s", "batch_design", {}, { toolCallId: "c1", timeoutMs: 1000 });
    fake.closeTab(1);
    await getPanelClient()!.callTool("s", "batch_get", {}, { toolCallId: "c2", timeoutMs: 1000 });
    activateTab.mockClear();
    await revealToolTab({ sessionId: "s", toolCallId: "c1", toolName: "batch_design" });
    expect(activateTab).not.toHaveBeenCalled();
  });

  it("does not fall back for a backend or MCP tool", async () => {
    const { fake, activateTab } = installPanel();
    attachScriptedCanvas(fake);
    await getPanelClient()!.callTool("s", "batch_get", {}, { toolCallId: "c1", timeoutMs: 1000 });
    activateTab.mockClear();
    for (const toolName of ["load_skill", "mobbin_search_screens"]) {
      await revealToolTab({ sessionId: "s", toolCallId: "x", toolName });
    }
    expect(activateTab).not.toHaveBeenCalled();
  });

  it("does nothing without a binding", async () => {
    const { activateTab } = installPanel();
    getPanelClient();
    await revealToolTab({ sessionId: "s", toolCallId: "c1", toolName: "batch_get" });
    expect(activateTab).not.toHaveBeenCalled();
  });

  it("reveals the bound tab for open_canvas_tab", async () => {
    const { fake, activateTab } = installPanel();
    attachScriptedCanvas(fake);
    await getPanelClient()!.callTool("s", "batch_get", {}, { toolCallId: "c1", timeoutMs: 1000 });
    await revealToolTab({ sessionId: "s", toolCallId: "c2", toolName: "open_canvas_tab" });
    expect(activateTab).toHaveBeenCalledWith(1);
  });
});

describe("revealToolTab: browser tools", () => {
  it("reveals the shared browser for a browse_* call", async () => {
    const { revealAgentTab } = installPanel();
    await revealToolTab({ sessionId: "s", toolCallId: "c1", toolName: "browse_open" });
    expect(revealAgentTab).toHaveBeenCalledWith(undefined);
  });

  it("reveals the shared browser for a browse_agent call that is not isolated", async () => {
    const { revealAgentTab } = installPanel();
    await revealToolTab({ sessionId: "s", toolCallId: "c-plain", toolName: "browse_agent" });
    expect(revealAgentTab).toHaveBeenCalledWith(undefined);
  });

  it("reveals the shared browser for a qa_* call", async () => {
    const { revealAgentTab } = installPanel();
    await revealToolTab({ sessionId: "s", toolCallId: "c1", toolName: "qa_assert" });
    expect(revealAgentTab).toHaveBeenCalledWith(undefined);
  });

  it("never reveals the shared browser for an isolated QA run it does not remember", async () => {
    const { revealAgentTab } = installPanel();
    await revealToolTab({ sessionId: "s", toolCallId: "c-waiting", toolName: "browse_agent", input: QA_INPUT });
    expect(revealAgentTab).not.toHaveBeenCalled();
  });

  it("reveals the isolated session of a remembered browse_agent run", async () => {
    const { revealAgentTab } = installPanel();
    rememberRunSession("c-qa", "qa-abc-c-qa-1");
    await revealToolTab({ sessionId: "s", toolCallId: "c-qa", toolName: "browse_agent", input: QA_INPUT });
    expect(revealAgentTab).toHaveBeenCalledWith("qa-abc-c-qa-1");
    expect(revealAgentTab).toHaveBeenCalledTimes(1);
  });

  it("does nothing more when the shell answers false", async () => {
    const { revealAgentTab, activateTab } = installPanel(undefined, vi.fn(async () => false));
    rememberRunSession("c-done", "qa-abc-c-done-1");
    await revealToolTab({ sessionId: "s", toolCallId: "c-done", toolName: "browse_agent", input: QA_INPUT });
    expect(revealAgentTab).toHaveBeenCalledTimes(1);
    expect(activateTab).not.toHaveBeenCalled();
  });

  it("does not throw on an older shell without revealAgentTab", async () => {
    installPanel(undefined, undefined);
    await expect(revealToolTab({ sessionId: "s", toolCallId: "c1", toolName: "browse_open" })).resolves.toBeUndefined();
  });

  it("swallows a rejected reveal", async () => {
    installPanel(undefined, vi.fn(async () => Promise.reject(new Error("boom"))));
    await expect(revealToolTab({ sessionId: "s", toolCallId: "c1", toolName: "browse_open" })).resolves.toBeUndefined();
  });
});

describe("revealToolTab: no-ops", () => {
  it("ignores panel-local tools", async () => {
    const { revealAgentTab, activateTab } = installPanel();
    for (const toolName of ["ask_user", "analyze_image", "get_guidelines"]) {
      await revealToolTab({ sessionId: "s", toolCallId: "c1", toolName });
    }
    expect(revealAgentTab).not.toHaveBeenCalled();
    expect(activateTab).not.toHaveBeenCalled();
  });

  it("does nothing outside the agent panel", async () => {
    await expect(revealToolTab({ sessionId: "s", toolCallId: "c1", toolName: "browse_open" })).resolves.toBeUndefined();
    await expect(revealToolTab({ sessionId: "s", toolCallId: "c1", toolName: "batch_design" })).resolves.toBeUndefined();
  });
});
