import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { UIMessage } from "ai";
import { MessageList } from "../MessageList";

afterEach(() => cleanup());

function assistantWithPart(part: unknown): UIMessage {
  return { id: "m1", role: "assistant", parts: [part] } as unknown as UIMessage;
}

it("renders a collapsed 'Memory updated' row whose details say what was remembered", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart({
          type: "tool-memory",
          toolCallId: "call-mem",
          state: "output-available",
          input: {
            target: "user",
            operations: [
              { action: "add", content: "prefers dark UIs" },
              { action: "replace", old_text: "likes serif", content: "likes sans" },
              { action: "remove", old_text: "uses Figma" },
            ],
          },
          output: JSON.stringify({ ok: true }),
        }),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.getByText("Memory updated")).toBeTruthy();
  expect(screen.queryByText("Done")).toBeNull();
  expect(screen.queryByText("Remembered about you: prefers dark UIs")).toBeNull();
  const toggle = screen.getByRole("button", { name: /Memory updated/ });
  fireEvent.click(toggle);
  expect(screen.getByText("Remembered about you: prefers dark UIs")).toBeTruthy();
  expect(screen.getByText("Updated about you: likes serif → likes sans")).toBeTruthy();
  expect(screen.getByText("Forgot about you: uses Figma")).toBeTruthy();
  fireEvent.click(toggle);
  expect(screen.queryByText("Forgot about you: uses Figma")).toBeNull();
});

it("shows the bare label with no chevron when the input carries no operations", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart({
          type: "tool-memory",
          toolCallId: "call-mem-bare",
          state: "output-available",
          input: { action: "write" },
          output: JSON.stringify({ ok: true }),
        }),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.getByText("Memory updated")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Memory updated/ })).toBeNull();
});

it("falls back to the generic ToolCallIndicator when the output is ok:false (e.g. over_capacity)", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart({
          type: "tool-memory",
          toolCallId: "call-mem-fail",
          state: "output-available",
          input: { action: "write" },
          output: JSON.stringify({ ok: false, error: "Memory is full." }),
        }),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.queryByText("Memory updated")).toBeNull();
  expect(screen.getByText("Memory")).toBeTruthy();
});

it("treats an unparseable or unexpected output shape as non-success rather than throwing", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart({
          type: "tool-memory",
          toolCallId: "call-mem-weird",
          state: "output-available",
          input: { action: "write" },
          output: "not json",
        }),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.queryByText("Memory updated")).toBeNull();
  expect(screen.getByText("Memory")).toBeTruthy();
});

it("falls back to the generic ToolCallIndicator when the memory call errored", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart({
          type: "tool-memory",
          toolCallId: "call-mem-err",
          state: "output-error",
          input: { action: "write" },
          errorText: "boom",
        }),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.queryByText("Memory updated")).toBeNull();
  expect(screen.getByText("Memory")).toBeTruthy();
  expect(screen.getByText("Error")).toBeTruthy();
});

it("falls back to the generic ToolCallIndicator while the memory call is still running", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart({
          type: "tool-memory",
          toolCallId: "call-mem-run",
          state: "input-streaming",
          input: { action: "write" },
        }),
      ]}
      isLoading={true}
    />,
  );
  expect(screen.queryByText("Memory updated")).toBeNull();
  expect(screen.getByText("Memory")).toBeTruthy();
});
