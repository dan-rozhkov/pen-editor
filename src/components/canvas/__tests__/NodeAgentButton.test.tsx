import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NodeAgentButton } from "../NodeAgentButton";
import { FRAME_QUICK_ACTIONS } from "../frameQuickActions";

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

afterEach(() => cleanup());
beforeEach(() => launch.mockReset());

describe("<NodeAgentButton />", () => {
  it("starts with the composer closed", () => {
    renderButton();
    expect(screen.getByLabelText("Ask agent")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
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
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(send);
    expect(launch).not.toHaveBeenCalled();
  });

  it("closes on Escape without launching", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(launch).not.toHaveBeenCalled();
  });

  it("runs a quick action with its prompt and mode", () => {
    renderButton();
    fireEvent.click(screen.getByLabelText("Ask agent"));
    const research = FRAME_QUICK_ACTIONS.find((a) => a.mode === "research")!;
    fireEvent.click(screen.getByRole("button", { name: research.label }));
    expect(launch).toHaveBeenCalledWith("n-1", research.prompt, research.mode);
  });
});
