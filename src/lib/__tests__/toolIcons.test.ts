import { describe, it, expect } from "vitest";
import { toolDisplayNames } from "../toolDisplayNames";
import { getToolIcon } from "../toolIcons";

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
});
