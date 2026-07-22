import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { UIMessage } from "ai";
import { MessageList } from "../MessageList";

afterEach(() => cleanup());

function askUserMessage(): UIMessage {
  return {
    id: "m1",
    role: "assistant",
    parts: [
      {
        type: "tool-ask_user",
        toolCallId: "call-ask",
        state: "input-available",
        input: {
          questions: [
            { id: "audience", label: "Audience?", type: "single", required: true,
              options: [{ value: "devs", label: "Developers" }] },
          ],
        },
      },
    ],
  } as unknown as UIMessage;
}

it("renders AskUserForm for a tool-ask_user part and forwards the answer", () => {
  const addToolOutput = vi.fn();
  render(
    <MessageList messages={[askUserMessage()]} isLoading={false} addToolOutput={addToolOutput} />,
  );
  expect(screen.getByText("Audience?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Developers" }));
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  expect(addToolOutput).toHaveBeenCalledTimes(1);
  expect(addToolOutput.mock.calls[0][0]).toMatchObject({ tool: "ask_user", toolCallId: "call-ask" });
  const out = JSON.parse(addToolOutput.mock.calls[0][0].output);
  expect(out.answers[0]).toEqual({ id: "audience", value: "devs" });
});

function assistantWithPart(part: unknown): UIMessage {
  return { id: "m2", role: "assistant", parts: [part] } as unknown as UIMessage;
}

it("does not render the form while the tool input is still streaming", () => {
  render(
    <MessageList
      messages={[assistantWithPart({ type: "tool-ask_user", toolCallId: "c", state: "input-streaming", input: { title: "partial" } })]}
      isLoading={true}
    />,
  );
  // No form fields rendered from a partial input; no crash.
  expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
});

it("does not render an interactive form for an errored ask_user call", () => {
  render(
    <MessageList
      messages={[assistantWithPart({ type: "tool-ask_user", toolCallId: "c", state: "output-error",
        input: { questions: [{ id: "audience", label: "Audience?", type: "single", options: [{ value: "devs", label: "Developers" }] }] }, errorText: "bad" })]}
      isLoading={false}
    />,
  );
  expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
});
