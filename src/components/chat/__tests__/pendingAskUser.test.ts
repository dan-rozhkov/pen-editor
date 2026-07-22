import { it, expect } from "vitest";
import type { UIMessage } from "ai";
import { hasPendingAskUser } from "../pendingAskUser";

function assistant(parts: unknown[]): UIMessage {
  return { id: "m", role: "assistant", parts } as unknown as UIMessage;
}

it("is true when an ask_user part is unresolved", () => {
  expect(hasPendingAskUser([
    assistant([{ type: "tool-ask_user", toolCallId: "c", state: "input-available" }]),
  ])).toBe(true);
});

it("is false when the ask_user part has output", () => {
  expect(hasPendingAskUser([
    assistant([{ type: "tool-ask_user", toolCallId: "c", state: "output-available", output: "{}" }]),
  ])).toBe(false);
});

it("is false with no ask_user parts", () => {
  expect(hasPendingAskUser([
    assistant([{ type: "text", text: "hi" }, { type: "tool-get_variables", toolCallId: "g", state: "output-available" }]),
  ])).toBe(false);
  expect(hasPendingAskUser([])).toBe(false);
});
