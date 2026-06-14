import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { UIMessage } from "ai";
import { MessageList } from "../MessageList";

afterEach(() => cleanup());

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantMessage(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

describe("<MessageList />", () => {
  it("shows the empty state when there are no messages", () => {
    render(<MessageList messages={[]} isLoading={false} />);
    expect(screen.getByText("Ask the design agent anything")).toBeTruthy();
  });

  it("renders a user message bubble", () => {
    render(
      <MessageList
        messages={[userMessage("u1", "make it blue")]}
        isLoading={false}
      />
    );
    expect(screen.getByText("make it blue")).toBeTruthy();
  });

  it("renders an assistant message with markdown content", () => {
    const { container } = render(
      <MessageList
        messages={[assistantMessage("a1", "**done**")]}
        isLoading={false}
      />
    );
    expect(container.querySelector("strong")?.textContent).toBe("done");
  });

  it("renders both user and assistant messages in order", () => {
    render(
      <MessageList
        messages={[
          userMessage("u1", "hello there"),
          assistantMessage("a1", "hi back"),
        ]}
        isLoading={false}
      />
    );
    expect(screen.getByText("hello there")).toBeTruthy();
    expect(screen.getByText("hi back")).toBeTruthy();
  });

  it("renders a tool-call entry inside an assistant message", () => {
    const msg: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-get_variables",
          toolCallId: "call-1",
          state: "output-available",
          input: {},
          output: { variables: [] },
        } as unknown as UIMessage["parts"][number],
      ],
    };
    render(<MessageList messages={[msg]} isLoading={false} />);
    expect(screen.getByText("Get Variables")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("renders attached images on a user message", () => {
    const msg: UIMessage = {
      id: "u1",
      role: "user",
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          url: "data:image/png;base64,AAAA",
        } as unknown as UIMessage["parts"][number],
        { type: "text", text: "look" },
      ],
    };
    render(<MessageList messages={[msg]} isLoading={false} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(screen.getByText("look")).toBeTruthy();
  });

  it("shows a trailing streaming indicator after a user message while loading", () => {
    const { container } = render(
      <MessageList
        messages={[userMessage("u1", "go")]}
        isLoading={true}
      />
    );
    // StreamingIndicator renders three bouncing dot spans.
    expect(container.querySelectorAll("span.animate-bounce").length).toBe(3);
  });

  it("renders a rollback button for user messages when onRollback is provided", () => {
    const onRollback = vi.fn();
    render(
      <MessageList
        messages={[userMessage("u1", "redo this")]}
        isLoading={false}
        onRollback={onRollback}
      />
    );
    const rollbackBtn = screen.getByTitle("Roll back to this message");
    fireEvent.click(rollbackBtn);
    expect(onRollback).toHaveBeenCalledWith("u1");
  });

  it("omits the rollback button when onRollback is not provided", () => {
    render(
      <MessageList
        messages={[userMessage("u1", "redo this")]}
        isLoading={false}
      />
    );
    expect(screen.queryByTitle("Roll back to this message")).toBeNull();
  });
});
