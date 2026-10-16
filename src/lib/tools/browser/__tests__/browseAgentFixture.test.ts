import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolHandlers, type ToolHandler } from "@/lib/toolRegistry";
import { useBrowseAgentPhaseStore } from "@/store/browseAgentPhaseStore";
import { textTurn } from "./helpers";
import { browseAgent } from "../browseAgent";

function stubFetch() {
  const bodies: Array<{ messages: Array<{ parts: Array<{ text?: string }> }> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return textTurn("All good");
    }),
  );
  return bodies;
}

const ctx = { sessionId: "chat-1", toolCallId: "tc-1" };
const SETUP = { steps: [{ action: "click", selector: "#go" }], expect: { text: "3 items" } };

let applyFixture: ReturnType<typeof vi.fn>;
let releaseFixture: ReturnType<typeof vi.fn>;
let savedHandlers: Record<string, ToolHandler | undefined>;
const stubbed = ["browse_open", "browse_snapshot"];

function installBridge(extra: Record<string, unknown> = {}) {
  window.penDesktop = {
    onMenuCommand: () => () => {},
    browser: { applyFixture, releaseFixture, ...extra },
  } as never;
}

beforeEach(() => {
  applyFixture = vi.fn(async () => ({ ok: true, summary: "1 step run", fixtureToken: "tok-1" }));
  releaseFixture = vi.fn(async () => ({ ok: true }));
  savedHandlers = Object.fromEntries(stubbed.map((n) => [n, toolHandlers[n]]));
  toolHandlers.browse_open = vi.fn(async () => "{}");
  toolHandlers.browse_snapshot = vi.fn(async () => '{"snapshot":"SNAP"}');
  installBridge();
});

afterEach(() => {
  for (const n of stubbed) {
    if (savedHandlers[n]) toolHandlers[n] = savedHandlers[n];
    else delete toolHandlers[n];
  }
  delete window.penDesktop;
  vi.unstubAllGlobals();
  useBrowseAgentPhaseStore.setState({ phases: {} });
});

describe("browse_agent setup (page fixture)", () => {
  it("applies the fixture instead of opening the url, then releases with the token", async () => {
    const bodies = stubFetch();
    const raw = await browseAgent({ goal: "Check cart", url: "https://shop.test/cart", setup: SETUP }, ctx);

    expect(JSON.parse(raw)).toMatchObject({ status: "done", setupApplied: true });
    expect(applyFixture).toHaveBeenCalledTimes(1);
    const [fixture, opts] = applyFixture.mock.calls[0];
    expect(fixture).toMatchObject({ version: 1, url: "https://shop.test/cart", ...SETUP });
    expect(opts).toMatchObject({ allowNetworkMocks: true });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    // No pre-open: the fixture carries the start URL.
    expect(toolHandlers.browse_open).not.toHaveBeenCalled();
    expect(toolHandlers.browse_snapshot).toHaveBeenCalledTimes(1);
    const first = bodies[0].messages[0].parts[0].text ?? "";
    expect(first).toContain("1 step run");
    expect(first).toContain("SNAP");
    expect(releaseFixture).toHaveBeenCalledWith("tok-1");
    expect(useBrowseAgentPhaseStore.getState().phases).toEqual({});
  });

  it("reports setup_failed with the stage when the apply fails; the model never runs", async () => {
    applyFixture.mockResolvedValue({ ok: false, stage: "expect", error: 'text "3 items" not found' });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test", setup: SETUP }, ctx));
    expect(result).toMatchObject({ status: "setup_failed", setupStage: "expect", error: 'text "3 items" not found' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(releaseFixture).not.toHaveBeenCalled();
  });

  it("releases the mocks even when the run fails after the apply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const setup = { network: [{ url: "https://api.test/*", status: 500 }] };
    await browseAgent({ goal: "g", url: "https://a.test", setup }, ctx);
    expect(releaseFixture).toHaveBeenCalledWith("tok-1");
  });

  it("setup_failed when the bridge cannot apply fixtures", async () => {
    window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
    const result = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test", setup: SETUP }, ctx));
    expect(result.status).toBe("setup_failed");
    expect(result.setupStage).toBeUndefined();
    expect(result.error).toContain("does not support page fixtures");
  });

  it("refuses network mocks when the bridge cannot release them", async () => {
    window.penDesktop = { onMenuCommand: () => () => {}, browser: { applyFixture } } as never;
    const setup = { network: [{ url: "https://api.test/*" }] };
    const result = JSON.parse(await browseAgent({ goal: "g", url: "https://a.test", setup }, ctx));
    expect(result).toMatchObject({ status: "setup_failed", setupStage: "network" });
    expect(applyFixture).not.toHaveBeenCalled();
  });

  it("invalid setup fails at stage validate without touching the browser", async () => {
    const result = JSON.parse(
      await browseAgent({ goal: "g", url: "https://a.test", setup: { steps: [{ action: "nope" }] } }, ctx),
    );
    expect(result).toMatchObject({ status: "setup_failed", setupStage: "validate" });
    expect(applyFixture).not.toHaveBeenCalled();
  });

  it("without setup it still pre-opens the url", async () => {
    stubFetch();
    await browseAgent({ goal: "g", url: "https://a.test" }, ctx);
    expect(toolHandlers.browse_open).toHaveBeenCalledTimes(1);
    expect(applyFixture).not.toHaveBeenCalled();
  });

  it("sets the phase to setup before the apply and running after it", async () => {
    stubFetch();
    const seen: Array<string | undefined> = [];
    applyFixture.mockImplementation(async () => {
      seen.push(useBrowseAgentPhaseStore.getState().phases["tc-1"]);
      return { ok: true, summary: "ok" };
    });
    toolHandlers.browse_snapshot = vi.fn(async () => {
      seen.push(useBrowseAgentPhaseStore.getState().phases["tc-1"]);
      return "{}";
    });
    await browseAgent({ goal: "g", url: "https://a.test", setup: SETUP }, ctx);
    expect(seen).toEqual(["setup", "running"]);
    expect(useBrowseAgentPhaseStore.getState().phases["tc-1"]).toBeUndefined();
  });

  it("abort while the apply is in flight: aborted, then the late token is released", async () => {
    stubFetch();
    let resolveApply: (v: unknown) => void = () => {};
    applyFixture.mockImplementation(() => new Promise((r) => { resolveApply = r; }));
    const ac = new AbortController();
    const pending = browseAgent(
      { goal: "g", url: "https://a.test", setup: { network: [{ url: "https://api.test/*" }] } },
      { ...ctx, signal: ac.signal },
    );
    await vi.waitFor(() => expect(applyFixture).toHaveBeenCalled());
    ac.abort();
    expect(JSON.parse(await pending).status).toBe("aborted");
    expect(releaseFixture).not.toHaveBeenCalled();
    resolveApply({ ok: true, summary: "late", fixtureToken: "late-tok" });
    await vi.waitFor(() => expect(releaseFixture).toHaveBeenCalledWith("late-tok"));
    expect(useBrowseAgentPhaseStore.getState().phases).toEqual({});
  });

  it("cloud bridge: forwards both commands", async () => {
    delete window.penDesktop;
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/api/chat")) return textTurn("fine");
        urls.push(url.slice(url.indexOf("/api/browser")));
        const cmd = JSON.parse(String(init?.body)).args;
        const result =
          url.includes("applyFixture")
            ? { ok: true, summary: "2 mocks", fixtureToken: "ct", received: cmd.fixture.network.length }
            : { ok: true };
        return new Response(JSON.stringify({ result, handle: "h" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const setup = { network: [{ url: "https://api.test/a" }, { url: "https://api.test/b" }] };
    await browseAgent({ goal: "g", url: "https://a.test", setup }, { sessionId: "chat-cloud", toolCallId: "tc-c" });
    expect(urls.filter((u) => u.includes("Fixture"))).toEqual([
      "/api/browser/cmd/applyFixture",
      "/api/browser/cmd/releaseFixture",
    ]);
  });

  it("aborted before the apply landed: no setupApplied", async () => {
    stubFetch();
    applyFixture.mockImplementation(() => new Promise(() => {}));
    const ac = new AbortController();
    const pending = browseAgent({ goal: "g", url: "https://a.test", setup: SETUP }, { ...ctx, signal: ac.signal });
    await vi.waitFor(() => expect(applyFixture).toHaveBeenCalled());
    ac.abort();
    const result = JSON.parse(await pending);
    expect(result.status).toBe("aborted");
    expect(result.setupApplied).toBeUndefined();
  });

  it("a model-supplied setup.version or setup.url never overrides version 1 or the tool url", async () => {
    stubFetch();
    await browseAgent(
      { goal: "g", url: "https://real.test", setup: { ...SETUP, version: 2, url: "https://evil.test" } },
      ctx,
    );
    expect(applyFixture.mock.calls[0][0]).toMatchObject({ version: 1, url: "https://real.test" });
  });
});
