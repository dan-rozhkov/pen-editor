import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { UIMessage } from "ai";
import { MessageList } from "../MessageList";

afterEach(() => cleanup());

function assistantWithPart(part: unknown): UIMessage {
  return { id: "m1", role: "assistant", parts: [part] } as unknown as UIMessage;
}

it("renders the compact memory chip for a successful memory tool call", () => {
  render(
    <MessageList
      messages={[
        assistantWithPart({
          type: "tool-memory",
          toolCallId: "call-mem",
          state: "output-available",
          input: { action: "write" },
          output: JSON.stringify({ ok: true }),
        }),
      ]}
      isLoading={false}
    />,
  );
  expect(screen.getByText("Память обновлена")).toBeTruthy();
  // Non-collapsible: no ToolCallIndicator status text like a generic chip has.
  expect(screen.queryByText("Done")).toBeNull();
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
  expect(screen.queryByText("Память обновлена")).toBeNull();
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
  expect(screen.queryByText("Память обновлена")).toBeNull();
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
  expect(screen.queryByText("Память обновлена")).toBeNull();
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
  expect(screen.queryByText("Память обновлена")).toBeNull();
  expect(screen.getByText("Memory")).toBeTruthy();
});
