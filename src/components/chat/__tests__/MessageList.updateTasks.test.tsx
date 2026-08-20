import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { UIMessage } from "ai";
import { MessageList } from "../MessageList";

afterEach(() => cleanup());

function assistantWithPart(id: string, part: unknown): UIMessage {
  return { id, role: "assistant", parts: [part] } as unknown as UIMessage;
}

function updateTasksPart(overrides: Record<string, unknown>) {
  return {
    type: "tool-update_tasks",
    toolCallId: "call-update-tasks",
    state: "output-available",
    input: { tasks: [{ title: "Do a thing", status: "pending" }] },
    output: "ok",
    ...overrides,
  };
}

// Defect fix: a successful/pending update_tasks part is already visible as
// the AgentTaskPanel, so it renders nothing in the transcript — but it must
// not count as "content" either, or a message whose only part (so far) is
// this tool call looks like an empty bubble instead of a streaming one.
it("renders nothing for a successful update_tasks call and still shows the streaming indicator while it is the only part of the last message", () => {
  render(
    <MessageList
      messages={[assistantWithPart("a1", updateTasksPart({ state: "output-available" }))]}
      isLoading={true}
    />,
  );
  expect(screen.queryByText("Update tasks")).toBeNull();
  // StreamingIndicator renders three bouncing dots with no accessible text,
  // so assert on its distinctive class instead.
  expect(document.querySelectorAll(".animate-bounce")).toHaveLength(3);
});

it("renders nothing for an update_tasks call still running (input-available)", () => {
  render(
    <MessageList
      messages={[assistantWithPart("a1", updateTasksPart({ state: "input-available" }))]}
      isLoading={true}
    />,
  );
  expect(screen.queryByText("Update tasks")).toBeNull();
});

// Defect fix: an errored update_tasks call has nothing to show in the
// AgentTaskPanel (the panel only reflects the last successful task list), so
// it must fall through to the generic ToolCallIndicator instead of vanishing
// — otherwise the failure is invisible to the user.
it("falls back to the generic ToolCallIndicator when update_tasks errors", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart(
          "a1",
          updateTasksPart({ state: "output-error", errorText: "boom", output: undefined }),
        ),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.getByText("Update tasks")).toBeTruthy();
  expect(screen.getByText("Error")).toBeTruthy();
});

// The errored call itself counts as real content, so it must not trigger the
// empty-bubble streaming indicator alongside the visible error row.
it("does not show the streaming indicator when the only part is an errored update_tasks call on the last message", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart(
          "a1",
          updateTasksPart({ state: "output-error", errorText: "boom", output: undefined }),
        ),
      ]}
      isLoading={true}
    />,
  );
  expect(screen.getByText("Update tasks")).toBeTruthy();
  expect(document.querySelectorAll(".animate-bounce")).toHaveLength(0);
});
