import { describe, it, expect } from "vitest";
import { formatLength, formatMeasureLine } from "../units";
import type { MeasureLine } from "@/store/measureStore";

describe("formatLength", () => {
  describe("px units", () => {
    it("formats integer px without decimals", () => {
      expect(formatLength(16, "px", 16)).toBe("16px");
    });

    it("formats decimal px with up to 2 decimals, stripping trailing zeros", () => {
      expect(formatLength(10.5, "px", 16)).toBe("10.5px");
    });

    it("rounds to 2 decimals and strips trailing zeros", () => {
      expect(formatLength(10.123, "px", 16)).toBe("10.12px");
    });

    it("handles zero", () => {
      expect(formatLength(0, "px", 16)).toBe("0px");
    });

    it("handles negative values", () => {
      expect(formatLength(-10.5, "px", 16)).toBe("-10.5px");
    });
  });

  describe("rem units", () => {
    it("converts px to rem (remBase: 16)", () => {
      expect(formatLength(16, "rem", 16)).toBe("1rem");
    });

    it("converts px to rem with 4 decimals, stripping trailing zeros", () => {
      expect(formatLength(10, "rem", 16)).toBe("0.625rem");
    });

    it("rounds to 4 decimals and strips trailing zeros", () => {
      expect(formatLength(10.123, "rem", 16)).toBe("0.6327rem");
    });

    it("handles zero", () => {
      expect(formatLength(0, "rem", 16)).toBe("0rem");
    });

    it("handles negative values", () => {
      expect(formatLength(-16, "rem", 16)).toBe("-1rem");
    });

    it("works with remBase: 10", () => {
      expect(formatLength(10, "rem", 10)).toBe("1rem");
      expect(formatLength(5, "rem", 10)).toBe("0.5rem");
    });
  });
});

describe("formatMeasureLine", () => {
  it("returns a shallow copy with label rebuilt from Math.abs(line.length)", () => {
    const line: MeasureLine = {
      orientation: "horizontal",
      x: 100,
      y: 200,
      length: 24,
      label: "old-label",
    };

    const result = formatMeasureLine(line, "px", 16);
    expect(result).not.toBe(line); // different object
    expect(result.orientation).toBe("horizontal");
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
    expect(result.length).toBe(24);
    expect(result.label).toBe("24px");
  });

  it("uses Math.abs for negative length", () => {
    const line: MeasureLine = {
      orientation: "vertical",
      x: 50,
      y: 100,
      length: -16,
      label: "old",
    };

    const result = formatMeasureLine(line, "px", 16);
    expect(result.label).toBe("16px");
    expect(result.length).toBe(-16); // length stays negative
  });

  it("formats label with rem units", () => {
    const line: MeasureLine = {
      orientation: "horizontal",
      x: 10,
      y: 20,
      length: 32,
      label: "old",
    };

    const result = formatMeasureLine(line, "rem", 16);
    expect(result.label).toBe("2rem");
  });

  it("handles zero length", () => {
    const line: MeasureLine = {
      orientation: "horizontal",
      x: 0,
      y: 0,
      length: 0,
      label: "old",
    };

    const result = formatMeasureLine(line, "px", 16);
    expect(result.label).toBe("0px");
  });
});
