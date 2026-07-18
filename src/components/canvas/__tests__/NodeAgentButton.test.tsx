import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NodeAgentButton } from "../NodeAgentButton";
import { FRAME_QUICK_ACTIONS } from "../frameQuickActions";
import { useDevModeStore } from "@/store/devModeStore";

const launch = vi.fn();
const node = { id: "n-1", width: 320, height: 600 };

function renderButton() {
  return render(
    <NodeAgentButton
      node={node}
      absoluteX={0}
      absoluteY={0}
      placeholder="Ask about this node…"
      launch={launch}
    />,
  );
}

afterEach(() => {
  cleanup();
  useDevModeStore.setState({ active: false });
});
beforeEach(() => {
  launch.mockReset();
  useDevModeStore.setState({ active: false });
});

describe("<NodeAgentButton />", () => {
  it("starts with the composer closed", () => {
    renderButton();
    expect(screen.getByLabelText("Ask agent")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("hides the trigger in dev mode", () => {
    useDevModeStore.setState({ active: true });
    renderButton();
    expect(screen.queryByLabelText("Ask agent")).toBeNull();
  });

  it("uses the component accent when requested", () => {
    render(
      <NodeAgentButton
        node={node}
        absoluteX={0}
        absoluteY={0}
        placeholder="Ask about this node…"
        isComponentContext
        launch={launch}
      />,
    );
    expect(screen.getByLabelText("Ask agent").classList.contains("bg-[#8b5cf6]")).toBe(true);
  });

  it("opens the composer with the given placeholder", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.placeholder).toBe("Ask about this node…");
  });

  it("calls launch with trimmed text on send", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  hi there  " } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(launch).toHaveBeenCalledWith("n-1", "hi there");
  });

  it("submits on Enter, not Shift+Enter", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "go" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(launch).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: false });
    expect(launch).toHaveBeenCalledWith("n-1", "go");
  });

  it("blocks send for whitespace-only text", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    const send = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.classList.contains("bg-transparent")).toBe(true);
    expect(send.classList.contains("text-text-secondary")).toBe(true);
    expect(send.classList.contains("disabled:opacity-100")).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(send);
    expect(launch).not.toHaveBeenCalled();
  });

  it("uses the blue send button only when there is text to send", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    const send = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    expect(send.classList.contains("bg-accent-primary")).toBe(true);
  });

  it("closes on Escape without launching", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(launch).not.toHaveBeenCalled();
  });

  it("runs a quick action with its prompt", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    const action = FRAME_QUICK_ACTIONS[0];
    fireEvent.click(screen.getByRole("button", { name: action.label }));
    expect(launch).toHaveBeenCalledWith("n-1", action.prompt);
  });
});
