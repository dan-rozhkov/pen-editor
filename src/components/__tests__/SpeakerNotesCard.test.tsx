import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SpeakerNotesCard } from "../SpeakerNotesCard";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import { resetStores, seedScene } from "@/test/fixtures";
import { ReadOnlyProvider } from "../ReadOnlyProvider";
import type { FlatFrameNode } from "@/types/scene";

function pastLen() {
  return useHistoryStore.getState().past.length;
}

describe("SpeakerNotesCard", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    useLeftSidebarStore.setState({ activeSection: "slides" });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when the Slides section isn't active", () => {
    useLeftSidebarStore.setState({ activeSection: "pages" });
    useSelectionStore.getState().select("frame1");
    const { container } = render(<SpeakerNotesCard />);
    expect(container.innerHTML).toBe("");
  });

  it("shows a 'select a slide' hint when nothing is selected", () => {
    render(<SpeakerNotesCard />);
    expect(screen.getByText(/select a slide/i)).toBeTruthy();
    expect(screen.queryByTestId("speaker-notes-textarea")).toBeNull();
  });

  it("shows the selected slide's speaker notes in a textarea", () => {
    useSceneStore.getState().setSpeakerNotes("frame1", "Opening remarks");
    useSelectionStore.getState().select("frame1");
    render(<SpeakerNotesCard />);
    const textarea = screen.getByTestId("speaker-notes-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Opening remarks");
  });

  it("resolves the active slide as the top-level ancestor of the selection", () => {
    // rect1 is a child of frame1 in the seeded scene.
    useSceneStore.getState().setSpeakerNotes("frame1", "Notes for frame1");
    useSelectionStore.getState().select("rect1");
    render(<SpeakerNotesCard />);
    const textarea = screen.getByTestId("speaker-notes-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Notes for frame1");
  });

  it("typing writes to the scene and collapses into a single history entry", () => {
    useSelectionStore.getState().select("frame1");
    render(<SpeakerNotesCard />);
    const textarea = screen.getByTestId("speaker-notes-textarea");
    const before = pastLen();

    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: "H" } });
    fireEvent.change(textarea, { target: { value: "He" } });
    fireEvent.change(textarea, { target: { value: "Hel" } });
    fireEvent.blur(textarea);

    const frame1 = useSceneStore.getState().nodesById.frame1 as FlatFrameNode;
    expect(frame1.speakerNotes).toBe("Hel");
    expect(pastLen()).toBe(before + 1);
  });

  it("focusing without typing does not touch history or clear the redo stack", () => {
    useSelectionStore.getState().select("frame1");
    render(<SpeakerNotesCard />);
    // Simulate a pending redo entry (as if the user had just undone something).
    useHistoryStore.setState({ future: [{} as never] });
    const before = pastLen();

    const textarea = screen.getByTestId("speaker-notes-textarea");
    fireEvent.focus(textarea);
    fireEvent.blur(textarea);

    // Merely focusing must not snapshot (which would wipe redo).
    expect(pastLen()).toBe(before);
    expect(useHistoryStore.getState().future.length).toBe(1);
  });

  it("is disabled in read-only mode", () => {
    useSelectionStore.getState().select("frame1");
    render(
      <ReadOnlyProvider value={true}>
        <SpeakerNotesCard />
      </ReadOnlyProvider>,
    );
    const textarea = screen.getByTestId("speaker-notes-textarea") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });
});
