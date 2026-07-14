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

// Slide isolation (hiding every other top-level container while presenting)
// is NOT PresentController's responsibility — it's owned by the declarative
// resync path (syncNodeTree's applyTextEditingVisibility, driven by
// pixiSync's useEditorModeStore subscription). See
// src/pixi/__tests__/presentIsolation.test.ts for that coverage, including
// enter/next/prev/exit and a user-hidden root node.

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

  it("fits the active frame to width when entering present mode", () => {
    const fit = vi.spyOn(useViewportStore.getState(), "fitToWidth");
    render(<PresentController />);
    act(() => {
      useEditorModeStore.setState({ mode: "present", presentFrameIds: ["F"], presentIndex: 0 });
    });
    expect(fit).toHaveBeenCalled();
    const callArg = fit.mock.calls[0][0] as { id: string }[];
    expect(callArg.map((n) => n.id)).toEqual(["F"]);
  });

  it("does not fit while in edit mode", () => {
    const fit = vi.spyOn(useViewportStore.getState(), "fitToWidth");
    fit.mockClear();
    render(<PresentController />);
    expect(fit).not.toHaveBeenCalled();
  });

  it("does not call fitToContent (that's used elsewhere and must not change)", () => {
    const fit = vi.spyOn(useViewportStore.getState(), "fitToContent");
    render(<PresentController />);
    act(() => {
      useEditorModeStore.setState({ mode: "present", presentFrameIds: ["F"], presentIndex: 0 });
    });
    expect(fit).not.toHaveBeenCalled();
  });

  it("refits (resetting scroll) on presentIndex change", () => {
    useSceneStore.setState({
      nodesById: {
        F: { id: "F", type: "frame", x: 0, y: 0, width: 100, height: 100, children: [] },
        G: { id: "G", type: "frame", x: 0, y: 0, width: 100, height: 100, children: [] },
      } as never,
      parentById: {},
      childrenById: { F: [], G: [] },
      rootIds: ["F", "G"],
    });
    const fit = vi.spyOn(useViewportStore.getState(), "fitToWidth");
    render(<PresentController />);
    act(() => {
      useEditorModeStore.setState({ mode: "present", presentFrameIds: ["F", "G"], presentIndex: 0 });
    });
    fit.mockClear();
    act(() => {
      useEditorModeStore.setState({ presentIndex: 1 });
    });
    expect(fit).toHaveBeenCalled();
    const callArg = fit.mock.calls[0][0] as { id: string }[];
    expect(callArg.map((n) => n.id)).toEqual(["G"]);
  });
});
