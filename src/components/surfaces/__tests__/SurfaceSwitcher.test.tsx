import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SurfaceSwitcher } from "../SurfaceSwitcher";
import { useSurfaceStore } from "@/store/surfaceStore";
import { SURFACE_METAS } from "@/surfaces/meta";

beforeEach(() => {
  useSurfaceStore.setState({ activeSurfaceId: "canvas" });
});

afterEach(() => {
  cleanup();
  delete window.penDesktop;
});

describe("<SurfaceSwitcher />", () => {
  it("offers one tab per surface", () => {
    render(<SurfaceSwitcher />);
    for (const surface of SURFACE_METAS) {
      expect(screen.getByTestId(`surface-tab-${surface.id}`).textContent).toBe(surface.title);
    }
  });

  it("marks the active surface and switches on click", () => {
    render(<SurfaceSwitcher />);
    expect(screen.getByTestId("surface-tab-canvas").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("surface-tab-browser"));
    expect(useSurfaceStore.getState().activeSurfaceId).toBe("browser");
    expect(screen.getByTestId("surface-tab-browser").getAttribute("aria-selected")).toBe("true");
  });

  it("is not rendered in the desktop shell, where the browser surface is unavailable", () => {
    window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
    const { container } = render(<SurfaceSwitcher />);
    expect(container.firstChild).toBeNull();
  });
});
