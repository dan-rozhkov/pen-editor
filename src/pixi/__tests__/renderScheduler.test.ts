import { describe, it, expect } from "vitest";
import { requestCanvasRender } from "../renderScheduler";

describe("requestCanvasRender", () => {
  it("is a no-op (does not throw) when no scheduler is installed", () => {
    // Importing renderScheduler initializes Pixi nowhere; calling the public
    // invalidate hook before/without setupRenderScheduler must be safe.
    expect(() => requestCanvasRender()).not.toThrow();
  });
});
