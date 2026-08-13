import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  useLeftSidebarStore,
} from "@/store/leftSidebarStore";

describe("leftSidebarStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useLeftSidebarStore.setState({
      activeSection: "pages",
      isExpanded: false,
      width: LEFT_SIDEBAR_DEFAULT_WIDTH,
    });
  });

  it("defaults to the pages section", () => {
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
  });

  it("updates the active section and persists it", () => {
    useLeftSidebarStore.getState().setActiveSection("agents");
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(localStorage.getItem("left-sidebar-section")).toBe("agents");
  });

  it("updates to the slides section and persists it", () => {
    useLeftSidebarStore.getState().setActiveSection("slides");
    expect(useLeftSidebarStore.getState().activeSection).toBe("slides");
    expect(localStorage.getItem("left-sidebar-section")).toBe("slides");
  });

  it("switches to the variables/textStyles/styles sections", () => {
    useLeftSidebarStore.getState().setActiveSection("variables");
    expect(useLeftSidebarStore.getState().activeSection).toBe("variables");
    useLeftSidebarStore.getState().setActiveSection("textStyles");
    expect(useLeftSidebarStore.getState().activeSection).toBe("textStyles");
    useLeftSidebarStore.getState().setActiveSection("styles");
    expect(useLeftSidebarStore.getState().activeSection).toBe("styles");
  });

  it("toggles the expanded flag and persists it", () => {
    useLeftSidebarStore.setState({ isExpanded: true });
    expect(useLeftSidebarStore.getState().isExpanded).toBe(true);
    useLeftSidebarStore.getState().toggleExpanded();
    expect(useLeftSidebarStore.getState().isExpanded).toBe(false);
    expect(localStorage.getItem("left-sidebar-expanded")).toBe("false");
    useLeftSidebarStore.getState().toggleExpanded();
    expect(useLeftSidebarStore.getState().isExpanded).toBe(true);
  });

  it("defaults to the default width", () => {
    expect(useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH);
  });

  it("updates width in memory without touching storage", () => {
    useLeftSidebarStore.getState().setWidth(400);
    expect(useLeftSidebarStore.getState().width).toBe(400);
    expect(localStorage.getItem("left-sidebar-width")).toBeNull();
  });

  it("persists the current width on demand", () => {
    useLeftSidebarStore.getState().setWidth(400);
    useLeftSidebarStore.getState().persistWidth();
    expect(localStorage.getItem("left-sidebar-width")).toBe("400");
  });

  it("clamps width below the minimum", () => {
    useLeftSidebarStore.getState().setWidth(10);
    expect(useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_MIN_WIDTH);
  });

  it("clamps width above the maximum", () => {
    useLeftSidebarStore.getState().setWidth(9999);
    expect(useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_MAX_WIDTH);
  });

  it("reads a persisted width from localStorage on init, clamped", async () => {
    localStorage.setItem("left-sidebar-width", "50");
    // Initial width is computed once at module load time, so re-import the
    // module fresh to exercise the real init path instead of re-deriving it.
    vi.resetModules();
    const mod = await vi.importActual<typeof import("@/store/leftSidebarStore")>(
      "@/store/leftSidebarStore",
    );
    expect(mod.useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_MIN_WIDTH);
  });

  it("falls back to the default width when nothing is persisted", async () => {
    localStorage.removeItem("left-sidebar-width");
    vi.resetModules();
    const mod = await vi.importActual<typeof import("@/store/leftSidebarStore")>(
      "@/store/leftSidebarStore",
    );
    expect(mod.useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH);
  });

  it("falls back to the default width for an invalid stored value", async () => {
    localStorage.setItem("left-sidebar-width", "not-a-number");
    vi.resetModules();
    const mod = await vi.importActual<typeof import("@/store/leftSidebarStore")>(
      "@/store/leftSidebarStore",
    );
    expect(mod.useLeftSidebarStore.getState().width).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH);
  });
});
