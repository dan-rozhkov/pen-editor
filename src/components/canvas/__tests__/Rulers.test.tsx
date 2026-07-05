import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, Container } from "pixi.js";
import { Rulers, RULER_SIZE } from "@/components/canvas/Rulers";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useGuidesStore } from "@/store/guidesStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { useViewportStore } from "@/store/viewportStore";

const ROOT_WIDTH = 800;
const ROOT_HEIGHT = 600;

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
    return {
      beginPath: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext);
}

function mockElementSize(): void {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(ROOT_WIDTH);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(ROOT_HEIGHT);
}

describe("<Rulers />", () => {
  beforeEach(() => {
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

    await waitFor(() => {
      expect(topCanvas.width).toBe(ROOT_WIDTH - RULER_SIZE);
      expect(leftCanvas.height).toBe(ROOT_HEIGHT - RULER_SIZE);
    });
  });
});
