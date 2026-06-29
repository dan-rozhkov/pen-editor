import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { PresentController } from "@/components/PresentController";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<PresentController />", () => {
  beforeEach(() => {
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSceneStore.setState({
      nodesById: { F: { id: "F", type: "frame", x: 0, y: 0, width: 100, height: 100, children: [] } } as never,
      parentById: {},
      childrenById: { F: [] },
      rootIds: ["F"],
    });
  });

  it("fits the active frame when entering present mode", () => {
    const fit = vi.spyOn(useViewportStore.getState(), "fitToContent");
    render(<PresentController />);
    act(() => {
      useEditorModeStore.setState({ mode: "present", presentFrameIds: ["F"], presentIndex: 0 });
    });
    expect(fit).toHaveBeenCalled();
    const callArg = fit.mock.calls[0][0] as { id: string }[];
    expect(callArg.map((n) => n.id)).toEqual(["F"]);
  });

  it("does not fit while in edit mode", () => {
    const fit = vi.spyOn(useViewportStore.getState(), "fitToContent");
    fit.mockClear();
    render(<PresentController />);
    expect(fit).not.toHaveBeenCalled();
  });
});
