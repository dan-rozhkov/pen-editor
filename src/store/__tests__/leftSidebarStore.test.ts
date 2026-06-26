import { beforeEach, describe, expect, it } from "vitest";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

describe("leftSidebarStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useLeftSidebarStore.setState({ activeSection: "pages" });
  });

  it("defaults to the pages section", () => {
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
  });

  it("updates the active section and persists it", () => {
    useLeftSidebarStore.getState().setActiveSection("agents");
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(localStorage.getItem("left-sidebar-section")).toBe("agents");
  });
});
