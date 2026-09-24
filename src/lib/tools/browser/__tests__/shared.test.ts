import { describe, expect, it } from "vitest";
import { filterElementsForBackend } from "../shared";

describe("filterElementsForBackend", () => {
  it("keeps elements with a non-empty ops array", () => {
    const elements = [
      { index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] },
      { index: 1, tag: "input", label: "Search", ops: ["TYPE_TEXT"] },
    ];
    expect(filterElementsForBackend(elements)).toEqual(elements);
  });

  it("drops scroll-container entries with an empty ops array", () => {
    const clickable = { index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] };
    const scrollContainer = {
      index: 1,
      tag: "div",
      label: "Comments list",
      ops: [],
      scrollable: true,
    };
    expect(filterElementsForBackend([clickable, scrollContainer])).toEqual([clickable]);
  });

  it("drops entries where ops is missing entirely", () => {
    const clickable = { index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] };
    const noOpsField = { index: 1, tag: "div", label: "Sidebar", scrollable: true };
    expect(filterElementsForBackend([clickable, noOpsField])).toEqual([clickable]);
  });

  it("preserves each surviving element's original index field", () => {
    const elements = [
      { index: 5, tag: "button", label: "Save", ops: ["CLICK"] },
      { index: 6, tag: "div", label: "List", ops: [], scrollable: true },
      { index: 7, tag: "select", label: "Country", ops: ["SELECT"] },
    ];
    expect(filterElementsForBackend(elements)).toEqual([
      { index: 5, tag: "button", label: "Save", ops: ["CLICK"] },
      { index: 7, tag: "select", label: "Country", ops: ["SELECT"] },
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(filterElementsForBackend([])).toEqual([]);
  });

  it("keeps non-object entries defensively rather than dropping unknown shapes", () => {
    const weird = ["a string element", 42, null];
    expect(filterElementsForBackend(weird)).toEqual(weird);
  });
});
