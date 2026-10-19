import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { buildSuggestionMessages, fetchPromptSuggestion } from "../promptSuggestion";

const msg = (role: UIMessage["role"], ...parts: unknown[]): UIMessage =>
  ({ id: Math.random().toString(), role, parts }) as UIMessage;
const text = (t: string) => ({ type: "text", text: t });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("buildSuggestionMessages", () => {
  it("joins text parts and ignores tool and reasoning parts", () => {
    const out = buildSuggestionMessages([
      msg("user", text("make it blue")),
      msg("assistant", { type: "reasoning", text: "hmm" }, text("Done."), { type: "tool-batch_design" }, text("Anything else?")),
    ]);
    expect(out).toEqual([
      { role: "user", text: "make it blue" },
      { role: "assistant", text: "Done.\nAnything else?" },
    ]);
  });

  it("drops system messages and messages without text", () => {
    const out = buildSuggestionMessages([
      msg("system", text("sys")),
      msg("assistant", { type: "tool-batch_design" }),
      msg("user", text("   ")),
      msg("user", text("hi")),
    ]);
    expect(out).toEqual([{ role: "user", text: "hi" }]);
  });

  it("keeps the head of long user text and the tail of long assistant text", () => {
    const long = "a".repeat(2000) + "b".repeat(1000);
    const [u, a] = buildSuggestionMessages([msg("user", text(long)), msg("assistant", text(long))]);
    expect(u.text).toHaveLength(2000);
    expect(u.text).toBe("a".repeat(2000));
    expect(a.text).toBe("a".repeat(1000) + "b".repeat(1000));
  });

  it("keeps only the last 12 messages", () => {
    const all = Array.from({ length: 40 }, (_, i) => msg(i % 2 ? "assistant" : "user", text(`m${i}`)));
    const out = buildSuggestionMessages(all);
    expect(out).toHaveLength(12);
    expect(out[0].text).toBe("m28");
    expect(out[11].text).toBe("m39");
  });
});

describe("fetchPromptSuggestion", () => {
  const payload = [{ role: "user" as const, text: "hi" }];
  const stubFetch = (impl: () => Promise<unknown>) => {
    const fn = vi.fn(impl);
    vi.stubGlobal("fetch", fn);
    return fn;
  };
  const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body });

  it("posts the messages and returns the suggestion", async () => {
    const fn = stubFetch(() => json({ suggestion: "  now the footer " }));
    await expect(fetchPromptSuggestion(payload)).resolves.toBe("now the footer");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/prompt-suggestion");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ messages: payload });
  });

  it("returns null for a null suggestion", async () => {
    stubFetch(() => json({ suggestion: null }));
    await expect(fetchPromptSuggestion(payload)).resolves.toBeNull();
  });

  it("returns null on a non-OK response", async () => {
    stubFetch(() => json({ suggestion: "x" }, false));
    await expect(fetchPromptSuggestion(payload)).resolves.toBeNull();
  });

  it("returns null on a network error", async () => {
    stubFetch(() => Promise.reject(new TypeError("down")));
    await expect(fetchPromptSuggestion(payload)).resolves.toBeNull();
  });

  it("does not fetch when the kill switch is off", async () => {
    localStorage.setItem("pen.promptSuggestions", "off");
    const fn = stubFetch(() => json({ suggestion: "x" }));
    await expect(fetchPromptSuggestion(payload)).resolves.toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });
});
