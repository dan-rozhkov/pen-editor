import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSurfaceStore } from "../surfaceStore";

describe("surfaceStore", () => {
  beforeEach(() => {
    useSurfaceStore.setState({ activeSurfaceId: "canvas" });
  });

  it("starts on the canvas", () => {
    expect(useSurfaceStore.getState().activeSurfaceId).toBe("canvas");
  });

  it("switches to the browser and back", () => {
    useSurfaceStore.getState().setActiveSurface("browser");
    expect(useSurfaceStore.getState().activeSurfaceId).toBe("browser");
    useSurfaceStore.getState().setActiveSurface("canvas");
    expect(useSurfaceStore.getState().activeSurfaceId).toBe("canvas");
  });

  describe("in the desktop shell", () => {
    afterEach(() => {
      delete window.penDesktop;
    });

    it("selects the canvas when the browser surface is requested", () => {
      window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
      useSurfaceStore.getState().setActiveSurface("browser");
      expect(useSurfaceStore.getState().activeSurfaceId).toBe("canvas");
    });
  });
});
