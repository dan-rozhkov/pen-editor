import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_NAME_PATTERN_LENGTH,
  clearNamePatternCacheForTests,
  compileNamePattern,
} from "@/lib/tools/namePattern";
import { assertErr, assertOk } from "@/test/assertions";

beforeEach(clearNamePatternCacheForTests);

describe("compileNamePattern", () => {
  // Tuned to false-negative: this code is shared with the chat agent, and
  // wrongly rejecting an ordinary search is a worse everyday outcome than
  // missing an exotic hang.
  it("accepts the ordinary layer-name searches an agent actually sends", () => {
    for (const pattern of [
      "^Button",
      "Card \\d+",
      "icon-.*",
      "(Primary|Secondary) button",
      "^Screen \\d+$",
      "nav.*item",
      "[A-Z][a-z]+",
      "a+",
      "(abc)+",
      "(a|b)*",
    ]) {
      expect(compileNamePattern(pattern).ok, pattern).toBe(true);
    }
  });

  it("refuses a quantifier applied to a group that already repeats", () => {
    for (const pattern of ["(a+)+$", "(a*)*", "(\\d+)+", "(a+){2,}", "^(x+)+y"]) {
      const result = compileNamePattern(pattern);
      assertErr(result, pattern);
      expect(result.error, pattern).toMatch(/nests a quantifier/);
    }
  });

  it("refuses a pattern longer than the cap", () => {
    const result = compileNamePattern("a".repeat(MAX_NAME_PATTERN_LENGTH + 1));

    assertErr(result);
    expect(result.error).toMatch(/longer than/);
  });

  // A syntactically invalid regex used to throw out of the search loop.
  it("reports an invalid regex instead of throwing", () => {
    const result = compileNamePattern("(unclosed");

    assertErr(result);
    expect(result.error).toMatch(/Invalid search pattern/);
  });

  it("matches case-insensitively, as the search always has", () => {
    const result = compileNamePattern("^button");

    assertOk(result);
    expect(result.regex.test("Button 1")).toBe(true);
  });

  it("returns the same compiled result for a repeated pattern", () => {
    const first = compileNamePattern("^Card");
    const second = compileNamePattern("^Card");

    expect(second).toBe(first);
  });
});
