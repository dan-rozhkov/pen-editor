import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PageControls } from "@/components/PageControls";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";

afterEach(() => cleanup());

describe("<PageControls /> Play button", () => {
  beforeEach(() => {
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSceneStore.setState({
      nodesById: { F: { id: "F", type: "frame", x: 0, y: 0, width: 10, height: 10, children: [] } } as never,
      parentById: {},
      childrenById: { F: [] },
      rootIds: ["F"],
    });
  });

  it("enters present mode when Play is clicked", () => {
    render(<PageControls />);
    const play = screen.getByTestId("page-present");
    expect(play.textContent).toContain("Play");
    fireEvent.click(play);
    expect(useEditorModeStore.getState().mode).toBe("present");
  });

  it("disables Play when there are no frames", () => {
    useSceneStore.setState({ nodesById: {} as never, parentById: {}, childrenById: {}, rootIds: [] });
    render(<PageControls />);
    expect((screen.getByTestId("page-present") as HTMLButtonElement).disabled).toBe(true);
  });
});
