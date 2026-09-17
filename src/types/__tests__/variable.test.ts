import { describe, expect, it } from "vitest";
import { getVariableCssName } from "../variable";

describe("getVariableCssName", () => {
  it("returns an already --prefixed name unchanged", () => {
    expect(getVariableCssName({ id: "v1", name: "--brand-500" })).toBe("--brand-500");
  });

  it("trims an already --prefixed name but otherwise leaves it alone", () => {
    expect(getVariableCssName({ id: "v1", name: "  --brand-500  " })).toBe("--brand-500");
  });

  it("slugifies a free-form label like the Variables panel creates", () => {
    expect(getVariableCssName({ id: "v1", name: "Color 1" })).toBe("--color-1");
  });

  it("collapses punctuation and unicode junk into a single dash", () => {
    expect(getVariableCssName({ id: "v1", name: "Brand   Color!! / #2 (main)" })).toBe(
      "--brand-color-2-main",
    );
  });

  it("strips leading and trailing dashes produced by the slugify", () => {
    expect(getVariableCssName({ id: "v1", name: "  ***Accent***  " })).toBe("--accent");
  });

  it("falls back to a stable, id-derived name when nothing survives slugifying", () => {
    expect(getVariableCssName({ id: "var_abc123", name: "🎨🎨🎨" })).toBe("--var-var_abc123");
  });

  it("falls back to a stable, id-derived name for an empty/whitespace-only name", () => {
    expect(getVariableCssName({ id: "var_xyz", name: "   " })).toBe("--var-var_xyz");
  });

  it("is deterministic for the same variable across calls", () => {
    const variable = { id: "v1", name: "Number 2" };
    expect(getVariableCssName(variable)).toBe(getVariableCssName(variable));
  });
});
