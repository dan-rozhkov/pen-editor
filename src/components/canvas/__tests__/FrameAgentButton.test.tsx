import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FrameAgentButton } from "../FrameAgentButton";
import { FRAME_QUICK_ACTIONS } from "../frameQuickActions";
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
    expect(screen.getByLabelText("Ask agent")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens the composer when the trigger is clicked", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("launches a frame agent chat with the typed text on send", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  make 3 layouts  " },
    });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledWith("frame-1", "make 3 layouts");
  });

  it("submits on Enter without Shift", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "go" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: false });
    expect(mockLaunch).toHaveBeenCalledWith("frame-1", "go");
  });

  it("does not submit on Shift+Enter", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "go" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("blocks send for empty/whitespace text", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(sendBtn);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("closes the composer after a successful send", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "go" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("closes the composer on Escape without launching", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("renders all quick actions in the open composer", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    for (const action of FRAME_QUICK_ACTIONS) {
      expect(screen.getByRole("button", { name: action.label })).toBeTruthy();
    }
  });

  it("launches a chat with the action's prompt and mode on click", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    const research = FRAME_QUICK_ACTIONS.find((a) => a.mode === "research")!;
    fireEvent.click(screen.getByRole("button", { name: research.label }));
    expect(mockLaunch).toHaveBeenCalledWith(
      "frame-1",
      research.prompt,
      research.mode,
    );
  });

  it("passes undefined mode for actions without an explicit mode", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    const noMode = FRAME_QUICK_ACTIONS.find((a) => !a.mode)!;
    fireEvent.click(screen.getByRole("button", { name: noMode.label }));
    expect(mockLaunch).toHaveBeenCalledWith("frame-1", noMode.prompt, undefined);
  });

  it("closes the composer after a quick action runs", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.click(
      screen.getByRole("button", { name: FRAME_QUICK_ACTIONS[0].label }),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
