import { describe, expect, it } from "vitest";
import { createHolds } from "../bubbleRules";

describe("createHolds", () => {
  it("opening a popup (button or Mod-K share one handler) holds the bubble until it closes", () => {
    const holds = createHolds();
    let linkOpen = false;
    const changeLink = holds.handler("link", (open) => (linkOpen = open));
    expect(holds.any()).toBe(false);
    changeLink(true);
    expect(linkOpen).toBe(true);
    expect(holds.any()).toBe(true);
    changeLink(false);
    expect(linkOpen).toBe(false);
    expect(holds.any()).toBe(false);
  });

  it("keeps the hold while any other popup is still open", () => {
    const holds = createHolds();
    holds.handler("link")(true);
    holds.handler("color")(true);
    holds.handler("link")(false);
    expect(holds.any()).toBe(true);
    holds.handler("color")(false);
    expect(holds.any()).toBe(false);
  });
});
