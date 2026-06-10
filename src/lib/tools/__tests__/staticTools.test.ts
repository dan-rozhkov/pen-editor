import { describe, it, expect } from "vitest";
import {
  getGuidelines,
  getStyleGuide,
  getStyleGuideTags,
} from "@/lib/tools/staticTools";

describe("get_guidelines", () => {
  it("returns substantial content for a known topic", async () => {
    const result = JSON.parse(await getGuidelines({ topic: "design-system" }));
    expect(result.topic).toBe("design-system");
    expect(typeof result.guidelines).toBe("string");
    expect(result.guidelines.length).toBeGreaterThan(200);
    expect(result.guidelines).toContain("fill_container");
  });

  it("covers all documented topics", async () => {
    for (const topic of ["design-system", "code", "table", "tailwind", "landing-page"]) {
      const result = JSON.parse(await getGuidelines({ topic }));
      expect(result.topic).toBe(topic);
      expect(result.guidelines.length).toBeGreaterThan(50);
    }
  });

  it("lists available topics on an unknown topic", async () => {
    const result = JSON.parse(await getGuidelines({ topic: "nope" }));
    expect(result.error).toContain("design-system");
    expect(result.error).toContain("landing-page");
  });
});

describe("get_style_guide_tags", () => {
  it("returns non-empty tag categories", async () => {
    const result = JSON.parse(await getStyleGuideTags({}));
    for (const category of ["style", "color", "industry", "platform", "layout"]) {
      expect(Array.isArray(result.tags[category])).toBe(true);
      expect(result.tags[category].length).toBeGreaterThan(0);
    }
  });
});

describe("get_style_guide", () => {
  it("returns a complete style guide echoing the requested tags", async () => {
    const result = JSON.parse(
      await getStyleGuide({ tags: ["minimal", "saas"], name: "My Guide" })
    );
    expect(result.name).toBe("My Guide");
    expect(result.basedOn).toEqual(["minimal", "saas"]);
    expect(result.typography.sizes.body).toBeGreaterThan(0);
    expect(result.colors.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(Object.keys(result.spacing).length).toBeGreaterThan(3);
    expect(Object.keys(result.borderRadius).length).toBeGreaterThan(3);
  });

  it("falls back to defaults when called without arguments", async () => {
    const result = JSON.parse(await getStyleGuide({}));
    expect(result.name).toBe("Generated Style Guide");
    expect(result.basedOn).toEqual([]);
  });
});
