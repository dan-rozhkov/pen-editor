import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ChatInput } from "../ChatInput";
import { useChatStore } from "@/store/chatStore";
import type { ChatLaunchPayload } from "@/types/chat";
import type { SelectionContextItem } from "@/hooks/useSelectionScreenshots";
import type { EmbedElementContext } from "@/hooks/useEmbedElementContext";

// Controllable selection screenshots — the real hook needs the PixiJS renderer.
let mockSelection: SelectionContextItem[] = [];
vi.mock("@/hooks/useSelectionScreenshots", () => ({
  useSelectionScreenshots: () => mockSelection,
}));

// Controllable embed element context — the real hook reads two stores;
// stubbing it keeps this file focused on ChatInput's own rendering/gating
// logic (the hook itself is covered by useEmbedElementContext.test.ts).
let mockEmbedElementContext: EmbedElementContext | null = null;
vi.mock("@/hooks/useEmbedElementContext", () => ({
  useEmbedElementContext: () => mockEmbedElementContext,
}));

// Dropped/pasted files must be routed through the downscale helper (finding
// B, 2026-08-14 code review) — a phone photo can exceed the backend's
// data-URL size cap unscaled. Stub it so the test doesn't depend on a real
// canvas/Image decode (happy-dom has neither) and can assert it was called.
const downscaleImageDataUrl = vi.fn(async (dataUrl: string, _maxSide?: number) => `${dataUrl}-downscaled`);
vi.mock("@/lib/tools/screenshotDownscale", () => ({
  downscaleImageDataUrl: (dataUrl: string, maxSide?: number) =>
    downscaleImageDataUrl(dataUrl, maxSide),
}));

// The shipped model reads images natively, so the "no native vision but the
// backend has an auxiliary vision fallback" case has no real fixture — these
// flags stand in for it. Default is the shipped shape (native vision).
const vision = vi.hoisted(() => ({ native: true, canSend: true }));
vi.mock("@/lib/chatModels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chatModels")>();
  return {
    ...actual,
    modelSupportsVision: () => vision.native,
    canSendImages: () => vision.canSend,
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // Native vision (the shipped model) so the attach button is enabled, and a
  // clean per-session attachment map so tests don't leak attachments into
  // each other.
  vision.native = true;
  vision.canSend = true;
  useChatStore.setState({
    attachedImages: {},
    dismissedSelection: {},
  });
  mockSelection = [];
  mockEmbedElementContext = null;
  downscaleImageDataUrl.mockClear();
});

interface HarnessProps {
  onSubmit: (payload: ChatLaunchPayload) => boolean;
  isLoading?: boolean;
  stop?: () => void;
  initialInput?: string;
  sessionId?: string;
}

/** Wrap ChatInput with local input state, mirroring the real parent wiring. */
function Harness({
  onSubmit,
  isLoading = false,
  stop = () => {},
  initialInput = "",
  sessionId = "test-session",
}: HarnessProps) {
  const [input, setInput] = useState(initialInput);
  return (
    <ChatInput
      sessionId={sessionId}
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

  it("leaves room for a full text line and its vertical padding", () => {
    render(<Harness onSubmit={vi.fn()} />);
    expect(screen.getByRole("textbox").className).toContain("min-h-[29px]");
  });

  it("submits the trimmed text via the Send button", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  make it blue  " } });
    fireEvent.click(screen.getByLabelText("Send"));
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
    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
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

  it("still calls onSubmit on Enter while loading — the caller queues it", () => {
    // While the agent is busy, Enter no longer no-ops: useDesignChat's
    // sendPayload queues the message and returns true so the composer
    // clears, showing up in the queue stack instead of failing silently.
    const onSubmit = vi.fn(() => true);
    render(<Harness onSubmit={onSubmit} isLoading initialInput="ready" />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith({ text: "ready", images: undefined });
  });

  it("shows a Stop button while loading and fires the stop callback", () => {
    const stop = vi.fn();
    render(<Harness onSubmit={vi.fn()} isLoading stop={stop} />);
    const stopBtn = screen.getByLabelText("Stop");
    fireEvent.click(stopBtn);
    expect(stop).toHaveBeenCalledTimes(1);
    // While loading, the Send button is replaced.
    expect(screen.queryByLabelText("Send")).toBeNull();
  });

  // FIX 4: the point of the queue feature is that mouse/touch users need a
  // visible way to submit-to-queue too, not just Enter. When the agent is
  // busy AND there's content in the composer, a queue-send control must sit
  // alongside Stop (which stays available at all times).
  it("shows a queue-send control alongside Stop while loading with content present", () => {
    const stop = vi.fn();
    const onSubmit = vi.fn(() => true);
    render(
      <Harness onSubmit={onSubmit} isLoading stop={stop} initialInput="queue me" />
    );

    expect(screen.getByLabelText("Stop")).toBeTruthy();
    const queueBtn = screen.getByLabelText("Queue message") as HTMLButtonElement;
    expect(queueBtn.disabled).toBe(false);

    fireEvent.click(queueBtn);
    expect(onSubmit).toHaveBeenCalledWith({ text: "queue me", images: undefined });
  });

  it("does not show a queue-send control while loading with an empty composer", () => {
    render(<Harness onSubmit={vi.fn()} isLoading stop={vi.fn()} />);
    expect(screen.getByLabelText("Stop")).toBeTruthy();
    expect(screen.queryByLabelText("Queue message")).toBeNull();
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
      const sendBtn = screen.getByLabelText(
        "Offline — sending is disabled"
      ) as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
      fireEvent.click(sendBtn);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("still calls onSubmit on Enter while offline, so the per-message offline error can surface", () => {
      // The send button stays disabled (covered above), but Enter bypasses
      // it entirely — doSubmit must not silently swallow the attempt.
      // sendPayload's own offline guard (useDesignChat) is what actually
      // blocks the send and shows the error; ChatInput's job is only to not
      // gate on isOnline itself.
      vi.stubGlobal("navigator", { onLine: false });
      const onSubmit = vi.fn(() => false);
      render(<Harness onSubmit={onSubmit} initialInput="hello" />);
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      expect(onSubmit).toHaveBeenCalledWith({ text: "hello", images: undefined });
    });

    it("keeps attachments and dismissed-selection state when onSubmit reports the send failed", () => {
      const selection: SelectionContextItem[] = [
        { nodeId: "frame1", name: "Screen", type: "rect", dataUrl: "data:image/png;base64,a" },
      ];
      mockSelection = selection;
      vi.stubGlobal("navigator", { onLine: false });
      const onSubmit = vi.fn(() => false);
      render(<Harness onSubmit={onSubmit} initialInput="hello" />);

      // Dismiss the selection preview before attempting to send.
      fireEvent.click(screen.getByLabelText("Remove from context"));
      expect(screen.queryByAltText("Screen")).toBeNull();

      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      expect(onSubmit).toHaveBeenCalledTimes(1);

      // A failed send must not reset the dismissal — the previous (buggy)
      // behavior cleared it unconditionally, silently restoring the
      // dismissed preview as if the message had actually gone out.
      expect(screen.queryByAltText("Screen")).toBeNull();
    });

    it("keeps an explicitly attached image when onSubmit reports the send failed", async () => {
      const onSubmit = vi.fn(() => false);
      render(<Harness onSubmit={onSubmit} initialInput="hello" />);

      const fileInput = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => expect(screen.getByAltText("photo.png")).toBeTruthy());

      vi.stubGlobal("navigator", { onLine: false });
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      // The failed send must not have cleared the attachment.
      expect(screen.getByAltText("photo.png")).toBeTruthy();
    });
  });

  it("routes a dropped/picked file through the downscale helper before attaching it", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByAltText("photo.png")).toBeTruthy());
    expect(downscaleImageDataUrl).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Send"));
    const payload = onSubmit.mock.calls[0][0] as ChatLaunchPayload;
    expect(payload.images?.[0].dataUrl).toBe(
      `${downscaleImageDataUrl.mock.calls[0][0]}-downscaled`
    );
  });

  it("keeps attachments in the store when the input unmounts and remounts for the same session", async () => {
    const { unmount } = render(
      <Harness onSubmit={vi.fn()} sessionId="tab-A" />
    );

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByAltText("photo.png")).toBeTruthy());
    expect(useChatStore.getState().attachedImages["tab-A"]).toHaveLength(1);

    // Simulate the tab going inactive (ChatSession returns null) and back.
    unmount();
    expect(useChatStore.getState().attachedImages["tab-A"]).toHaveLength(1);

    render(<Harness onSubmit={vi.fn()} sessionId="tab-A" />);
    expect(screen.getByAltText("photo.png")).toBeTruthy();
  });

  it("keeps each session's attachments separate", async () => {
    const { unmount } = render(
      <Harness onSubmit={vi.fn()} sessionId="tab-A" />
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["a"], "a.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(screen.getByAltText("a.png")).toBeTruthy());
    unmount();

    // A different session starts empty and doesn't see tab-A's attachment.
    render(<Harness onSubmit={vi.fn()} sessionId="tab-B" />);
    expect(screen.queryByAltText("a.png")).toBeNull();
    expect(useChatStore.getState().attachedImages["tab-B"]).toBeUndefined();
  });

  it("offers an enabled Attach image button when the model reads images", () => {
    render(<Harness onSubmit={vi.fn()} />);
    const attach = screen.getByLabelText("Attach image") as HTMLButtonElement;
    expect(attach.disabled).toBe(false);
  });

  it("allows attaching without native vision when the backend has a vision fallback", async () => {
    vision.native = false;
    vision.canSend = true;
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    // Attach control is enabled with copy explaining the description-only path.
    const attach = screen.getByLabelText(
      "Attach image (described as text for this model)"
    ) as HTMLButtonElement;
    expect(attach.disabled).toBe(false);

    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(["fake-bytes"], "ref.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText("ref.png")).toBeTruthy());

    // Honest, non-blocking notice — attaching is allowed, not refused.
    expect(
      screen.getByText(/converted to a text description/)
    ).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Send"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0] as ChatLaunchPayload;
    expect(payload.images).toHaveLength(1);
    expect(payload.images?.[0].name).toBe("ref.png");
  });

  describe("selected canvas elements as context", () => {
    const selection: SelectionContextItem[] = [
      { nodeId: "text1", name: "Screen", type: "text", dataUrl: "data:image/png;base64,a" },
      { nodeId: "rect2", name: "Box", type: "rect", dataUrl: "data:image/png;base64,b" },
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
      fireEvent.click(screen.getByLabelText("Send"));
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
      const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
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
      fireEvent.click(screen.getAllByLabelText("Remove from context")[0]);
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "just the box" },
      });
      fireEvent.click(screen.getByLabelText("Send"));
      expect(onSubmit).toHaveBeenCalledWith({
        text: "just the box",
        images: [{ dataUrl: "data:image/png;base64,b", name: "Box" }],
      });
    });

    it("keeps a dismissed selection in the store across an unmount/remount for the same session", () => {
      mockSelection = selection;
      const { unmount } = render(
        <Harness onSubmit={vi.fn()} sessionId="tab-A" />
      );
      // Dismiss "Screen" — only "Box" should remain as context.
      fireEvent.click(screen.getAllByLabelText("Remove from context")[0]);
      expect(useChatStore.getState().dismissedSelection["tab-A"]).toBeTruthy();

      unmount();
      expect(useChatStore.getState().dismissedSelection["tab-A"]).toBeTruthy();

      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} sessionId="tab-A" />);
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "just the box" },
      });
      fireEvent.click(screen.getByLabelText("Send"));
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
      fireEvent.click(screen.getByLabelText("Send"));
      expect(onSubmit).toHaveBeenCalledWith({ text: "hi", images: undefined });
    });

    it("renders a reference-only (frame) selection item as a chip, not an image, and omits it from the sent images", () => {
      const withFrame: SelectionContextItem[] = [
        { nodeId: "frame1", name: "Home Screen", type: "frame", dataUrl: null },
        { nodeId: "rect2", name: "Box", type: "rect", dataUrl: "data:image/png;base64,b" },
      ];
      mockSelection = withFrame;
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} />);

      // Chip renders the node's name, not an <img>.
      expect(screen.getByText("Home Screen")).toBeTruthy();
      expect(screen.queryByAltText("Home Screen")).toBeNull();
      expect(screen.getByAltText("Box")).toBeTruthy();

      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "tweak this" },
      });
      fireEvent.click(screen.getByLabelText("Send"));
      // Only the image item is sent — the frame reference carries no
      // message content of its own (its id already rides in canvasContext).
      expect(onSubmit).toHaveBeenCalledWith({
        text: "tweak this",
        images: [{ dataUrl: "data:image/png;base64,b", name: "Box" }],
      });
    });

    it("does not render a remove button on a reference-only (frame) chip — its id keeps riding in canvasContext regardless", () => {
      const withFrame: SelectionContextItem[] = [
        { nodeId: "frame1", name: "Home Screen", type: "frame", dataUrl: null },
        { nodeId: "rect2", name: "Box", type: "rect", dataUrl: "data:image/png;base64,b" },
      ];
      mockSelection = withFrame;
      render(<Harness onSubmit={vi.fn()} />);

      // The image chip ("Box") gets exactly one remove button; the
      // reference-only chip ("Home Screen") gets none — a button that
      // dismissed it from the composer's list could never actually take its
      // id out of the next request's canvasContext, so it isn't offered.
      expect(screen.getAllByLabelText("Remove from context")).toHaveLength(1);
    });

    it("does not count a reference-only (frame) item toward MAX_IMAGES", () => {
      const manyFrames: SelectionContextItem[] = Array.from(
        { length: 5 },
        (_, i) => ({
          nodeId: `frame-${i}`,
          name: `Frame ${i}`,
          type: "frame",
          dataUrl: null,
        }),
      );
      mockSelection = manyFrames;
      render(<Harness onSubmit={vi.fn()} initialInput="go" />);
      // 5 frame references exceed MAX_IMAGES (4) but none are images, so no
      // overflow warning and the attach button stays enabled.
      expect(
        screen.queryByText(/Only 4 images can be sent per message/)
      ).toBeNull();
      const attach = screen.getByLabelText("Attach image") as HTMLButtonElement;
      expect(attach.disabled).toBe(false);
    });

    it("blocks sending when only a reference-only frame is selected and there's no text or image", () => {
      // A reference-only selection is not message content — sending must
      // stay blocked unless there's text or an actual image attached.
      mockSelection = [
        { nodeId: "frame1", name: "Home Screen", type: "frame", dataUrl: null },
      ];
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} />);
      const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
      fireEvent.click(sendBtn);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("caps a selection larger than the limit and warns about the overflow", () => {
      mockSelection = Array.from({ length: 6 }, (_, i) => ({
        nodeId: `n${i}`,
        name: `Node ${i}`,
        type: "rect",
        dataUrl: `data:image/png;base64,${i}`,
      }));
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} initialInput="go" />);
      expect(
        screen.getByText(/Only 4 images can be sent per message/)
      ).toBeTruthy();
      fireEvent.click(screen.getByLabelText("Send"));
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
      fireEvent.click(screen.getAllByLabelText("Remove from context")[0]);
      expect(screen.queryByAltText("Screen")).toBeNull();

      mockSelection = [selection[1]];
      rerender(<Harness onSubmit={vi.fn()} />);
      expect(screen.queryByAltText("Screen")).toBeNull();

      // Reselect it — the stale dismissal must not suppress it anymore.
      mockSelection = selection;
      rerender(<Harness onSubmit={vi.fn()} />);
      expect(screen.getByAltText("Screen")).toBeTruthy();
    });

    it("outlines the selection chip's wrapper (not the letterboxed thumbnail) with the shared img-outline utility", () => {
      mockSelection = selection;
      render(<Harness onSubmit={vi.fn()} />);
      const img = screen.getByAltText("Screen");
      // The thumbnail is `object-contain` inside a fixed-size box, so an
      // outline on the <img> itself would ring the grey letterbox rather
      // than the rendered image — it belongs on the wrapper instead.
      expect(img.className).not.toContain("img-outline");
      expect(img.parentElement?.className).toContain("img-outline");
    });
  });

  describe("selected embed element as context", () => {
    it("renders a chip with the formatted label when an element is selected in a live embed", () => {
      mockEmbedElementContext = {
        selection: {
          embedId: "embed1",
          path: "div:nth-of-type(1)",
          tagName: "button",
          classes: ["primary"],
          textPreview: "Buy now",
          outerHtml: "<button class=\"primary\">Buy now</button>",
        },
        label: "button.primary",
        embedName: "Hero Embed",
      };
      render(<Harness onSubmit={vi.fn()} />);
      expect(screen.getByText("button.primary")).toBeTruthy();
      expect(
        screen.getByLabelText("Selected embed element: button.primary")
      ).toBeTruthy();
    });

    it("does not render a chip when there is no embed element selection", () => {
      mockEmbedElementContext = null;
      render(<Harness onSubmit={vi.fn()} />);
      expect(screen.queryByText("button.primary")).toBeNull();
      expect(
        screen.queryByLabelText(/^Selected embed element:/)
      ).toBeNull();
    });

    it("does not render a remove button on the embed element chip", () => {
      mockEmbedElementContext = {
        selection: {
          embedId: "embed1",
          path: "div:nth-of-type(1)",
          tagName: "div",
          classes: [],
          textPreview: "",
          outerHtml: "<div></div>",
        },
        label: "div",
        embedName: "Hero Embed",
      };
      render(<Harness onSubmit={vi.fn()} />);
      expect(screen.getByText("div")).toBeTruthy();
      expect(screen.queryByLabelText("Remove from context")).toBeNull();
    });
  });

  it("outlines an attached image chip's wrapper with the shared img-outline utility and no separate border", () => {
    useChatStore.getState().setAttachedImages("test-session", [
      { dataUrl: "data:image/png;base64,c", name: "photo.png" },
    ]);
    render(<Harness onSubmit={vi.fn()} />);
    const img = screen.getByAltText("photo.png");
    expect(img.className).not.toContain("img-outline");
    expect(img.parentElement?.className).toContain("img-outline");
    expect(img.parentElement?.className).not.toContain("border-border-default");
  });
});
