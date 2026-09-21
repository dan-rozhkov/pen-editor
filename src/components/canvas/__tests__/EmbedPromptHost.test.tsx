import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { EmbedPromptHost } from "../EmbedPromptHost";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

const mockLaunch = vi.fn();
vi.mock("@/lib/launchEmbedAgentChat", () => ({
  launchEmbedAgentChat: (...args: unknown[]) => mockLaunch(...args),
}));

function seedEmptyEmbed(overrides: Partial<FlatSceneNode> = {}): void {
  useSceneStore.setState({
    nodesById: {
      e1: {
        id: "e1", type: "embed", name: "Code", x: 0, y: 0,
        width: 320, height: 200, htmlContent: "",
        ...overrides,
      } as unknown as FlatSceneNode,
    },
    parentById: { e1: null },
    childrenById: {},
    rootIds: ["e1"],

    _cachedTree: null,
  });
}

beforeEach(() => {
  resetStores();
  seedEmptyEmbed();
  mockLaunch.mockReset();
  // Default to a successful launch so tests that don't care about the
  // pending/resolution behaviour don't trip a post-test `setSending(false)`
  // state update (an act() warning, not a failure) — the false-resolution
  // case gets its own explicit mock below.
  mockLaunch.mockResolvedValue(true);
  useEditorModeStore.setState({ mode: "edit" });
  useDevModeStore.setState({ active: false });
});
afterEach(() => {
  cleanup();
  useEditorModeStore.setState({ mode: "edit" });
  useDevModeStore.setState({ active: false });
});

describe("<EmbedPromptHost />", () => {
  it("renders a textarea and a disabled Send button while blank", () => {
    render(<EmbedPromptHost nodeId="e1" />);
    expect(screen.getByPlaceholderText("Ask the design agent...")).not.toBeNull();
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Send once text is typed, and launches an embed agent chat on click", () => {
    render(<EmbedPromptHost nodeId="e1" />);
    const textarea = screen.getByPlaceholderText("Ask the design agent...");
    fireEvent.change(textarea, { target: { value: "make a login screen" } });
    const send = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(send.disabled).toBe(false);

    fireEvent.click(send);
    expect(mockLaunch).toHaveBeenCalledWith("e1", "make a login screen");
    // The composer body is replaced by a pending "Working…" hint right after
    // a successful launch (see the double-submit/pending-state tests below),
    // so the textarea itself unmounts — there's no lingering value to clear.
    expect(screen.getByText("Working…")).not.toBeNull();
    expect(screen.queryByPlaceholderText("Ask the design agent...")).toBeNull();
  });

  it("does not launch on whitespace-only input", () => {
    render(<EmbedPromptHost nodeId="e1" />);
    const textarea = screen.getByPlaceholderText("Ask the design agent...");
    fireEvent.change(textarea, { target: { value: "   " } });
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Send"));
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("submits on Enter", () => {
    render(<EmbedPromptHost nodeId="e1" />);
    const textarea = screen.getByPlaceholderText("Ask the design agent...");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mockLaunch).toHaveBeenCalledWith("e1", "hello");
  });

  it("does not submit on Shift+Enter (inserts a newline instead)", () => {
    render(<EmbedPromptHost nodeId="e1" />);
    const textarea = screen.getByPlaceholderText("Ask the design agent...");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("selects this node on pointerdown, so the layer reads as selected while typing", () => {
    useSelectionStore.getState().select("someone-else");
    render(<EmbedPromptHost nodeId="e1" />);
    fireEvent.pointerDown(screen.getByPlaceholderText("Ask the design agent..."));
    expect(useSelectionStore.getState().selectedIds).toEqual(["e1"]);
  });

  it("selects this node when the textarea takes focus (keyboard entry)", () => {
    useSelectionStore.getState().select("someone-else");
    render(<EmbedPromptHost nodeId="e1" />);
    fireEvent.focus(screen.getByPlaceholderText("Ask the design agent..."));
    expect(useSelectionStore.getState().selectedIds).toEqual(["e1"]);
  });

  it("re-asserts the selection at submit if it moved away while typing", () => {
    render(<EmbedPromptHost nodeId="e1" />);
    const textarea = screen.getByPlaceholderText("Ask the design agent...");
    fireEvent.pointerDown(textarea);
    fireEvent.change(textarea, { target: { value: "make a login screen" } });
    // Something else takes the selection between typing and sending.
    useSelectionStore.getState().select("someone-else");
    fireEvent.click(screen.getByLabelText("Send"));
    expect(useSelectionStore.getState().selectedIds).toEqual(["e1"]);
  });

  it("selects this node before launching, so the chat is scoped to it", () => {
    render(<EmbedPromptHost nodeId="e1" />);
    const textarea = screen.getByPlaceholderText("Ask the design agent...");
    fireEvent.change(textarea, { target: { value: "make a login screen" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(useSelectionStore.getState().selectedIds).toEqual(["e1"]);
  });

  it("outlines the empty embed with a dashed border", () => {
    const { container } = render(<EmbedPromptHost nodeId="e1" />);
    const host = container.querySelector("[data-embed-outline]");
    expect(host).not.toBeNull();
    expect(host?.className).toContain("border-dashed");
  });

  it("keeps the outline for a node too small to hold the composer", () => {
    seedEmptyEmbed({ width: 90, height: 40 } as Partial<FlatSceneNode>);
    const { container } = render(<EmbedPromptHost nodeId="e1" />);
    // The composer is withheld here — the outline is the ONLY thing marking
    // the node, which is exactly why it must not be gated on the composer.
    expect(screen.queryByPlaceholderText("Ask the design agent...")).toBeNull();
    expect(container.querySelector("[data-embed-outline]")).not.toBeNull();
  });

  it("keeps the outline on a read-only canvas", () => {
    useEditorModeStore.setState({ mode: "view" });
    const { container } = render(<EmbedPromptHost nodeId="e1" />);
    expect(container.querySelector("[data-embed-outline]")).not.toBeNull();
  });

  it("drops the outline in present mode", () => {
    useEditorModeStore.setState({ mode: "present" });
    const { container } = render(<EmbedPromptHost nodeId="e1" />);
    expect(container.querySelector("[data-embed-outline]")).toBeNull();
  });

  it("withholds the composer in a non-editable editor mode", () => {
    useEditorModeStore.setState({ mode: "view" });
    render(<EmbedPromptHost nodeId="e1" />);
    expect(screen.queryByPlaceholderText("Ask the design agent...")).toBeNull();
  });

  it("withholds the composer in present mode", () => {
    useEditorModeStore.setState({ mode: "present" });
    render(<EmbedPromptHost nodeId="e1" />);
    expect(screen.queryByPlaceholderText("Ask the design agent...")).toBeNull();
  });

  it("withholds the composer in Dev Mode", () => {
    useDevModeStore.setState({ active: true });
    render(<EmbedPromptHost nodeId="e1" />);
    expect(screen.queryByPlaceholderText("Ask the design agent...")).toBeNull();
  });

  it("withholds the composer for an undersized node", () => {
    seedEmptyEmbed({ width: 120, height: 40 });
    render(<EmbedPromptHost nodeId="e1" />);
    expect(screen.queryByPlaceholderText("Ask the design agent...")).toBeNull();
  });

  it("does not launch a second chat while a launch is pending (double-submit)", () => {
    mockLaunch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<EmbedPromptHost nodeId="e1" />);
    const textarea = screen.getByPlaceholderText("Ask the design agent...");
    fireEvent.change(textarea, { target: { value: "make a login screen" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(mockLaunch).toHaveBeenCalledTimes(1);

    // The composer is replaced by a pending hint, so there's no Send button
    // left to click a second time — but assert the underlying guard too by
    // confirming the textarea (and any way back to it) is gone.
    expect(screen.queryByPlaceholderText("Ask the design agent...")).toBeNull();
    expect(screen.getByText("Working…")).not.toBeNull();
  });

  it("re-enables the composer when the launch resolves false", async () => {
    mockLaunch.mockResolvedValue(false);
    render(<EmbedPromptHost nodeId="e1" />);
    const textarea = screen.getByPlaceholderText("Ask the design agent...");
    fireEvent.change(textarea, { target: { value: "make a login screen" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(screen.getByText("Working…")).not.toBeNull();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ask the design agent...")).not.toBeNull();
    });
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
  });
});
