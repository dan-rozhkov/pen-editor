import { describe, expect, it } from "vitest";
import { getShowcaseModelLabel } from "@/components/showcase/showcaseApps";

describe("getShowcaseModelLabel", () => {
  it("uses friendly editor labels for model badges", () => {
    expect(getShowcaseModelLabel("google/gemini-2.5-flash")).toBe(
      "Gemini 2.5 Flash",
    );
    expect(getShowcaseModelLabel("test/model")).toBe("Model");
  });
});
