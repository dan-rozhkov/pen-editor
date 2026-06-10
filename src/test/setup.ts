// Global test setup (runs before every test file).
//
// happy-dom does not implement the canvas 2D API, but the scene store's text
// measurement (src/utils/textMeasure.ts) relies on ctx.measureText. Stub a
// deterministic context so text nodes can be created/updated in tests without
// initializing PixiJS or a real canvas.

const FAKE_CHAR_WIDTH = 8;

function createFake2dContext(): CanvasRenderingContext2D {
  const ctx = {
    font: "",
    measureText: (text: string) => ({ width: text.length * FAKE_CHAR_WIDTH }),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;

HTMLCanvasElement.prototype.getContext = function (
  this: HTMLCanvasElement,
  contextId: string,
  ...args: unknown[]
) {
  if (contextId === "2d") {
    return createFake2dContext();
  }
  return originalGetContext
    ? (originalGetContext as (this: HTMLCanvasElement, id: string, ...rest: unknown[]) => unknown).call(this, contextId, ...args)
    : null;
} as typeof HTMLCanvasElement.prototype.getContext;

// React 19 + @testing-library/react act() support.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
