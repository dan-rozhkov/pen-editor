import { describe, it, expect } from "vitest";
import { globToRegExp } from "../scope";

describe("globToRegExp escapes", () => {
  it("treats a backslash-escaped * or ? as a literal", () => {
    expect(globToRegExp("*a\\*b*").test("xa*bx")).toBe(true);
    expect(globToRegExp("*a\\*b*").test("xaZZbx")).toBe(false);
    expect(globToRegExp("a\\?").test("a?")).toBe(true);
    expect(globToRegExp("a\\?").test("ab")).toBe(false);
  });
});
