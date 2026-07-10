import { beforeEach, describe, expect, it } from "vitest";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

describe("leftSidebarStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useLeftSidebarStore.setState({ activeSection: "pages", isExpanded: false });
  });

  it("defaults to the pages section", () => {
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
  });

  it("updates the active section and persists it", () => {
    useLeftSidebarStore.getState().setActiveSection("agents");
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(localStorage.getItem("left-sidebar-section")).toBe("agents");
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
});
