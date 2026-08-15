import { describe, it, expect } from "vitest";
import { toolDisplayNames, referoToolDisplayNames } from "../toolDisplayNames";
import { getToolIcon } from "../toolIcons";
import { ReferoIcon } from "@/components/icons/ReferoIcon";

describe("toolIcons", () => {
  it("has a dedicated icon for every named tool", () => {
    const generic = getToolIcon("definitely_not_a_tool");
    const missing = Object.keys(toolDisplayNames).filter(
      (name) => getToolIcon(name) === generic
    );
    expect(missing).toEqual([]);
  });

  it("falls back to a generic icon for an unmapped tool", () => {
    expect(getToolIcon("some_future_tool")).toBeTruthy();
  });

  it("brands every Refero-served tool with the Refero mark", () => {
    const referoTools = Object.keys(referoToolDisplayNames);
    expect(referoTools.length).toBeGreaterThan(0);
    for (const name of referoTools) {
      expect(getToolIcon(name)).toBe(ReferoIcon);
    }
  });

  it("gives every spelling of a Refero tool the same label", () => {
    // Bare, `refero_`-prefixed and `mcp_refero_`-prefixed names are the same
    // tool; they once drifted into three different labels and icons.
    for (const spelling of ["get_style", "refero_get_style", "mcp_refero_get_style"]) {
      expect(toolDisplayNames[spelling]).toBe("Open Design Style");
    }
  });
});
