import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { INTERRUPTED_TOOL_ERROR, sanitizeStoredMessages } from "../sanitizeStoredMessages";

const msg = (parts: unknown[], role: UIMessage["role"] = "assistant", id = "m"): UIMessage => ({ id, role, parts: parts as UIMessage["parts"] });

describe("sanitizeStoredMessages", () => {
  it.each(["input-streaming", "input-available", "approval-requested"])("turns a %s tool part into output-error", (state) => {
    const [out] = sanitizeStoredMessages([msg([{ type: "tool-batch_design", toolCallId: "a", state, input: { x: 1 } }])]);
    expect(out.parts[0]).toMatchObject({ state: "output-error", input: { x: 1 }, errorText: INTERRUPTED_TOOL_ERROR });
  });

  it("handles dynamic tools and fills a missing input", () => {
    const [out] = sanitizeStoredMessages([msg([{ type: "dynamic-tool", toolName: "t", toolCallId: "a", state: "input-streaming" }])]);
    expect(out.parts[0]).toMatchObject({ state: "output-error", input: {} });
  });

  it("keeps terminal tool parts, text parts and message identity", () => {
    const done = msg([
      { type: "text", text: "hi" },
      { type: "tool-x", toolCallId: "a", state: "output-available", input: {}, output: "ok" },
      { type: "tool-y", toolCallId: "b", state: "output-error", input: {}, errorText: "e" },
      { type: "tool-z", toolCallId: "c", state: "output-denied", input: {} },
    ]);
    const [out] = sanitizeStoredMessages([done]);
    expect(out).toBe(done);
  });

  it("finishes streaming text and reasoning parts", () => {
    const [out] = sanitizeStoredMessages([
      msg([
        { type: "reasoning", text: "think", state: "streaming" },
        { type: "text", text: "hello", state: "streaming" },
      ]),
    ]);
    expect(out.parts[0]).toMatchObject({ type: "reasoning", state: "done" });
    expect(out.parts[1]).toMatchObject({ type: "text", text: "hello", state: "done" });
  });

  it("drops assistant messages with no parts or only empty text, keeps user messages", () => {
    const user = msg([{ type: "text", text: "" }], "user", "u");
    const out = sanitizeStoredMessages([
      user,
      msg([], "assistant", "a1"),
      msg([{ type: "text", text: "  ", state: "streaming" }], "assistant", "a2"),
      msg([{ type: "text", text: "ok" }], "assistant", "a3"),
    ]);
    expect(out.map((m) => m.id)).toEqual(["u", "a3"]);
    expect(out[0]).toBe(user);
  });
});
