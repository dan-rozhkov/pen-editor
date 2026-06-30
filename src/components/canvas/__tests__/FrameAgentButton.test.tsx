import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FrameAgentButton } from "../FrameAgentButton";
import type { FrameNode } from "@/types/scene";

const mockLaunch = vi.fn();
vi.mock("@/lib/launchFrameAgentChat", () => ({
  launchFrameAgentChat: (...args: unknown[]) => mockLaunch(...args),
}));

const frame = {
  id: "frame-1",
  type: "frame",
  name: "Home",
  x: 0,
  y: 0,
  width: 320,
  height: 600,
  children: [],
} as unknown as FrameNode;

function renderButton() {
  return render(
    <FrameAgentButton node={frame} absoluteX={0} absoluteY={0} />,
  );
}

afterEach(() => cleanup());
beforeEach(() => mockLaunch.mockReset());

describe("<FrameAgentButton />", () => {
  it("renders a trigger button with the composer closed initially", () => {
    renderButton();
    expect(screen.getByTitle("Ask agent")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens the composer when the trigger is clicked", () => {
    renderButton();
    fireEvent.click(screen.getByTitle("Ask agent"));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("launches a frame agent chat with the typed text on send", () => {
    renderButton();
    fireEvent.click(screen.getByTitle("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  make 3 layouts  " },
    });
    fireEvent.click(screen.getByTitle("Send"));
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledWith("frame-1", "make 3 layouts");
  });

  it("submits on Enter without Shift", () => {
    renderButton();
    fireEvent.click(screen.getByTitle("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "go" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: false });
    expect(mockLaunch).toHaveBeenCalledWith("frame-1", "go");
  });

  it("does not submit on Shift+Enter", () => {
    renderButton();
    fireEvent.click(screen.getByTitle("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "go" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("blocks send for empty/whitespace text", () => {
    renderButton();
    fireEvent.click(screen.getByTitle("Ask agent"));
    const sendBtn = screen.getByTitle("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(sendBtn);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("closes the composer after a successful send", () => {
    renderButton();
    fireEvent.click(screen.getByTitle("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "go" } });
    fireEvent.click(screen.getByTitle("Send"));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("closes the composer on Escape without launching", () => {
    renderButton();
    fireEvent.click(screen.getByTitle("Ask agent"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});
