import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachSnapshot,
  BROWSER_BRIDGE_METHOD_MISSING_ERROR,
  BROWSER_NOT_AVAILABLE_ERROR,
  callBrowserBridge,
  safeParseObject,
} from "@/lib/tools/browser/shared";
import { getBrowserBridge, isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";
import { browseBackend } from "@/lib/tools/browser/backend";
import { cloudBrowserBridge, getCloudBrowserBridge } from "@/lib/cloudBrowser";
import { setCredentialsEnabled } from "@/lib/apiBase";
import { installBridge, j, makeBridge, resetEnvironment, snap, stubLocate, throws } from "./harness";

afterEach(() => {
  resetEnvironment();
  setCredentialsEnabled(false);
});

describe("constants", () => {
  it("pins the two documented error strings", () => {
    expect(BROWSER_NOT_AVAILABLE_ERROR).toBe("The built-in browser is only available in the Sideform Desktop app.");
    expect(BROWSER_BRIDGE_METHOD_MISSING_ERROR).toBe(
      "This browser command needs a newer version of the Sideform Desktop app."
    );
  });
});

describe("callBrowserBridge", () => {
  it("returns the not-available error for a missing call, or a custom message when given", async () => {
    expect(await callBrowserBridge(undefined, {})).toBe(j({ error: BROWSER_NOT_AVAILABLE_ERROR }));
    expect(await callBrowserBridge(undefined, {}, "custom")).toBe(j({ error: "custom" }));
  });

  it("passes the args object itself to the call and stringifies the result", async () => {
    const args = { a: 1 };
    const call = vi.fn(async (_args: unknown) => ({ ok: true }));
    expect(await callBrowserBridge(call, args)).toBe('{"ok":true}');
    expect(call.mock.calls[0][0]).toBe(args);
  });

  it("coalesces null/undefined to {} but keeps falsy primitives", async () => {
    expect(await callBrowserBridge(async () => undefined, {})).toBe("{}");
    expect(await callBrowserBridge(async () => null, {})).toBe("{}");
    expect(await callBrowserBridge(async () => 0, {})).toBe("0");
    expect(await callBrowserBridge(async () => "", {})).toBe('""');
    expect(await callBrowserBridge(async () => false, {})).toBe("false");
  });

  it("turns Error rejections into their message and anything else into the generic message", async () => {
    expect(await callBrowserBridge(async () => { throw new Error("m"); }, {})).toBe(j({ error: "m" }));
    expect(await callBrowserBridge(async () => { throw "s"; }, {})).toBe(j({ error: "Built-in browser command failed." }));
    expect(await callBrowserBridge(() => { throw new Error("sync"); }, {})).toBe(j({ error: "sync" }));
  });

  it("the custom unavailable message is not used for a rejecting call", async () => {
    expect(await callBrowserBridge(async () => { throw 1; }, {}, "custom")).toBe(
      j({ error: "Built-in browser command failed." })
    );
  });
});

describe("safeParseObject", () => {
  const malformed = { error: "browse_act: malformed result from the browser bridge." };
  it("parses a JSON object, preserving key order", () => {
    expect(Object.keys(safeParseObject('{"b":1,"a":2}'))).toEqual(["b", "a"]);
  });
  it("returns the malformed error for arrays, primitives, null and invalid JSON", () => {
    for (const bad of ["[1]", "5", '"s"', "null", "true", "not json", ""]) {
      expect(safeParseObject(bad)).toEqual(malformed);
    }
  });
});

describe("attachSnapshot", () => {
  it("appends the whole snapshot as `snapshot` on a copy", async () => {
    const bridge = makeBridge({ snapshot: [snap("a")] });
    const input = { x: 1 };
    const out = await attachSnapshot(bridge.browser, input);
    expect(out).toEqual({ x: 1, snapshot: snap("a") });
    expect(out).not.toBe(input);
    expect(input).toEqual({ x: 1 });
  });
  it("returns the very same object when the snapshot fails", async () => {
    const input = { x: 1 };
    for (const step of [{ error: "e" }, { url: "u" }, throws(new Error("b"))]) {
      expect(await attachSnapshot(makeBridge({ snapshot: [step] }).browser, input)).toBe(input);
    }
  });
});

describe("getBrowserBridge / isDesktopBrowserAvailable", () => {
  it("prefers the desktop browser regardless of chatId", () => {
    const b = installBridge(makeBridge());
    expect(getBrowserBridge()).toBe(b.browser);
    expect(getBrowserBridge("chat-1")).toBe(b.browser);
    expect(isDesktopBrowserAvailable()).toBe(true);
  });
  it("uses the shared cloud bridge without a chatId and a per-chat bridge with one", () => {
    expect(isDesktopBrowserAvailable()).toBe(false);
    expect(getBrowserBridge()).toBe(cloudBrowserBridge);
    expect(getBrowserBridge("chat-a")).toBe(getCloudBrowserBridge("chat-a"));
  });
  it("a shell without .browser is not a desktop browser", () => {
    window.penDesktop = { onMenuCommand: () => () => {} };
    expect(isDesktopBrowserAvailable()).toBe(false);
    expect(getBrowserBridge()).toBe(cloudBrowserBridge);
  });
});

describe("browseBackend transport", () => {
  it("POSTs JSON to the resolved path with a timeout signal and no credentials by default", async () => {
    const { fetchMock, requests } = stubLocate([{ body: { outcome: "found", index: 1 } }]);
    const res = await browseBackend.request("/api/browse/locate", { a: 1 }, { timeoutMs: 1000 });
    expect(res).toEqual({ status: 200, ok: true, body: { outcome: "found", index: 1 } });
    expect(requests[0].url).toMatch(/\/api\/browse\/locate$/);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].rawBody).toBe('{"a":1}');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.credentials).toBeUndefined();
  });
  it("sends the session cookie once accounts are on", async () => {
    setCredentialsEnabled(true);
    const { fetchMock } = stubLocate([{ body: {} }]);
    await browseBackend.request("/api/browse/step", {}, { timeoutMs: 1000 });
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe("include");
  });
  it("reports a Retry-After and a non-JSON body as null", async () => {
    stubLocate([{ status: 503, retryAfter: "7", badJson: true }]);
    expect(await browseBackend.request("/api/browse/locate", {}, { timeoutMs: 1000 })).toEqual({
      status: 503,
      ok: false,
      body: null,
      retryAfterSec: 7,
    });
  });
});
