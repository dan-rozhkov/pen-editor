import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SurfaceViewHost } from "../views";

afterEach(cleanup);

describe("SurfaceViewHost", () => {
  it("renders nothing for the canvas, which is always mounted behind the UI", () => {
    const { container } = render(<SurfaceViewHost id="canvas" />);
    expect(container.firstChild).toBeNull();
  });

  it("lazy-loads the browser View", async () => {
    render(<SurfaceViewHost id="browser" />);
    expect(await screen.findByTestId("browser-surface-view", {}, { timeout: 5000 })).toBeTruthy();
  });
});
