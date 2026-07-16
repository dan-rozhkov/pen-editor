import { beforeEach, describe, expect, it } from "vitest";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useCommentsStore } from "@/store/commentsStore";

beforeEach(() => {
  useDrawModeStore.setState({ activeTool: null });
  useCommentsStore.setState({ threads: [], draftAnchor: null, pinsHidden: false });
});

describe("drawModeStore — comment mode transitions cancel the pin draft", () => {
  it("switching away from comment mode via setActiveTool cancels the draft", () => {
    useDrawModeStore.getState().setActiveTool("comment");
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 1, y: 2 });

    useDrawModeStore.getState().setActiveTool("rect");
    expect(useCommentsStore.getState().draftAnchor).toBeNull();
  });

  it("keeps the draft when entering/staying in comment mode", () => {
    useDrawModeStore.getState().setActiveTool("comment");
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 1, y: 2 });
    // Re-selecting comment mode should not wipe the in-progress draft.
    useDrawModeStore.getState().setActiveTool("comment");
    expect(useCommentsStore.getState().draftAnchor).not.toBeNull();
  });

  it("toggling comment mode off cancels the draft", () => {
    useDrawModeStore.getState().toggleTool("comment");
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 1, y: 2 });
    useDrawModeStore.getState().toggleTool("comment");
    expect(useDrawModeStore.getState().activeTool).toBeNull();
    expect(useCommentsStore.getState().draftAnchor).toBeNull();
  });

  it("cancelDrawing cancels the draft and exits the tool", () => {
    useDrawModeStore.getState().setActiveTool("comment");
    useCommentsStore.getState().startDraft({ kind: "canvas", x: 1, y: 2 });
    useDrawModeStore.getState().cancelDrawing();
    expect(useDrawModeStore.getState().activeTool).toBeNull();
    expect(useCommentsStore.getState().draftAnchor).toBeNull();
  });
});
