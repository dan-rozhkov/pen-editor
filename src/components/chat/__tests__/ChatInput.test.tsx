import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { ChatInput } from "../ChatInput";
import { useChatStore } from "@/store/chatStore";
import type { ChatLaunchPayload } from "@/types/chat";
import type { SelectionScreenshot } from "@/hooks/useSelectionScreenshots";

// Controllable selection screenshots — the real hook needs the PixiJS renderer.
let mockSelection: SelectionScreenshot[] = [];
vi.mock("@/hooks/useSelectionScreenshots", () => ({
  useSelectionScreenshots: () => mockSelection,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // A known vision-capable model so the attach button is enabled.
  useChatStore.setState({ model: "google/gemini-2.5-flash" });
  mockSelection = [];
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

  describe("offline", () => {
    it("disables the send button and labels it as offline", () => {
      vi.stubGlobal("navigator", { onLine: false });
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} initialInput="hello" />);
      const sendBtn = screen.getByTitle(
        "Offline — sending is disabled"
      ) as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
      fireEvent.click(sendBtn);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("does not submit on Enter while offline", () => {
      vi.stubGlobal("navigator", { onLine: false });
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} initialInput="hello" />);
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it("offers an enabled Attach image button for a vision-capable model", () => {
    render(<Harness onSubmit={vi.fn()} />);
    const attach = screen.getByTitle("Attach image") as HTMLButtonElement;
    expect(attach.disabled).toBe(false);
  });

  describe("selected canvas elements as context", () => {
    const selection: SelectionScreenshot[] = [
      { nodeId: "frame1", name: "Screen", dataUrl: "data:image/png;base64,a" },
      { nodeId: "rect2", name: "Box", dataUrl: "data:image/png;base64,b" },
    ];

    it("shows selected elements as previews above the input", () => {
      mockSelection = selection;
      render(<Harness onSubmit={vi.fn()} />);
      expect(screen.queryByText("2 selected elements attached as context")).toBeNull();
      expect(screen.getByAltText("Screen")).toBeTruthy();
      expect(screen.getByAltText("Box")).toBeTruthy();
    });

    it("attaches selected elements as images when sending", () => {
      mockSelection = selection;
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} />);
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "tweak these" },
      });
      fireEvent.click(screen.getByTitle("Send"));
      expect(onSubmit).toHaveBeenCalledWith({
        text: "tweak these",
        images: [
          { dataUrl: "data:image/png;base64,a", name: "Screen" },
          { dataUrl: "data:image/png;base64,b", name: "Box" },
        ],
      });
    });

    it("can send with only a selection and no text", () => {
      mockSelection = selection;
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} />);
      const sendBtn = screen.getByTitle("Send") as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(false);
      fireEvent.click(sendBtn);
      expect(onSubmit).toHaveBeenCalledWith({
        text: "",
        images: [
          { dataUrl: "data:image/png;base64,a", name: "Screen" },
          { dataUrl: "data:image/png;base64,b", name: "Box" },
        ],
      });
    });

    it("drops a dismissed selection element from the attached context", () => {
      mockSelection = selection;
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} />);
      // Dismiss the first selected element ("Screen").
      fireEvent.click(screen.getAllByTitle("Remove from context")[0]);
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "just the box" },
      });
      fireEvent.click(screen.getByTitle("Send"));
      expect(onSubmit).toHaveBeenCalledWith({
        text: "just the box",
        images: [{ dataUrl: "data:image/png;base64,b", name: "Box" }],
      });
    });

    it("does not attach selection images for a non-vision model", () => {
      // The real hook returns [] for non-vision models, so an empty selection
      // is the faithful emulation here.
      mockSelection = [];
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} initialInput="hi" />);
      fireEvent.click(screen.getByTitle("Send"));
      expect(onSubmit).toHaveBeenCalledWith({ text: "hi", images: undefined });
    });

    it("caps a selection larger than the limit and warns about the overflow", () => {
      mockSelection = Array.from({ length: 6 }, (_, i) => ({
        nodeId: `n${i}`,
        name: `Node ${i}`,
        dataUrl: `data:image/png;base64,${i}`,
      }));
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} initialInput="go" />);
      expect(
        screen.getByText(/Only 4 images can be sent per message/)
      ).toBeTruthy();
      fireEvent.click(screen.getByTitle("Send"));
      const payload = onSubmit.mock.calls[0][0] as ChatLaunchPayload;
      expect(payload.images).toHaveLength(4);
      expect(payload.images?.map((img) => img.name)).toEqual([
        "Node 0",
        "Node 1",
        "Node 2",
        "Node 3",
      ]);
    });

    it("restores a dismissed element after it is deselected and reselected", () => {
      mockSelection = selection;
      const { rerender } = render(<Harness onSubmit={vi.fn()} />);

      // Dismiss "Screen", then deselect it (it leaves the selection).
      fireEvent.click(screen.getAllByTitle("Remove from context")[0]);
      expect(screen.queryByAltText("Screen")).toBeNull();

      mockSelection = [selection[1]];
      rerender(<Harness onSubmit={vi.fn()} />);
      expect(screen.queryByAltText("Screen")).toBeNull();

      // Reselect it — the stale dismissal must not suppress it anymore.
      mockSelection = selection;
      rerender(<Harness onSubmit={vi.fn()} />);
      expect(screen.getByAltText("Screen")).toBeTruthy();
    });
  });
});
