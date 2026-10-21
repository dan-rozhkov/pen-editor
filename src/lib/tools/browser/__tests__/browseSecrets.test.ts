import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browseAct } from "@/lib/tools/browser/browseAct";
import { browseRead } from "@/lib/tools/browser/browseRead";
import { browseCapture } from "@/lib/tools/browser/browseCapture";
import { resolveSetupSecrets } from "@/lib/tools/browser/browseAgent";
import { withSecrets } from "@/lib/tools/browser/shared";
import { toolHandlers } from "@/lib/toolRegistry";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import { resetBrowseSecrets, useBrowseSecretStore } from "@/store/browseSecretStore";
import { textTurn } from "@/test/sseStream";
import { browseAgent } from "@/lib/tools/browser/browseAgent";
import { cleanupBrowseAgentTest, fixtureBridgeMocks, setPenDesktop, stubBrowseOpenSnapshot, stubBrowser } from "./helpers";

vi.mock("@/lib/cloudBrowser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cloudBrowser")>()),
  cloudBrowserBridge: undefined,
  getCloudBrowserBridge: () => undefined,
}));

const PASSWORD = "hunter2-real";

beforeEach(() => {
  resetBrowseSecrets();
  useBrowseSecretStore.getState().set("s1", "pw", PASSWORD);
});
afterEach(() => {
  delete window.penDesktop;
  resetBrowseSecrets();
});

describe("secret placeholders in browser tools", () => {
  it("types the real value, and the result never shows it", async () => {
    let received: Record<string, unknown> | undefined;
    setPenDesktop(
      stubBrowser({
        act: async (args) => {
          received = args;
          return { matched: "ok", changed: true, echo: `field now holds ${String(args.text)}` };
        },
      }),
    );

    const out = await browseAct({ action: "type", index: 1, text: "{{secret:pw}}", snapshotId: "snap" }, { sessionId: "s1" });

    expect(received?.text).toBe(PASSWORD);
    expect(out).not.toContain(PASSWORD);
    expect(out).toContain("{{secret:pw}}");
  });

  it("redacts a value that a page read echoes back", async () => {
    setPenDesktop(stubBrowser({ read: async () => ({ text: `Welcome ${PASSWORD}`, url: "https://x.test" }) }));
    const out = await browseRead({}, { sessionId: "s1" });
    expect(out).not.toContain(PASSWORD);
  });

  it("refuses a placeholder without a chat id and does not call the bridge", async () => {
    const act = vi.fn(async () => ({}));
    setPenDesktop(stubBrowser({ act }));
    const out = await browseAct({ action: "type", index: 1, text: "{{secret:pw}}", snapshotId: "snap" });
    expect(act).not.toHaveBeenCalled();
    expect(out).toContain("error");
  });

  it("reads another chat's secrets as unknown", async () => {
    const act = vi.fn(async () => ({}));
    setPenDesktop(stubBrowser({ act }));
    const out = await browseAct({ action: "type", index: 1, text: "{{secret:pw}}", snapshotId: "snap" }, { sessionId: "other" });
    expect(act).not.toHaveBeenCalled();
    expect(out).not.toContain(PASSWORD);
  });

  it("withSecrets reads the store per call (the sub-agent passes the parent chat id)", () => {
    const opts = withSecrets({}, "s1");
    expect(opts.secrets?.()).toEqual({ pw: PASSWORD });
    useBrowseSecretStore.getState().set("s1", "user", "alice-login");
    expect(opts.secrets?.()).toEqual({ pw: PASSWORD, user: "alice-login" });
    expect(withSecrets({}, undefined).secrets).toBeUndefined();
  });

  it("the registry redacts browse results of a call with no chat id (MCP / WebMCP) and of a bridge that echoes", async () => {
    setPenDesktop(stubBrowser({ read: async () => ({ text: `Welcome ${PASSWORD}`, url: "https://x.test" }) }));
    const out = await toolHandlers.browse_read({});
    expect(out).not.toContain(PASSWORD);
    expect(out).toContain("{{secret:pw}}");
  });

  it("the registry also redacts a RETIRED value", async () => {
    useBrowseSecretStore.getState().remove("s1", "pw");
    setPenDesktop(stubBrowser({ read: async () => ({ text: `Old ${PASSWORD}`, url: "https://x.test" }) }));
    expect(await toolHandlers.browse_read({})).not.toContain(PASSWORD);
  });

  it("browse_capture redacts the HTML before it is placed on the canvas, and its error branch", async () => {
    resetStores();
    setPenDesktop(
      stubBrowser({
        capture: async () => ({ html: `<input value="${PASSWORD}">`, width: 100, height: 50, url: "https://x.test", title: "T" }),
      }),
    );
    const out = JSON.parse(await browseCapture({}, { sessionId: "s1" }));
    const node = useSceneStore.getState().nodesById[out.nodeId] as { htmlContent: string };
    expect(node.htmlContent).not.toContain(PASSWORD);
    expect(node.htmlContent).toContain("{{secret:pw}}");

    setPenDesktop(stubBrowser({ capture: async () => ({ error: `bad ${PASSWORD}` }) }));
    expect(await browseCapture({}, { sessionId: "s1" })).not.toContain(PASSWORD);
  });
});

describe("resolveSetupSecrets (browse_agent setup)", () => {
  const fixture = { version: 1, steps: [{ action: "type", selector: "#p", text: "{{secret:pw}}" }, { action: "click", selector: "#go" }] };

  it("puts the chat's value into type steps without touching the input", () => {
    const r = resolveSetupSecrets(fixture, "s1");
    expect(r.ok && (r.value.steps[0] as { text: string }).text).toBe(PASSWORD);
    expect(fixture.steps[0].text).toBe("{{secret:pw}}");
  });

  it("errors on an unknown name or no chat, and the error holds no value", () => {
    for (const chat of ["other", undefined]) {
      const r = resolveSetupSecrets(fixture, chat);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(PASSWORD);
    }
  });

  it("returns a fixture with no placeholder as it is", () => {
    const plain = { version: 1, steps: [{ action: "type", selector: "#p", text: "hi" }] };
    expect(resolveSetupSecrets(plain, "s1")).toEqual({ ok: true, value: plain });
  });
});

describe("browse_agent setup with a placeholder", () => {
  it("applies the fixture with the real value, and refuses an unknown name before applying", async () => {
    const { applyFixture, releaseFixture } = fixtureBridgeMocks("tok");
    const restore = stubBrowseOpenSnapshot();
    window.penDesktop = { onMenuCommand: () => () => {}, browser: { applyFixture, releaseFixture } } as never;
    vi.stubGlobal("fetch", vi.fn(async () => textTurn("done")));
    try {
      const setupWith = (name: string) => ({
        goal: "g",
        url: "https://shop.test",
        setup: { steps: [{ action: "type", selector: "#p", text: `{{secret:${name}}}` }] },
      });
      await browseAgent(setupWith("pw"), { sessionId: "s1", toolCallId: "tc-1" });
      expect(JSON.stringify(applyFixture.mock.calls)).toContain(PASSWORD);

      applyFixture.mockClear();
      const out = await browseAgent(setupWith("nope"), { sessionId: "s1", toolCallId: "tc-2" });
      expect(applyFixture).not.toHaveBeenCalled();
      expect(out).toContain("error");
      expect(out).not.toContain(PASSWORD);
    } finally {
      cleanupBrowseAgentTest(restore);
    }
  });
});
