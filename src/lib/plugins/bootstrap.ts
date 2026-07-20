import type { PenPlugin } from "./types";

/**
 * Runs INSIDE the sandbox iframe. Serialized with .toString() into srcdoc —
 * therefore it must be fully self-contained: no imports, no outer-scope
 * references, no TS-only constructs that don't erase cleanly.
 */
export function pluginBootstrap(): void {
  const RPC_TIMEOUT_MS = 30_000;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const listeners: Record<string, Array<(payload: unknown) => void>> = {};
  let nextCallId = 1;

  function call(method: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const callId = nextCallId++;
      const timer = setTimeout(() => {
        pending.delete(callId);
        reject(new Error("pen RPC timeout: " + method));
      }, RPC_TIMEOUT_MS);
      pending.set(callId, { resolve, reject, timer });
      window.parent.postMessage({ kind: "pen-rpc-request", callId, method, args }, "*");
    });
  }

  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { kind?: string; callId?: number; ok?: boolean; result?: unknown; error?: unknown; event?: string; payload?: unknown } | null;
    if (!data || typeof data !== "object") return;
    if (data.kind === "pen-rpc-response" && typeof data.callId === "number") {
      const entry = pending.get(data.callId);
      if (!entry) return;
      pending.delete(data.callId);
      clearTimeout(entry.timer);
      if (data.ok) entry.resolve(data.result);
      else entry.reject(new Error(String(data.error)));
    } else if (data.kind === "pen-host-event" && typeof data.event === "string") {
      for (const cb of listeners[data.event] ?? []) cb(data.payload);
    }
  });

  (window as unknown as Record<string, unknown>).pen = {
    tools: { run: (name: string, args: unknown) => call("tools.run", name, args) },
    scene: {
      batch: (operations: string) => call("scene.batch", operations),
      get: (ids?: string[]) => call("scene.get", ids ?? null),
    },
    selection: {
      get: () => call("selection.get"),
      set: (ids: string[]) => call("selection.set", ids),
    },
    viewport: { zoomTo: (ids: string[]) => call("viewport.zoomTo", ids) },
    notify: (message: string) => { void call("notify", message); },
    storage: {
      get: (key: string) => call("storage.get", key),
      set: (key: string, value: unknown) => call("storage.set", key, value),
    },
    on: (event: string, cb: (payload: unknown) => void) => {
      (listeners[event] ??= []).push(cb);
    },
    close: () => { void call("close"); },
  };
}

/** Full srcdoc HTML for a plugin's sandbox iframe. */
export function buildSrcdoc(plugin: PenPlugin): string {
  // A literal "</script>" inside plugin code would terminate our script tag.
  const safeCode = plugin.code.replace(/<\/script/gi, "<\\/script");
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>",
    `<script>(${pluginBootstrap.toString()})();</script>`,
    `<script type="module">${safeCode}</script>`,
    "</body></html>",
  ].join("\n");
}
