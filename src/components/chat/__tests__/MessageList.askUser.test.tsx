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
