import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import { useState } from "react";
import { ChatInput } from "../ChatInput";
import { useChatStore } from "@/store/chatStore";
import { createWorkflow, deleteWorkflow, stepsFromTexts, updateWorkflow } from "@/lib/workflows/workflowStore";
import { workflowToPrompt } from "@/lib/workflows/workflowMarkdown";
import type { ChatLaunchPayload } from "@/types/chat";
import type { SelectionContextItem } from "@/hooks/useSelectionContext";
import type { EmbedElementContext } from "@/hooks/useEmbedElementContext";
import {
  MAX_ATTACHMENT_SIDE,
  MAX_SCREENSHOT_SIDE,
} from "@/lib/tools/screenshotDownscale";

// Controllable selection context — the real hook reads sceneStore/selectionStore.
let mockSelection: SelectionContextItem[] = [];
vi.mock("@/hooks/useSelectionContext", () => ({
  useSelectionContext: () => mockSelection,
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
vi.mock("@/lib/tools/screenshotDownscale", async (importOriginal) => {
  // Only downscaleImageDataUrl is stubbed (it needs a real canvas/Image
  // decode). The limits come from the REAL module: a hardcoded copy here
  // would make the wiring assertion below pass forever, including after
  // someone changes the real constant — which is the one thing it exists to
  // catch.
  const actual = await importOriginal<
    typeof import("@/lib/tools/screenshotDownscale")
  >();
  return {
    ...actual,
    downscaleImageDataUrl: (dataUrl: string, maxSide?: number) =>
      downscaleImageDataUrl(dataUrl, maxSide),
  };
});

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
  shouldFocus?: boolean;
  suggestion?: string | null;
  awaitingAnswer?: boolean;
}

/** Wrap ChatInput with local input state, mirroring the real parent wiring. */
function Harness({
  onSubmit,
  isLoading = false,
  stop = () => {},
  initialInput = "",
  sessionId = "test-session",
  shouldFocus,
  suggestion,
  awaitingAnswer,
}: HarnessProps) {
  const [input, setInput] = useState(initialInput);
  const [live, setLive] = useState(suggestion);
  return (
    <ChatInput
      sessionId={sessionId}
      input={input}
      setInput={setInput}
      onSubmit={onSubmit}
      isLoading={isLoading}
      stop={stop}
      shouldFocus={shouldFocus}
      suggestion={live}
      onDismissSuggestion={() => setLive(null)}
      awaitingAnswer={awaitingAnswer}
    />
  );
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Opens the composer's "Attach" menu and returns the menu item whose name starts with `name` (the Image item may carry a hint after it). */
async function openAttachMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Attach" }));
  return screen.findByRole("menuitem", { name: new RegExp(`^${escapeRegExp(name)}`) });
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

  it("still calls onSubmit on Enter while loading — the caller interrupts and sends it", () => {
    // While the agent is busy, Enter does not no-op: useDesignChat's
    // sendPayload stops the turn, sends the message once the stop settles and
    // returns true so the composer clears.
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

  // Mouse/touch users need a visible way to send on top of a busy agent, not
  // just Enter. When the agent is busy AND there's content in the composer, a
  // send-now control must sit alongside Stop (which stays available).
  it("shows a send-now control alongside Stop while loading with content present", () => {
    const stop = vi.fn();
    const onSubmit = vi.fn(() => true);
    render(
      <Harness onSubmit={onSubmit} isLoading stop={stop} initialInput="send me now" />
    );

    expect(screen.getByLabelText("Stop")).toBeTruthy();
    const sendNowBtn = screen.getByLabelText("Send now") as HTMLButtonElement;
    expect(sendNowBtn.disabled).toBe(false);

    fireEvent.click(sendNowBtn);
    expect(onSubmit).toHaveBeenCalledWith({ text: "send me now", images: undefined });
  });

  it("does not show a send-now control while loading with an empty composer", () => {
    render(<Harness onSubmit={vi.fn()} isLoading stop={vi.fn()} />);
    expect(screen.getByLabelText("Stop")).toBeTruthy();
    expect(screen.queryByLabelText("Send now")).toBeNull();
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

    it("keeps a selection chip visible across a failed send — it carries no message content to lose", () => {
      const selection: SelectionContextItem[] = [
        { nodeId: "frame1", name: "Screen", type: "rect" },
      ];
      mockSelection = selection;
      vi.stubGlobal("navigator", { onLine: false });
      const onSubmit = vi.fn(() => false);
      render(<Harness onSubmit={onSubmit} initialInput="hello" />);

      expect(screen.getByText("Screen")).toBeTruthy();
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      expect(onSubmit).toHaveBeenCalledTimes(1);
      // The chip is derived straight from the (mocked) selection, not from
      // any per-message dismiss state, so a failed send can't affect it.
      expect(screen.getByText("Screen")).toBeTruthy();
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
    // A user-attached reference is downscaled by the attachment limit, not by
    // the tighter screenshot one — the agent can re-take a screenshot it blurred
    // away, but it cannot re-take the mockup the user handed it.
    expect(downscaleImageDataUrl.mock.calls[0][1]).toBe(MAX_ATTACHMENT_SIDE);
    expect(MAX_ATTACHMENT_SIDE).toBeGreaterThan(MAX_SCREENSHOT_SIDE);

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

  it("offers an enabled Image item in the Attach menu when the model reads images", async () => {
    render(<Harness onSubmit={vi.fn()} />);
    const item = await openAttachMenu("Image");
    expect(item.getAttribute("aria-disabled")).not.toBe("true");
    expect(item.textContent).toBe("Image");
  });

  it("allows attaching without native vision when the backend has a vision fallback", async () => {
    vision.native = false;
    vision.canSend = true;
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    // Attach item is enabled with copy explaining the description-only path.
    const item = await openAttachMenu("Image");
    expect(item.getAttribute("aria-disabled")).not.toBe("true");
    expect(item.textContent).toContain("described as text");

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
    // No SelectionContextItem carries a screenshot anymore — every node type
    // (frame, text, rect, embed, ref, ...) renders as a plain reference chip
    // with an icon and name, and never contributes message content.
    const selection: SelectionContextItem[] = [
      { nodeId: "text1", name: "Screen", type: "text" },
      { nodeId: "rect2", name: "Box", type: "rect" },
    ];

    it("shows selected elements as name-only chips above the input, for any node type", () => {
      mockSelection = selection;
      render(<Harness onSubmit={vi.fn()} />);
      expect(screen.getByText("Screen")).toBeTruthy();
      expect(screen.getByText("Box")).toBeTruthy();
      // No screenshot is ever rendered for a selection chip.
      expect(screen.queryByAltText("Screen")).toBeNull();
      expect(screen.queryByAltText("Box")).toBeNull();
    });

    it("does not attach selected elements as images, and does not offer a remove button", () => {
      mockSelection = selection;
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} />);
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "tweak these" },
      });
      fireEvent.click(screen.getByLabelText("Send"));
      expect(onSubmit).toHaveBeenCalledWith({
        text: "tweak these",
        images: undefined,
      });
      // The chip carries no message content of its own — its id already
      // rides in canvasContext — so a "remove" affordance would be dead.
      expect(screen.queryByLabelText("Remove from context")).toBeNull();
    });

    it("blocks sending when only a selection is present and there's no text or image", () => {
      // A selection is not message content — sending must stay blocked
      // unless there's text or an actual (manually attached) image.
      mockSelection = selection;
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} />);
      const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
      fireEvent.click(sendBtn);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("does not count selected elements toward MAX_IMAGES — manual attachments still fill all 4 slots", async () => {
      mockSelection = Array.from({ length: 5 }, (_, i) => ({
        nodeId: `n${i}`,
        name: `Node ${i}`,
        type: "rect",
      }));
      render(<Harness onSubmit={vi.fn()} initialInput="go" />);
      // 5 selected nodes would exceed MAX_IMAGES (4) if they occupied a
      // slot; they don't, so the attach button is unaffected.
      expect((await openAttachMenu("Image")).getAttribute("aria-disabled")).not.toBe("true");

      const fileInput = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      const files = Array.from({ length: 4 }, (_, i) =>
        new File(["x"], `p${i}.png`, { type: "image/png" })
      );
      fireEvent.change(fileInput, { target: { files } });
      await waitFor(() =>
        expect(screen.getAllByRole("img")).toHaveLength(4)
      );
    });

    it("caps the chip strip and collapses the rest into a +N more chip", () => {
      // A marquee can select hundreds of nodes; the strip must not grow the
      // composer without bound.
      mockSelection = Array.from({ length: 9 }, (_, i) => ({
        nodeId: `n${i}`,
        name: `Node ${i}`,
        type: "rect",
      }));
      render(<Harness onSubmit={vi.fn()} />);
      expect(screen.getByText("Node 5")).toBeTruthy();
      expect(screen.queryByText("Node 6")).toBeNull();
      expect(screen.getByText("+3 more")).toBeTruthy();
    });

    it("disables further attachment once 4 manual images are attached, independent of any selection", async () => {
      mockSelection = selection;
      render(<Harness onSubmit={vi.fn()} initialInput="go" />);

      const fileInput = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      const files = Array.from({ length: 5 }, (_, i) =>
        new File(["x"], `p${i}.png`, { type: "image/png" })
      );
      fireEvent.change(fileInput, { target: { files } });

      // Manual attachments alone are capped to MAX_IMAGES by addImages
      // (slice(0, MAX_IMAGES)); the selection contributes nothing to count.
      await waitFor(() =>
        expect(screen.getAllByRole("img")).toHaveLength(4)
      );
      const item = await openAttachMenu("Image");
      expect(item.getAttribute("aria-disabled")).toBe("true");
      expect(item.textContent).toContain("Max 4 images");
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

  // Code-review finding: the mobile Agents panel now stays mounted
  // (`display: none`) instead of remounting ChatInput on reopen, so
  // `shouldFocus` must be driven by a real visibility signal (computed by
  // the parent as agents-active AND, on mobile, panel-open) rather than a
  // boolean that stays true across close/reopen — otherwise the focus
  // effect (keyed on `[shouldFocus]`) never re-fires.
  it("focuses the textarea when shouldFocus flips from false to true (panel reopened)", () => {
    const { rerender } = render(
      <Harness onSubmit={vi.fn()} shouldFocus={false} />
    );
    const textarea = screen.getByRole("textbox");
    expect(document.activeElement).not.toBe(textarea);

    rerender(<Harness onSubmit={vi.fn()} shouldFocus={true} />);
    expect(document.activeElement).toBe(textarea);
  });

  it("does not focus the textarea while shouldFocus stays false", () => {
    const { rerender } = render(
      <Harness onSubmit={vi.fn()} shouldFocus={false} />
    );
    const textarea = screen.getByRole("textbox");
    rerender(<Harness onSubmit={vi.fn()} isLoading shouldFocus={false} />);
    expect(document.activeElement).not.toBe(textarea);
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

  describe("prompt suggestion", () => {
    const placeholder = () => (screen.getByRole("textbox") as HTMLTextAreaElement).placeholder;

    it("shows the suggestion as the placeholder while the input is empty", () => {
      render(<Harness onSubmit={vi.fn()} suggestion="add a footer" />);
      expect(placeholder()).toBe("add a footer");
      // No visible hint; screen readers get an sr-only description.
      expect(screen.getByRole("textbox").getAttribute("aria-describedby")).toBeTruthy();
      expect(screen.getByText(/Press Tab to accept/)).toBeTruthy();
    });

    it("sizes the textarea to a multi-line placeholder, capped at 96px", () => {
      const sh = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLTextAreaElement) {
        return this.value === "" ? 20 : 60;
      });
      render(<Harness onSubmit={vi.fn()} suggestion={"line one\nline two\nline three"} />);
      const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
      expect(ta.style.height).toBe("60px");
      expect(ta.value).toBe("");
      sh.mockRestore();
    });

    it("Tab accepts the suggestion into the input", () => {
      render(<Harness onSubmit={vi.fn()} suggestion="add a footer" />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      const notPrevented = fireEvent.keyDown(textarea, { key: "Tab" });
      expect(notPrevented).toBe(false);
      expect(textarea.value).toBe("add a footer");
      expect(textarea.selectionStart).toBe("add a footer".length);
    });

    it("ArrowRight accepts it too", () => {
      render(<Harness onSubmit={vi.fn()} suggestion="add a footer" />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      fireEvent.keyDown(textarea, { key: "ArrowRight" });
      expect(textarea.value).toBe("add a footer");
    });

    it("Tab without a suggestion keeps its default behavior", () => {
      render(<Harness onSubmit={vi.fn()} />);
      const textarea = screen.getByRole("textbox");
      expect(fireEvent.keyDown(textarea, { key: "Tab" })).toBe(true);
    });

    it("Enter on an empty input does not send the suggestion", () => {
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} suggestion="add a footer" />);
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("is dropped for good once the user types", () => {
      render(<Harness onSubmit={vi.fn()} suggestion="add a footer" />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "x" } });
      fireEvent.change(textarea, { target: { value: "" } });
      expect(placeholder()).toBe("Ask Sideform Agent…");
      expect(screen.queryByText(/Press Tab to accept/)).toBeNull();
    });

    it("is hidden while awaiting an answer", () => {
      render(<Harness onSubmit={vi.fn()} suggestion="add a footer" awaitingAnswer />);
      expect(placeholder()).toBe("Answer the question above to continue…");
      expect(screen.queryByText(/Press Tab to accept/)).toBeNull();
    });
  });
});

describe("<ChatInput /> attached workflow", () => {
  beforeEach(() => localStorage.clear());

  /** Attaches the workflow `title` through the Attach menu. */
  async function attach(title: string) {
    fireEvent.click(await openAttachMenu(title));
  }

  const seedWorkflow = (title: string, texts: string[]) =>
    createWorkflow({ title, steps: stepsFromTexts(texts) }, "editor");

  it("says so when there are no workflows", async () => {
    render(<Harness onSubmit={vi.fn()} />);
    await openAttachMenu("Image");
    expect(await screen.findByText("No workflows yet")).toBeTruthy();
  });

  it("lists workflows newest first", async () => {
    seedWorkflow("Older", ["a"]);
    seedWorkflow("Newer", ["a", "b"]);
    render(<Harness onSubmit={vi.fn()} />);
    await openAttachMenu("Image");
    const group = await screen.findByRole("group", { name: "Workflow" });
    const items = within(group).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Newer", "Older"]);
  });

  it("sends the text followed by the workflow block and clears the chip", async () => {
    const workflow = seedWorkflow("Launch", ["Open the app", "Export"]);
    const onSubmit = vi.fn(() => true);
    render(<Harness onSubmit={onSubmit} />);
    await attach("Launch");
    expect(screen.getByTestId("workflow-chip").textContent).toContain("Launch");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  do it  " } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(onSubmit).toHaveBeenCalledWith({
      text: `do it\n\n${workflowToPrompt(workflow)}`,
      images: undefined,
    });
    expect(screen.queryByTestId("workflow-chip")).toBeNull();
  });

  it("sends a workflow without any text and keeps the chip when the send fails", async () => {
    const workflow = seedWorkflow("Launch", ["A"]);
    const onSubmit = vi.fn(() => false);
    render(<Harness onSubmit={onSubmit} />);
    await attach("Launch");
    fireEvent.click(screen.getByLabelText("Send"));
    expect(onSubmit).toHaveBeenCalledWith({ text: workflowToPrompt(workflow), images: undefined });
    expect(screen.getByTestId("workflow-chip")).toBeTruthy();
  });

  it("reads the workflow fresh at send time", async () => {
    const workflow = seedWorkflow("Launch", ["A"]);
    const onSubmit = vi.fn(() => true);
    render(<Harness onSubmit={onSubmit} />);
    await attach("Launch");
    act(() => {
      updateWorkflow(workflow.id, { steps: stepsFromTexts(["A", "B"]) }, "agent");
    });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(onSubmit).toHaveBeenCalledWith({
      text: workflowToPrompt({ id: workflow.id, title: "Launch", steps: stepsFromTexts(["A", "B"]) }),
      images: undefined,
    });
  });

  it("removes the chip with its button and keeps one workflow at a time", async () => {
    seedWorkflow("First", ["a"]);
    seedWorkflow("Second", ["a"]);
    render(<Harness onSubmit={vi.fn()} />);
    await attach("First");
    await attach("Second");
    expect(screen.getAllByTestId("workflow-chip")).toHaveLength(1);
    expect(screen.getByTestId("workflow-chip").textContent).toContain("Second");
    fireEvent.click(screen.getByRole("button", { name: "Remove workflow" }));
    expect(screen.queryByTestId("workflow-chip")).toBeNull();
  });

  it("detaches the attached workflow when it is picked again", async () => {
    seedWorkflow("Launch", ["a"]);
    render(<Harness onSubmit={vi.fn()} />);
    await attach("Launch");
    await attach("Launch");
    expect(screen.queryByTestId("workflow-chip")).toBeNull();
  });

  it("shows one Attach button when a custom footer places it", () => {
    render(
      <ChatInput
        sessionId="test-session"
        input=""
        setInput={() => {}}
        onSubmit={vi.fn()}
        isLoading={false}
        stop={() => {}}
        renderFooter={({ attachMenu }) => <div>{attachMenu}</div>}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Attach" })).toHaveLength(1);
  });

  it("sends without a workflow deleted after it was attached", async () => {
    const workflow = seedWorkflow("Doomed", ["a"]);
    const onSubmit = vi.fn(() => true);
    render(<Harness onSubmit={onSubmit} />);
    await attach("Doomed");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    act(() => deleteWorkflow(workflow.id, "agent"));
    fireEvent.click(screen.getByLabelText("Send"));
    expect(onSubmit).toHaveBeenCalledWith({ text: "hello", images: undefined });
  });
});
