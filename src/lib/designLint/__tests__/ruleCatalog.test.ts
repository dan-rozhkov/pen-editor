import { describe, expect, it } from "vitest";
import { LINT_RULE_CATALOG, LINT_RULE_IDS } from "..";

describe("LINT_RULE_CATALOG", () => {
  it("lists every rule once, in sort order, with a description", () => {
    expect(LINT_RULE_CATALOG.map((r) => r.id)).toEqual([...LINT_RULE_IDS]);
    expect(LINT_RULE_CATALOG.every((r) => r.description.length > 0)).toBe(true);
  });

  it("marks only rules with fixes as auto-fixable", () => {
    const fixable = LINT_RULE_CATALOG.filter((r) => r.autoFix).map((r) => r.id);
    expect(fixable).toContain("contrast");
    expect(fixable).not.toContain("deprecated-component");
    expect(fixable).toContain("hardcoded-value");
  });
});
