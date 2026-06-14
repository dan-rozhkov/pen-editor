import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { ChatInput } from "../ChatInput";
import { useChatStore } from "@/store/chatStore";
import type { ChatLaunchPayload } from "@/types/chat";

afterEach(() => cleanup());

beforeEach(() => {
  // A known vision-capable model so the attach button is enabled.
  useChatStore.setState({ model: "google/gemini-2.5-flash" });
});

interface HarnessProps {
  onSubmit: (payload: ChatLaunchPayload) => void;
  isLoading?: boolean;
  stop?: () => void;
  initialInput?: string;
}

/** Wrap ChatInput with local input state, mirroring the real parent wiring. */
function Harness({
  onSubmit,
  isLoading = false,
  stop = () => {},
  initialInput = "",
}: HarnessProps) {
  const [input, setInput] = useState(initialInput);
  return (
    <ChatInput
      input={input}
      setInput={setInput}
      onSubmit={onSubmit}
      isLoading={isLoading}
      stop={stop}
    />
  );
}

describe("<ChatInput />", () => {
  it("updates the textarea value as the user types", () => {
    render(<Harness onSubmit={vi.fn()} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello agent" } });
    expect(textarea.value).toBe("hello agent");
  });

  it("submits the trimmed text via the Send button", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  make it blue  " } });
    fireEvent.click(screen.getByTitle("Send"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      text: "make it blue",
      images: undefined,
    });
  });

  it("submits on Enter without Shift", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "go" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSubmit).toHaveBeenCalledWith({ text: "go", images: undefined });
  });

  it("does NOT submit on Shift+Enter (newline)", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks submit when the input is empty (button disabled, no callback)", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const sendBtn = screen.getByTitle("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(sendBtn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks submit for whitespace-only input", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit while loading even with text present", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} isLoading initialInput="ready" />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a Stop button while loading and fires the stop callback", () => {
    const stop = vi.fn();
    render(<Harness onSubmit={vi.fn()} isLoading stop={stop} />);
    const stopBtn = screen.getByTitle("Stop");
    fireEvent.click(stopBtn);
    expect(stop).toHaveBeenCalledTimes(1);
    // While loading, the Send button is replaced.
    expect(screen.queryByTitle("Send")).toBeNull();
  });

  it("surfaces the slash-command menu when the input is a slash query", () => {
    render(<Harness onSubmit={vi.fn()} />);
    const textarea = screen.getByRole("textbox");
    expect(screen.queryByText("/audit")).toBeNull();
    fireEvent.change(textarea, { target: { value: "/aud" } });
    // SlashCommandMenu now renders filtered to audit.
    expect(screen.getByText("/audit")).toBeTruthy();
  });

  it("selecting a slash command replaces the input with the command", () => {
    render(<Harness onSubmit={vi.fn()} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "/aud" } });
    fireEvent.mouseDown(screen.getByText("/audit"));
    expect(textarea.value).toBe("/audit ");
  });

  it("hides the slash menu once the input is no longer a bare slash query", () => {
    render(<Harness onSubmit={vi.fn()} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "/aud" } });
    expect(screen.getByText("/audit")).toBeTruthy();
    // A space means it's no longer a single-token slash query.
    fireEvent.change(textarea, { target: { value: "/audit now" } });
    expect(screen.queryByText("/audit")).toBeNull();
  });

  it("offers an enabled Attach image button for a vision-capable model", () => {
    render(<Harness onSubmit={vi.fn()} />);
    const attach = screen.getByTitle("Attach image") as HTMLButtonElement;
    expect(attach.disabled).toBe(false);
  });
});
