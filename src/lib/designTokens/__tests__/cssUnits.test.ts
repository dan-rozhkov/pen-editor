import { describe, it, expect } from "vitest";
import type { Variable } from "@/types/variable";
import { finalizeVariables } from "@/lib/variables";
import { toCss } from "../toCss";
import { toTailwindTheme } from "../toTailwindTheme";

const num = (id: string, name: string, value: string, scopes?: Variable["scopes"]): Variable => ({
  id, name, type: "number", collectionId: "theme", valuesByMode: { light: value, dark: value }, value, scopes,
});

const variables = finalizeVariables([
  num("r", "radius-md", "8", ["radius"]),
  num("s", "space-0", "0", ["spacing"]),
  num("f", "text-lg", "18", ["fontSize"]),
  num("o", "opacity-half", "0.5", ["opacity"]),
  num("w", "weight-bold", "700", ["fontWeight"]),
  num("u", "unscoped", "3"),
  num("a", "radius-alias", "8", ["radius"]),
]);

describe("length-scoped numbers carry px in CSS exports", () => {
  it("tokens.css: px for length scopes, unitless for opacity, weight and unscoped, bare 0", () => {
    const { css } = toCss({ variables });
    expect(css).toContain("--radius-md: 8px;");
    expect(css).toContain("--space-0: 0;");
    expect(css).toContain("--text-lg: 18px;");
    expect(css).toContain("--opacity-half: 0.5;");
    expect(css).toContain("--weight-bold: 700;");
    expect(css).toContain("--unscoped: 3;");
  });

  it("Tailwind: px in the radius, spacing and text namespaces", () => {
    const { css } = toTailwindTheme({ variables });
    expect(css).toContain("--radius-radius-md: 8px;");
    expect(css).toContain("--text-text-lg: 18px;");
    expect(css).toContain("--opacity-half: 0.5;");
    expect(css).not.toMatch(/--spacing-space-0: 0px/);
  });
});
