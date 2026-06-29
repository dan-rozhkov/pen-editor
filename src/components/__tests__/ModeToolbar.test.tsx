import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ModeToolbar } from "@/components/ModeToolbar";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";

afterEach(() => cleanup());

describe("<ModeToolbar />", () => {
  beforeEach(() => {
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSceneStore.setState({
      nodesById: { F: { id: "F", type: "frame", x: 0, y: 0, width: 10, height: 10, children: [] } } as never,
      parentById: {},
      childrenById: { F: [] },
      rootIds: ["F"],
    });
  });

  it("enters view mode when the view toggle is clicked", () => {
    render(<ModeToolbar />);
    fireEvent.click(screen.getByTestId("mode-view-toggle"));
    expect(useEditorModeStore.getState().mode).toBe("view");
  });

  it("returns to edit when the active view toggle is clicked again", () => {
    useEditorModeStore.setState({ mode: "view" });
    render(<ModeToolbar />);
    fireEvent.click(screen.getByTestId("mode-view-toggle"));
    expect(useEditorModeStore.getState().mode).toBe("edit");
  });

  it("starts present mode when the present button is clicked", () => {
    render(<ModeToolbar />);
    fireEvent.click(screen.getByTestId("mode-present"));
    expect(useEditorModeStore.getState().mode).toBe("present");
  });

  it("disables present when there are no frames", () => {
    useSceneStore.setState({ nodesById: {} as never, parentById: {}, childrenById: {}, rootIds: [] });
    render(<ModeToolbar />);
    expect((screen.getByTestId("mode-present") as HTMLButtonElement).disabled).toBe(true);
  });
});
