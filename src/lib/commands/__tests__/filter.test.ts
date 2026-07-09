import { describe, it, expect } from "vitest";
import { commandFilter } from "../filter";

describe("commandFilter", () => {
  it("returns a positive score for an empty query (show everything)", () => {
    expect(commandFilter("Rectangle", "")).toBeGreaterThan(0);
  });

  it("scores an exact match highest", () => {
    expect(commandFilter("Rectangle", "rectangle")).toBe(1);
  });

  it("scores a prefix match above a substring match", () => {
    const prefixScore = commandFilter("Rectangle", "rect");
    const substringScore = commandFilter("Copy properties", "rope");
    expect(prefixScore).toBeGreaterThan(substringScore);
  });

  it("is case-insensitive", () => {
    expect(commandFilter("Rectangle", "RECT")).toBeGreaterThan(0);
  });

  it("matches against keywords, not just the label", () => {
    expect(commandFilter("Select", "cursor", ["cursor", "arrow"])).toBeGreaterThan(0);
  });

  it("returns 0 when nothing matches", () => {
    expect(commandFilter("Rectangle", "zzz")).toBe(0);
  });
});
