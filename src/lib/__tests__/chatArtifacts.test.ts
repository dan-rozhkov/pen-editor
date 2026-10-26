import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { collectChatArtifacts, openChatArtifact } from "../chatArtifacts";

function tool(name: string, opts: { id?: string; state?: string; input?: unknown; output?: unknown }) {
  return {
    type: `tool-${name}`,
    toolCallId: opts.id ?? `${name}-${Math.random()}`,
    state: opts.state ?? "output-available",
    input: opts.input ?? {},
    output: opts.output,
  };
}
const msg = (...parts: unknown[]) => ({ id: "m", role: "assistant", parts }) as unknown as UIMessage;

describe("collectChatArtifacts", () => {
  it("collects docs from object and string outputs, skipping errors", () => {
    const out = collectChatArtifacts([
      msg(
        tool("doc_create", { output: { docId: "a", title: "Alpha" } }),
        tool("doc_read", { output: JSON.stringify({ docId: "b", title: "Beta" }) }),
        tool("doc_create", { input: { docId: "c" }, output: { error: "nope" } }),
        tool("doc_open", { input: { docId: "d" }, output: "not json" }),
        tool("doc_read", { state: "input-available", input: { docId: "e" } }),
      ),
    ]);
    expect(out.map((a) => [a.id, a.title])).toEqual([
      ["d", "Untitled document"],
      ["b", "Beta"],
      ["a", "Alpha"],
    ]);
  });

  it("counts the input docId of a failed doc_open/read/edit/insert_image but not a failed doc_create", () => {
    const out = collectChatArtifacts([
      msg(
        tool("doc_open", { input: { docId: "o" }, output: { error: "x", title: "Ignored" } }),
        tool("doc_read", { input: { docId: "r" }, output: { error: "x" } }),
        tool("doc_edit", { input: { docId: "e" }, output: { error: "x" } }),
        tool("doc_insert_image", { input: { docId: "i" }, output: { error: "x" } }),
        tool("doc_create", { input: { docId: "n" }, output: { error: "x" } }),
      ),
    ]);
    expect(out.map((a) => [a.id, a.title]).sort()).toEqual([
      ["e", "Untitled document"],
      ["i", "Untitled document"],
      ["o", "Untitled document"],
      ["r", "Untitled document"],
    ]);
  });

  it("marks a doc missing only when a docTitle resolver finds nothing", () => {
    const messages = [msg(tool("doc_create", { output: { docId: "a", title: "A" } }))];
    expect(collectChatArtifacts(messages)[0].missing).toBeUndefined();
    expect(collectChatArtifacts(messages, { docTitle: () => undefined })[0]).toMatchObject({ title: "A", missing: true });
    expect(collectChatArtifacts(messages, { docTitle: () => "Live" })[0].missing).toBeUndefined();
  });

  it("dedupes, orders most recent first and prefers live doc titles", () => {
    const out = collectChatArtifacts(
      [
        msg(tool("doc_create", { output: { docId: "a", title: "Old" } })),
        msg(tool("doc_create", { output: { docId: "b", title: "B" } }), tool("doc_edit", { output: { docId: "a" } })),
      ],
      { docTitle: (id) => (id === "a" ? "Live A" : undefined) },
    );
    expect(out.map((a) => [a.id, a.title])).toEqual([
      ["a", "Live A"],
      ["b", "B"],
    ]);
  });

  it("keeps a real title over a later fallback and upgrades a fallback", () => {
    const out = collectChatArtifacts([
      msg(tool("doc_create", { output: { docId: "a", title: "Real" } })),
      msg(tool("doc_read", { input: { docId: "a" }, output: {} })),
    ]);
    expect(out[0].title).toBe("Real");
  });

  it("collects canvases from open_canvas_tab and tabForCall", () => {
    const tabForCall = vi.fn((id: string) => (id === "c1" ? 7 : id === "c2" ? null : id === "c4" ? 9 : undefined));
    const out = collectChatArtifacts(
      [
        msg(
          tool("open_canvas_tab", { output: { tabId: 3, title: "Landing" } }),
          tool("batch_design", { id: "c1", state: "input-available" }),
          tool("batch_design", { id: "c2" }),
          tool("batch_design", { id: "c4", output: { title: "Ignored" } }),
          tool("batch_design", { id: "c3" }),
          tool("doc_read", { id: "c1", output: { docId: "z" } }),
        ),
      ],
      { tabForCall },
    );
    const canvases = out.filter((a) => a.kind === "canvas");
    expect(canvases.map((a) => [a.id, a.tabId, a.title])).toEqual([
      ["9", 9, "Canvas"],
      ["7", 7, "Canvas"],
      ["3", 3, "Landing"],
    ]);
  });

  it("collects traces with goal titles and sources", () => {
    const out = collectChatArtifacts([
      msg(
        tool("browse_agent", {
          input: { goal: "  Check\n  the cart " },
          output: JSON.stringify({ trace: { id: "t1", source: "cloud" } }),
        }),
        tool("browse_agent", { output: { trace: { id: "bad", source: "x" } } }),
        tool("trace_read", { input: { traceId: "t1" }, output: {} }),
        tool("trace_frame", { input: { traceId: "t2" }, output: { goal: "Other" } }),
      ),
    ]);
    expect(out).toEqual([
      { kind: "trace", id: "t2", source: "local", title: "Other" },
      { kind: "trace", id: "t1", source: "cloud", title: "Check the cart" },
    ]);
  });

  it("never throws on junk", () => {
    expect(
      collectChatArtifacts([{ id: "x", role: "assistant" } as unknown as UIMessage, msg(null, 5, { type: "tool-doc_read" })]),
    ).toEqual([]);
  });
});

describe("openChatArtifact", () => {
  it("routes by kind and swallows errors", () => {
    const docsBridge = { open: vi.fn(async () => ({ ok: true })) };
    const canvasBridge = { activateTab: vi.fn() };
    const run = vi.fn();
    const openTrace = vi.fn(() => run);
    const ctx = { docsBridge, canvasBridge, openTrace };
    openChatArtifact({ kind: "doc", id: "a", title: "A" }, ctx);
    openChatArtifact({ kind: "canvas", id: "4", tabId: 4, title: "C" }, ctx);
    openChatArtifact({ kind: "trace", id: "t", source: "local", title: "T" }, ctx);
    expect(docsBridge.open).toHaveBeenCalledWith("a");
    expect(canvasBridge.activateTab).toHaveBeenCalledWith(4);
    expect(openTrace).toHaveBeenCalledWith({ id: "t", source: "local" });
    expect(run).toHaveBeenCalled();
    expect(() =>
      openChatArtifact({ kind: "canvas", id: "4", tabId: 4, title: "C" }, {
        canvasBridge: { activateTab: () => { throw new Error("x"); } },
      }),
    ).not.toThrow();
  });

  it("falls back to opening the doc route in a new window", () => {
    const openWindow = vi.fn();
    openChatArtifact({ kind: "doc", id: "a b", title: "A" }, { openWindow });
    expect(openWindow).toHaveBeenCalledWith(expect.stringContaining("doc?id=a%20b"));
  });
});
