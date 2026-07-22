import { it, expect } from "vitest";
import type { UIMessage } from "ai";
import { hasPendingAskUser } from "../pendingAskUser";

function assistant(parts: unknown[]): UIMessage {
  return { id: "m", role: "assistant", parts } as unknown as UIMessage;
}

it("is true when an ask_user part is unresolved", () => {
  expect(hasPendingAskUser([
    assistant([{ type: "tool-ask_user", toolCallId: "c", state: "input-available",
      input: { questions: [{ id: "q", label: "L", type: "text" }] } }]),
  ])).toBe(true);
});

it("is false when the ask_user part has output", () => {
  expect(hasPendingAskUser([
    assistant([{ type: "tool-ask_user", toolCallId: "c", state: "output-available",
      input: { questions: [{ id: "q", label: "L", type: "text" }] }, output: "{}" }]),
  ])).toBe(false);
});

it("is false with no ask_user parts", () => {
  expect(hasPendingAskUser([
    assistant([{ type: "text", text: "hi" }, { type: "tool-get_variables", toolCallId: "g", state: "output-available" }]),
  ])).toBe(false);
  expect(hasPendingAskUser([])).toBe(false);
});

it("is false when an ask_user part is still streaming with no input yet", () => {
  expect(hasPendingAskUser([
    assistant([{ type: "tool-ask_user", toolCallId: "c", state: "input-streaming" }]),
  ])).toBe(false);
});

it("is true once a streaming ask_user part has input", () => {
  expect(hasPendingAskUser([
    assistant([{ type: "tool-ask_user", toolCallId: "c", state: "input-available",
      input: { questions: [{ id: "q", label: "L", type: "text" }] } }]),
  ])).toBe(true);
});
