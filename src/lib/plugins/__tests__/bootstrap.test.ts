import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pluginBootstrap, buildSrcdoc, buildThemePayload, buildThemeMessage, readThemeVars } from "../bootstrap";
import type { PenPlugin } from "../types";

interface PenGlobal {
  tools: { run: (name: string, args: unknown) => Promise<unknown> };
  scene: { batch: (ops: string) => Promise<unknown>; get: (ids?: string[]) => Promise<unknown> };
  selection: { get: () => Promise<unknown>; set: (ids: string[]) => Promise<unknown> };
  viewport: { zoomTo: (ids: string[]) => Promise<unknown> };
  ui: { resize: (width: number, height: number) => Promise<unknown> };
  notify: (msg: string) => void;
  storage: { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown) => Promise<unknown> };
  on: (event: string, cb: (payload: unknown) => void) => void;
  close: () => void;
}

function getPen(): PenGlobal {
  return (window as unknown as { pen: PenGlobal }).pen;
}

/** Deliver a host message to the bootstrap's listener as the iframe would receive it. */
function deliver(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data, source: window.parent }));
}

/** The first thing posted every test is the one-time `pen-plugin-ready`
 * handshake (`beforeEach` calls `pluginBootstrap()` before the test body
 * runs) — tests that assert on a specific RPC request look past it here
 * rather than indexing `posted[0]` directly. */
function lastPosted(posted: Array<Record<string, unknown>>): Record<string, unknown> {
  return posted[posted.length - 1];
}

describe("pluginBootstrap", () => {
  let posted: Array<Record<string, unknown>>;
  let postSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    posted = [];
    // In happy-dom window.parent === window; intercept outgoing RPC there.
    postSpy = vi.spyOn(window.parent, "postMessage").mockImplementation(((msg: unknown) => {
      posted.push(msg as Record<string, unknown>);
    }) as never);
    pluginBootstrap();
  });

  afterEach(() => {
    postSpy.mockRestore();
    delete (window as unknown as Record<string, unknown>).pen;
    document.documentElement.removeAttribute("data-theme");
    document.getElementById("pen-theme-vars")?.remove();
  });

  it("defines the pen global with the full v1 surface", () => {
    const pen = getPen();
    expect(typeof pen.tools.run).toBe("function");
    expect(typeof pen.scene.batch).toBe("function");
    expect(typeof pen.selection.get).toBe("function");
    expect(typeof pen.notify).toBe("function");
    expect(typeof pen.close).toBe("function");
  });

  it("posts an rpc request and resolves on ok response", async () => {
    const promise = getPen().tools.run("get_editor_state", {});
    const req = lastPosted(posted);
    expect(req.kind).toBe("pen-rpc-request");
    expect(req.method).toBe("tools.run");
    expect(req.args).toEqual(["get_editor_state", {}]);
    deliver({ kind: "pen-rpc-response", callId: req.callId, ok: true, result: "STATE" });
    await expect(promise).resolves.toBe("STATE");
  });

  it("rejects on error response", async () => {
    const promise = getPen().scene.batch("bad");
    const req = lastPosted(posted);
    deliver({ kind: "pen-rpc-response", callId: req.callId, ok: false, error: "boom" });
    await expect(promise).rejects.toThrow("boom");
  });

  it("times out after 30s without a response", async () => {
    vi.useFakeTimers();
    try {
      const promise = getPen().selection.get();
      const rejection = expect(promise).rejects.toThrow(/timeout/);
      vi.advanceTimersByTime(30_001);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatches host events to pen.on listeners", () => {
    const cb = vi.fn();
    getPen().on("selectionchange", cb);
    deliver({ kind: "pen-host-event", event: "selectionchange", payload: ["a"] });
    expect(cb).toHaveBeenCalledWith(["a"]);
  });

  it("posts a one-time pen-plugin-ready handshake right after wiring up its listener", () => {
    // pluginBootstrap() already ran in beforeEach and posted synchronously —
    // the handshake must be the very first thing posted, before any RPC call.
    expect(posted).toEqual([{ kind: "pen-plugin-ready" }]);
  });

  it("posts a ui.resize rpc request", () => {
    void getPen().ui.resize(500, 400);
    const req = lastPosted(posted);
    expect(req.kind).toBe("pen-rpc-request");
    expect(req.method).toBe("ui.resize");
    expect(req.args).toEqual([500, 400]);
  });

  it("applies a themechange event to its own document (data-theme + CSS vars), independent of pen.on", () => {
    deliver({
      kind: "pen-host-event",
      event: "themechange",
      payload: { theme: "dark", cssVars: { "--color-surface-panel": "#2a2a2a" } },
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    const style = document.getElementById("pen-theme-vars");
    expect(style?.textContent).toContain("--color-surface-panel:#2a2a2a;");
  });

  it("still dispatches themechange to any pen.on listener too", () => {
    const cb = vi.fn();
    getPen().on("themechange", cb);
    const payload = { theme: "light", cssVars: {} };
    deliver({ kind: "pen-host-event", event: "themechange", payload });
    expect(cb).toHaveBeenCalledWith(payload);
  });

  it("ignores malformed messages", () => {
    deliver(null);
    deliver({ kind: "something-else" });
    deliver({ kind: "pen-rpc-response", callId: 99999, ok: true }); // unknown callId
    // no throw = pass
  });

  it("ignores messages whose source is not window.parent", async () => {
    const promise = getPen().tools.run("get_editor_state", {});
    const req = lastPosted(posted);
    // Wrong source: plain MessageEvent with no `source` (defaults to null in happy-dom).
    window.dispatchEvent(new MessageEvent("message", { data: { kind: "pen-rpc-response", callId: req.callId, ok: true, result: "SPOOFED" } }));
    // Correctly-sourced response still resolves the same pending call.
    deliver({ kind: "pen-rpc-response", callId: req.callId, ok: true, result: "STATE" });
    await expect(promise).resolves.toBe("STATE");
  });
});

describe("buildSrcdoc", () => {
  const plugin: PenPlugin = {
    id: "p1", name: "T", description: "", code: 'pen.notify("hi"); // </script>',
    source: "ai", createdAt: 0, updatedAt: 0,
  };

  it("embeds bootstrap and plugin code, escaping </script>", () => {
    const html = buildSrcdoc(plugin);
    expect(html).toContain("pen-rpc-request");
    expect(html).toContain('<script type="module">');
    expect(html).not.toContain("// </script>");
    expect(html).toContain("<\\/script>");
  });

  it("defaults to a light theme with no vars when initialTheme is omitted", () => {
    const html = buildSrcdoc(plugin);
    expect(html).toContain('data-theme="light"');
  });

  it("bakes the given initial theme's data-theme and CSS vars into the srcdoc", () => {
    const html = buildSrcdoc(plugin, { theme: "dark", cssVars: { "--color-surface-panel": "#2a2a2a" } });
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("--color-surface-panel:#2a2a2a;");
  });
});

describe("theme helpers", () => {
  afterEach(() => {
    document.documentElement.style.cssText = "";
  });

  it("readThemeVars reads resolved CSS custom properties off <html>", () => {
    document.documentElement.style.setProperty("--color-surface-panel", "#123456");
    const vars = readThemeVars();
    expect(vars["--color-surface-panel"]).toBe("#123456");
  });

  it("readThemeVars omits vars that resolve empty", () => {
    const vars = readThemeVars();
    // Nothing set on <html> in this test (jsdom/happy-dom has no @theme block
    // loaded) — every listed var should come back empty and be dropped.
    expect(Object.keys(vars).length).toBe(0);
  });

  it("buildThemePayload/buildThemeMessage shape the theme + cssVars payload", () => {
    document.documentElement.style.setProperty("--color-text-primary", "black");
    const payload = buildThemePayload("dark");
    expect(payload.theme).toBe("dark");
    expect(payload.cssVars["--color-text-primary"]).toBe("black");

    const message = buildThemeMessage("light");
    expect(message).toEqual({
      kind: "pen-host-event",
      event: "themechange",
      payload: { theme: "light", cssVars: expect.any(Object) },
    });
  });
});
