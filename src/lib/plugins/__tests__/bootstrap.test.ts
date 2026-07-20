import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pluginBootstrap, buildSrcdoc } from "../bootstrap";
import type { PenPlugin } from "../types";

interface PenGlobal {
  tools: { run: (name: string, args: unknown) => Promise<unknown> };
  scene: { batch: (ops: string) => Promise<unknown>; get: (ids?: string[]) => Promise<unknown> };
  selection: { get: () => Promise<unknown>; set: (ids: string[]) => Promise<unknown> };
  viewport: { zoomTo: (ids: string[]) => Promise<unknown> };
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
    const req = posted[0];
    expect(req.kind).toBe("pen-rpc-request");
    expect(req.method).toBe("tools.run");
    expect(req.args).toEqual(["get_editor_state", {}]);
    deliver({ kind: "pen-rpc-response", callId: req.callId, ok: true, result: "STATE" });
    await expect(promise).resolves.toBe("STATE");
  });

  it("rejects on error response", async () => {
    const promise = getPen().scene.batch("bad");
    const req = posted[0];
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

  it("ignores malformed messages", () => {
    deliver(null);
    deliver({ kind: "something-else" });
    deliver({ kind: "pen-rpc-response", callId: 99999, ok: true }); // unknown callId
    // no throw = pass
  });

  it("ignores messages whose source is not window.parent", async () => {
    const promise = getPen().tools.run("get_editor_state", {});
    const req = posted[0];
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
});
