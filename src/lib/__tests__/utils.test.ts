import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn radius merging", () => {
  it("lets a later rounded-md override rounded-control", () => {
    expect(cn("rounded-control", "rounded-md")).toBe("rounded-md");
  });
  it("lets a later rounded-control override rounded-md", () => {
    expect(cn("rounded-md", "rounded-control")).toBe("rounded-control");
  });
  it("merges every control radius step", () => {
    expect(cn("rounded-md", "rounded-control-lg")).toBe("rounded-control-lg");
    expect(cn("rounded-control-xs", "rounded-control-xl")).toBe("rounded-control-xl");
  });
  it("merges the inset radius", () => {
    expect(cn("rounded-md", "rounded-control-inset")).toBe("rounded-control-inset");
    expect(cn("rounded-control-inset", "rounded-control")).toBe("rounded-control");
  });
  it("keeps side-specific radii alongside rounded-control", () => {
    expect(cn("rounded-control", "rounded-r-none")).toBe("rounded-control rounded-r-none");
  });
});
