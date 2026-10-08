import { describe, it, expect } from "vitest";
import { convertDesignTokens } from "../designTokensToVariables";

const shadcnLight = {
  background: "hsl(0 0% 100%)",
  foreground: "#0a0a0a",
  "primary.DEFAULT": "#171717",
  "primary.foreground": "#fafafa",
  muted: "#f5f5f5",
  border: "#e5e5e5",
  "primary.500": "#3b82f6",
  weird: "var(--nope)",
};

function names(c: ReturnType<typeof convertDesignTokens>, collection: string): string[] {
  return c.args.variables.filter((v) => v.collection === collection).map((v) => v.name);
}

describe("convertDesignTokens", () => {
  it("shadcn light + dark: one Primitives mode, -dark primitives, Theme aliases", () => {
    const c = convertDesignTokens({
      colors: shadcnLight,
      dark: { colors: { background: "#0a0a0a", "primary.DEFAULT": "#fafafa", muted: "#f5f5f5", "dark.only": "#111111" } },
    });
    expect(c.hasDark).toBe(true);
    expect(c.args.collections.Primitives.modes).toEqual(["Default"]);
    const get = (n: string) => c.args.variables.find((v) => v.name === n);
    expect(get("--color-background")).toMatchObject({ value: "#ffffff" });
    expect(get("--color-background-dark")).toMatchObject({ value: "#0a0a0a", collection: "Primitives" });
    expect(get("--color-primary-dark")?.value).toBe("#fafafa");
    // equal dark value: no extra primitive
    expect(get("--color-muted-dark")).toBeUndefined();
    // dark-only: the base primitive holds the dark value
    expect(get("--color-dark-only")?.value).toBe("#111111");
    expect(get("--color-primary-500")).toBeDefined();
    expect(names(c, "Theme").sort()).toEqual(
      ["--background", "--border", "--foreground", "--muted", "--primary", "--primary-foreground"],
    );
    expect(get("--background")?.valuesByMode).toEqual({ Light: "$--color-background", Dark: "$--color-background-dark" });
    expect(get("--muted")?.valuesByMode).toEqual({ Light: "$--color-muted", Dark: "$--color-muted" });
    expect(get("--border")?.valuesByMode).toEqual({ Light: "$--color-border", Dark: "$--color-border" });
    expect(c.notes.some((n) => n.includes("colors.weird") && n.includes("not a literal color"))).toBe(true);
    expect(c.notes.some((n) => n.includes("dark.only") && n.includes("only defined for dark"))).toBe(true);
    expect(c.notes.some((n) => n.includes("switch") || n.includes("Dark look"))).toBe(false);
    expect(c.counts.themeAliases).toBe(6);
  });

  it("Tailwind v4 without dark: one mode, units converted, shadows noted", () => {
    const c = convertDesignTokens({
      colors: { "brand.500": "#3366ff", primary: "rgb(1, 2, 3)" },
      spacing: { "4": "1rem", "px": "1px", half: "0.5rem", rel: "50%", em: "1.5em" },
      borderRadius: { lg: "0.5rem", full: "9999px" },
      fontFamily: { sans: "Inter, sans-serif" },
      boxShadow: { sm: "0 1px 2px #0003" },
    });
    expect(c.hasDark).toBe(false);
    expect(c.args.collections.Primitives.modes).toEqual(["Default"]);
    const get = (n: string) => c.args.variables.find((v) => v.name === n);
    expect(get("--color-brand-500")).toMatchObject({ type: "color", value: "#3366ff" });
    expect(get("--color-brand-500")?.valuesByMode).toBeUndefined();
    expect(get("--space-4")).toMatchObject({ type: "number", value: "16" });
    expect(get("--space-half")).toMatchObject({ type: "number", value: "8" });
    expect(get("--space-px")).toMatchObject({ type: "number", value: "1" });
    expect(get("--space-rel")).toMatchObject({ type: "string", value: "50%" });
    expect(get("--space-em")).toMatchObject({ type: "string", value: "1.5em" });
    expect(get("--radius-lg")).toMatchObject({ type: "number", value: "8" });
    expect(get("--radius-full")?.value).toBe("9999");
    expect(get("--font-sans")).toMatchObject({ type: "string", value: "Inter, sans-serif" });
    expect(c.notes.filter((n) => n.includes("kept as a string"))).toHaveLength(2);
    expect(c.notes.some((n) => n.startsWith("boxShadow: 1"))).toBe(true);
    expect(names(c, "Theme")).toEqual(["--primary"]);
  });

  it("keeps the modes of an existing multi-mode Primitives and notes the default-mode-only write", () => {
    const c = convertDesignTokens({ colors: { a: "#fff" } }, { existingPrimitivesModes: ["Light", "Dark"] });
    expect(c.args.collections.Primitives.modes).toEqual(["Light", "Dark"]);
    expect(c.notes.some((n) => n.includes("default mode only"))).toBe(true);
  });

  it("skips a name that two keys normalize to", () => {
    const c = convertDesignTokens({ spacing: { "Gap.Lg": "1rem", "gap-lg": "2rem" } });
    expect(c.counts.spacing).toBe(1);
    expect(c.notes.some((n) => n.includes("already taken"))).toBe(true);
  });
});
