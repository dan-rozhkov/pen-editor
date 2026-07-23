import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, Container } from "pixi.js";
import { Rulers, RULER_SIZE } from "@/components/canvas/Rulers";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useGuidesStore } from "@/store/guidesStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";

const ROOT_WIDTH = 800;
const ROOT_HEIGHT = 600;

interface MockCtx {
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  fillStyleLog: string[];
  textAlignLog: CanvasTextAlign[];
}

let lastCtx: MockCtx | null = null;

function mockCanvasContext(): void {
  const getContextSpy = vi.spyOn(
    HTMLCanvasElement.prototype,
    "getContext",
  ) as unknown as {
    mockImplementation: (implementation: typeof HTMLCanvasElement.prototype.getContext) => void;
  };
  getContextSpy.mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string,
  ): CanvasRenderingContext2D | null {
    if (contextId !== "2d") return null;
    const fillStyleLog: string[] = [];
    const textAlignLog: CanvasTextAlign[] = [];
    let fillStyle = "";
    let textAlign: CanvasTextAlign = "start";
    const ctx = {
      beginPath: vi.fn(),
      fillRect: vi.fn(() => fillStyleLog.push(fillStyle)),
      fillText: vi.fn(() => textAlignLog.push(textAlign)),
      measureText: vi.fn((text: string) => ({ width: text.length * 5 })),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: string) {
        fillStyle = value;
      },
      get textAlign() {
        return textAlign;
      },
      set textAlign(value: CanvasTextAlign) {
        textAlign = value;
      },
    } as unknown as CanvasRenderingContext2D;
    lastCtx = {
      fillRect: ctx.fillRect as unknown as ReturnType<typeof vi.fn>,
      fillText: ctx.fillText as unknown as ReturnType<typeof vi.fn>,
      fillStyleLog,
      textAlignLog,
    };
    return ctx;
  } as typeof HTMLCanvasElement.prototype.getContext);
}

function mockElementSize(): void {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(ROOT_WIDTH);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(ROOT_HEIGHT);
}

/** Register a Pixi canvas so `getPixiCanvasRect()` resolves and draw() runs. */
function registerPixiCanvas(): void {
  const pixiCanvas = document.createElement("canvas");
  act(() => {
    useCanvasRefStore.getState().setPixiRefs({
      app: { canvas: pixiCanvas } as Application,
      overlayContainer: {} as Container,
      sceneRoot: {} as Container,
      selectionContainer: {} as Container,
      viewport: {} as Container,
    });
  });
}

describe("<Rulers />", () => {
  beforeEach(() => {
    resetStores();
    mockCanvasContext();
    mockElementSize();
    useCanvasRefStore.setState({ pixiRefs: null });
    useGuidesStore.setState({ guides: [], showRulers: true });
    useUIThemeStore.setState({ uiTheme: "light" });
    useViewportStore.setState({ x: 0, y: 0, scale: 1 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useCanvasRefStore.setState({ pixiRefs: null });
  });

  it("draws on first Pixi canvas registration when rulers start enabled", async () => {
    const { container } = render(<Rulers />);
    const [topCanvas, leftCanvas] = Array.from(container.querySelectorAll("canvas"));

    expect(topCanvas.width).not.toBe(ROOT_WIDTH - RULER_SIZE);
    expect(leftCanvas.height).not.toBe(ROOT_HEIGHT - RULER_SIZE);

    registerPixiCanvas();

    await waitFor(() => {
      expect(topCanvas.width).toBe(ROOT_WIDTH - RULER_SIZE);
      expect(leftCanvas.height).toBe(ROOT_HEIGHT - RULER_SIZE);
    });
  });

  it("draws no selection-highlight band when the selection is empty", async () => {
    seedScene();
    useSelectionStore.getState().setSelectedIds([]);

    render(<Rulers />);
    registerPixiCanvas();

    await waitFor(() => {
      expect(lastCtx).not.toBeNull();
    });

    // Only the background-clear fillRect per ruler draw — no band on top.
    expect(lastCtx!.fillStyleLog).toEqual(["#ffffff"]);
  });

  it("draws a selection-highlight band and accent edge labels for a selected node", async () => {
    seedScene();
    // rect2 "Floating": x=600, y=100, width=200, height=100 (top-level, so
    // absolute position == local x/y). Union bbox: x in [600, 800], y in [100, 200].
    useSelectionStore.getState().setSelectedIds(["rect2"]);

    render(<Rulers />);
    registerPixiCanvas();

    await waitFor(() => {
      expect(lastCtx).not.toBeNull();
      expect(lastCtx!.fillStyleLog.length).toBeGreaterThan(1);
    });

    // Background clear + the accent band fillRect.
    expect(lastCtx!.fillStyleLog).toContain("#e7f5ff");

    // Accent-colored edge labels are drawn for the rounded bbox edges. The
    // top ruler's edges are 600/800 (x), the left ruler's are 100/200 (y);
    // whichever ruler drew last is captured in `lastCtx`, so assert against
    // whichever pair of numbers actually got the accent fillStyle.
    const fillTextCalls = lastCtx!.fillText.mock.calls as [string, number, number][];
    const accentTexts = new Set(
      fillTextCalls
        .filter((_, i) => {
          // fillStyle at time of each fillText call isn't recorded directly,
          // but the accent labels are the LAST two fillText calls issued
          // (they're drawn after the full muted tick loop).
          return i >= fillTextCalls.length - 2;
        })
        .map(([text]) => text),
    );
    const isTopRuler = accentTexts.has("600") || accentTexts.has("800");
    if (isTopRuler) {
      expect(accentTexts).toEqual(new Set(["600", "800"]));
    } else {
      expect(accentTexts).toEqual(new Set(["100", "200"]));
    }

    // Boundary values are painted once in accent, rather than being drawn a
    // second time on top of the regular ruler label.
    for (const text of accentTexts) {
      expect(fillTextCalls.filter(([value]) => value === text)).toHaveLength(1);
    }
  });

  it("places edge labels on opposite outer sides for a narrow selection", async () => {
    seedScene();
    useSceneStore.getState().updateNode("rect2", { width: 4, height: 4 });
    useSelectionStore.getState().setSelectedIds(["rect2"]);

    render(<Rulers />);
    registerPixiCanvas();

    await waitFor(() => {
      expect(lastCtx).not.toBeNull();
      expect(lastCtx!.fillStyleLog.length).toBeGreaterThan(1);
    });

    // The left ruler draws last. After its -90deg rotation, left/right align
    // extend the min/max labels away from one another along the vertical axis.
    expect(lastCtx!.textAlignLog.slice(-2)).toEqual(["left", "right"]);
  });
});
