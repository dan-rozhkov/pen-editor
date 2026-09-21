import { describe, it, expect } from "vitest";
import {
  contextFillPercent,
  formatCompactTokens,
  formatContextUsage,
  contextMeterLabel,
} from "@/lib/contextMeter";

describe("contextFillPercent", () => {
  it("returns 0 for zero tokens", () => {
    expect(contextFillPercent(0, 1_000_000)).toBe(0);
  });

  it("rounds to the nearest whole percent", () => {
    expect(contextFillPercent(500_000, 1_000_000)).toBe(50);
    expect(contextFillPercent(123_456, 1_000_000)).toBe(12);
  });

  it("clamps to 100 when tokens exceed the window", () => {
    expect(contextFillPercent(2_000_000, 1_000_000)).toBe(100);
  });

  it("returns 0 for a non-positive context window", () => {
    expect(contextFillPercent(500, 0)).toBe(0);
    expect(contextFillPercent(500, -10)).toBe(0);
  });
});

describe("formatCompactTokens", () => {
  it("formats sub-1000 counts as plain integers", () => {
    expect(formatCompactTokens(0)).toBe("0");
    expect(formatCompactTokens(512)).toBe("512");
  });

  it("formats thousands with a K suffix, trimming a trailing .0", () => {
    expect(formatCompactTokens(128_000)).toBe("128K");
    expect(formatCompactTokens(1_500)).toBe("1.5K");
  });

  it("formats millions with an M suffix, trimming a trailing .0", () => {
    expect(formatCompactTokens(1_000_000)).toBe("1M");
    expect(formatCompactTokens(1_048_576)).toBe("1M");
    expect(formatCompactTokens(1_310_720)).toBe("1.3M");
  });
});

describe("formatContextUsage", () => {
  it("joins the compact tokens and window as a fraction", () => {
    expect(formatContextUsage(128_000, 1_000_000)).toBe("128K / 1M");
  });
});

describe("contextMeterLabel", () => {
  it("combines percent and the compact fraction", () => {
    expect(contextMeterLabel(128_000, 1_000_000)).toBe("Context: 13% · 128K / 1M");
  });
});
