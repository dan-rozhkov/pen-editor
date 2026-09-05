import { describe, it, expect } from "vitest";
import { validateInput } from "@/lib/webmcp/validateInput";
import type { JsonSchema } from "@/lib/webmcp/types";

const schema: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    count: { type: "integer", minimum: 1, maximum: 20 },
    ratio: { type: "number" },
    flag: { type: "boolean" },
    kind: { type: "string", enum: ["a", "b"] },
    tags: { type: "array", items: { type: "string" } },
    nested: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  required: ["name"],
  additionalProperties: false,
};

function errors(input: unknown): string[] {
  const result = validateInput(input, schema);
  return result.ok ? [] : result.errors;
}

describe("validateInput", () => {
  it("accepts input that matches the schema", () => {
    const input = { name: "x", count: 3, tags: ["a"], nested: { id: "n1" } };
    expect(validateInput(input, schema)).toEqual({ ok: true, value: input });
  });

  it("accepts an object with only the required fields", () => {
    expect(validateInput({ name: "x" }, schema).ok).toBe(true);
  });

  it("rejects a missing required field", () => {
    expect(errors({ count: 1 })).toContain("name: required");
  });

  // A closed schema whose runtime quietly accepts extras is a decorative
  // contract: discovery promises one shape and the handler takes another.
  it("rejects an unknown field rather than stripping it", () => {
    expect(errors({ name: "x", surprise: true })).toContain("surprise: unknown field");
  });

  it("rejects unknown fields in a nested closed object", () => {
    expect(errors({ name: "x", nested: { id: "n", extra: 1 } })).toContain(
      "nested.extra: unknown field"
    );
  });

  it("rejects a wrong primitive type instead of coercing it", () => {
    expect(errors({ name: 5 })).toContain("name: expected string, got number");
    expect(errors({ name: "x", count: "3" })).toContain("count: expected integer, got string");
    expect(errors({ name: "x", flag: "true" })).toContain("flag: expected boolean, got string");
  });

  it("rejects a non-integer number for an integer field", () => {
    expect(errors({ name: "x", count: 1.5 })).toContain("count: expected integer, got number");
  });

  // NaN and Infinity are numbers to JavaScript but cannot survive a JSON
  // round trip, so a handler would receive null where a number was promised.
  it("rejects non-finite numbers", () => {
    expect(errors({ name: "x", ratio: Number.NaN })).toContain("ratio: expected number, got number");
    expect(errors({ name: "x", ratio: Number.POSITIVE_INFINITY })).toHaveLength(1);
  });

  it("enforces minimum and maximum", () => {
    expect(errors({ name: "x", count: 0 })).toContain("count: below minimum 1");
    expect(errors({ name: "x", count: 21 })).toContain("count: above maximum 20");
  });

  it("enforces enum membership", () => {
    expect(errors({ name: "x", kind: "c" })).toContain('kind: "c" is not one of a, b');
  });

  it("enforces minLength", () => {
    expect(errors({ name: "" })).toContain("name: shorter than minLength 1");
  });

  it("checks array items", () => {
    expect(errors({ name: "x", tags: ["a", 2] })).toContain("tags[1]: expected string, got number");
  });

  it("rejects an array where an object is expected", () => {
    expect(errors({ name: "x", nested: [] })).toContain("nested: expected object, got array");
  });

  it("rejects null for an object field", () => {
    expect(errors({ name: "x", nested: null })).toContain("nested: expected object, got null");
  });

  it("rejects a non-object payload", () => {
    expect(validateInput([], schema).ok).toBe(false);
    expect(validateInput("{}", schema).ok).toBe(false);
    expect(validateInput(null, schema).ok).toBe(false);
  });

  // `in` walks the prototype chain, so a required-field check written with it
  // would consider "constructor" present on every object.
  it("does not treat inherited properties as supplied", () => {
    // The nested schema is annotated separately: written inline under the
    // key `constructor`, TypeScript resolves the property against Object's
    // own `constructor` rather than the index signature, and "string" widens.
    const stringSchema: JsonSchema = { type: "string" };
    const required: JsonSchema = {
      type: "object",
      properties: { constructor: stringSchema },
      required: ["constructor"],
      additionalProperties: false,
    };
    expect(validateInput({}, required).ok).toBe(false);
  });

  it("treats an explicit false as a supplied value, not a missing one", () => {
    const flagRequired: JsonSchema = {
      type: "object",
      properties: { flag: { type: "boolean" } },
      required: ["flag"],
      additionalProperties: false,
    };
    expect(validateInput({ flag: false }, flagRequired).ok).toBe(true);
  });

  it("reports every problem at once rather than only the first", () => {
    expect(errors({ count: "x", surprise: 1 }).length).toBeGreaterThan(2);
  });
});
