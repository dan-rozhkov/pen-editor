import { describe, expect, it } from "vitest";
import { MAX_PLUGIN_CODE_LENGTH, normalizeIcon, parseUiArg, validateCodeLength } from "../shared";

describe("parseUiArg", () => {
  it("treats undefined and null as headless (null)", () => {
    expect(parseUiArg(undefined)).toBeNull();
    expect(parseUiArg(null)).toBeNull();
  });

  it("accepts a valid {width, height} object", () => {
    expect(parseUiArg({ width: 200, height: 120 })).toEqual({ width: 200, height: 120 });
  });

  it("rejects width/height of 0", () => {
    expect(parseUiArg({ width: 0, height: 100 })).toBe("invalid");
    expect(parseUiArg({ width: 100, height: 0 })).toBe("invalid");
  });

  it("rejects negative width/height", () => {
    expect(parseUiArg({ width: -10, height: 100 })).toBe("invalid");
    expect(parseUiArg({ width: 100, height: -10 })).toBe("invalid");
  });

  it("rejects NaN and Infinity width/height", () => {
    expect(parseUiArg({ width: NaN, height: 100 })).toBe("invalid");
    expect(parseUiArg({ width: 100, height: NaN })).toBe("invalid");
    expect(parseUiArg({ width: Infinity, height: 100 })).toBe("invalid");
    expect(parseUiArg({ width: 100, height: -Infinity })).toBe("invalid");
  });

  it("rejects a missing field, non-numeric field, or non-object", () => {
    expect(parseUiArg({ width: 100 })).toBe("invalid");
    expect(parseUiArg({ width: "100", height: 100 })).toBe("invalid");
    expect(parseUiArg("nope")).toBe("invalid");
    expect(parseUiArg(42)).toBe("invalid");
  });
});

describe("normalizeIcon", () => {
  it("treats undefined as no icon", () => {
    expect(normalizeIcon(undefined)).toBeUndefined();
  });

  it("normalizes an empty string to undefined", () => {
    expect(normalizeIcon("")).toBeUndefined();
  });

  it("passes through a non-empty string", () => {
    expect(normalizeIcon("🔢")).toBe("🔢");
  });

  it("rejects null and non-string values", () => {
    expect(normalizeIcon(null)).toBe("invalid");
    expect(normalizeIcon(123)).toBe("invalid");
    expect(normalizeIcon(true)).toBe("invalid");
    expect(normalizeIcon({})).toBe("invalid");
  });
});

describe("validateCodeLength", () => {
  it("accepts code at exactly the limit", () => {
    expect(validateCodeLength("a".repeat(MAX_PLUGIN_CODE_LENGTH))).toBeNull();
  });

  it("rejects code over the limit with a descriptive message", () => {
    const error = validateCodeLength("a".repeat(MAX_PLUGIN_CODE_LENGTH + 1));
    expect(error).toContain("too long");
    expect(error).toContain(String(MAX_PLUGIN_CODE_LENGTH));
  });
});
