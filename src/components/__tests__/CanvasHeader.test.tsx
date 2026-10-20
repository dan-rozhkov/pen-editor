import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useLayers3DStore } from "@/store/layers3dStore";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("../auth/AuthMenu", () => ({
  AuthMenu: () => <div data-testid="auth-menu-shim" />,
}));

import { CanvasHeader } from "../CanvasHeader";

function renderHeader() {
  return render(
    <TooltipProvider>
      <CanvasHeader />
    </TooltipProvider>,
  );
}

describe("<CanvasHeader />", () => {
  beforeEach(() => {
    resetStores();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useDevModeStore.setState({ active: false });
    useLayers3DStore.setState({ active: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("uses the shared 41px header row classes", () => {
    renderHeader();
    const header = screen.getByTestId("canvas-header");
    for (const cls of ["flex", "shrink-0", "items-center", "gap-1", "border-b", "border-border-default", "bg-surface-panel", "px-2", "py-1.5"]) {
      expect(header.classList.contains(cls)).toBe(true);
    }
  });

  it("renders the File trigger, the drawing tools and the account menu in edit mode", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: /File/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Embed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More shapes" })).toBeTruthy();
    expect(screen.getByTestId("auth-menu-shim")).toBeTruthy();
  });

  it("renders no tools in view mode but keeps the File menu", () => {
    useEditorModeStore.setState({ mode: "view" });
    renderHeader();
    expect(screen.getByRole("button", { name: /File/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Embed" })).toBeNull();
  });

  it("renders no tools in dev (inspect) mode or while the 3D view is active", () => {
    useDevModeStore.setState({ active: true });
    const dev = renderHeader();
    expect(screen.queryByRole("button", { name: "Embed" })).toBeNull();
    dev.unmount();

    useDevModeStore.setState({ active: false });
    useLayers3DStore.setState({ active: true });
    renderHeader();
    expect(screen.queryByRole("button", { name: "Embed" })).toBeNull();
  });
});
