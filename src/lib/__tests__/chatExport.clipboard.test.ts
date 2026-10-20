import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { messageToClipboardText } from "@/lib/chatExport";

function msg(role: UIMessage["role"], parts: unknown[]): UIMessage {
  return { id: "m1", role, parts } as UIMessage;
}

describe("messageToClipboardText", () => {
  it("returns only the text, without a role heading", () => {
    const out = messageToClipboardText(
      msg("assistant", [{ type: "text", text: "Hello" }]),
    );
    expect(out).toBe("Hello");
    expect(out).not.toContain("## ");
  });

  it("excludes reasoning, files and tool parts", () => {
    const out = messageToClipboardText(
      msg("assistant", [
        { type: "reasoning", text: "secret thoughts" },
        {
          type: "tool-batch_design",
          toolCallId: "t1",
          state: "output-available",
          input: { operations: "x" },
          output: "done",
        },
        { type: "file", mediaType: "image/png", url: "https://x/y.png" },
        { type: "text", text: "Answer" },
      ]),
    );
    expect(out).toBe("Answer");
  });

  it.each([
    ["assistant", "one\n\ntwo"],
    ["user", "onetwo"],
  ] as const)("joins a %s message's text parts as it renders them", (role, expected) => {
    const out = messageToClipboardText(
      msg(role, [
        { type: "text", text: "one" },
        { type: "text", text: "" },
        { type: "text", text: "two" },
      ]),
    );
    expect(out).toBe(expected);
  });

  it("returns an empty string when there is no text", () => {
    expect(messageToClipboardText(msg("assistant", []))).toBe("");
  });
});
