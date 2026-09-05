import type { JsonSchema } from "./types";

/**
 * A validator for the JSON Schema subset used by schemas.ts.
 *
 * Why hand-rolled rather than a library: the editor bundle is already heavy
 * (PixiJS and the whole canvas stack), the schemas here use a deliberately
 * small slice of JSON Schema, and pulling a general validator in for ten
 * tool contracts would cost more than it explains. If the schemas ever grow
 * beyond this subset, replace this file with a real validator rather than
 * quietly extending it — a validator that silently ignores a keyword it does
 * not understand is worse than no validator, because the schema then
 * advertises a constraint nothing enforces.
 *
 * Unknown keys are rejected, never stripped. A closed schema
 * (`additionalProperties: false`) that a permissive runtime silently accepts
 * is a decorative contract: discovery would promise one shape while the
 * handler took another.
 */

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: string[] };

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function checkValue(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: string[]
): void {
  const actual = typeOf(value);

  switch (schema.type) {
    case "object":
      if (actual !== "object") {
        errors.push(`${path}: expected object, got ${actual}`);
        return;
      }
      checkObject(value as Record<string, unknown>, schema, path, errors);
      return;
    case "array":
      if (actual !== "array") {
        errors.push(`${path}: expected array, got ${actual}`);
        return;
      }
      if (schema.maxItems !== undefined && (value as unknown[]).length > schema.maxItems) {
        errors.push(`${path}: more than maxItems ${schema.maxItems}`);
        // Do not then walk a deliberately huge array item by item.
        return;
      }
      if (schema.items) {
        (value as unknown[]).forEach((item, index) =>
          checkValue(item, schema.items as JsonSchema, `${path}[${index}]`, errors)
        );
      }
      return;
    case "integer":
      if (actual !== "number" || !Number.isInteger(value)) {
        errors.push(`${path}: expected integer, got ${actual}`);
        return;
      }
      break;
    case "number":
      // Number.isFinite, not a bare typeof: NaN and Infinity are numbers to
      // JavaScript but cannot survive a JSON round trip, so a handler would
      // receive null where the schema promised a number.
      if (actual !== "number" || !Number.isFinite(value)) {
        errors.push(`${path}: expected number, got ${actual}`);
        return;
      }
      break;
    case "string":
      if (actual !== "string") {
        errors.push(`${path}: expected string, got ${actual}`);
        return;
      }
      if (schema.minLength !== undefined && (value as string).length < schema.minLength) {
        errors.push(`${path}: shorter than minLength ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && (value as string).length > schema.maxLength) {
        errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
      }
      break;
    case "boolean":
      if (actual !== "boolean") {
        errors.push(`${path}: expected boolean, got ${actual}`);
        return;
      }
      break;
  }

  if (schema.enum && !schema.enum.includes(value as string | number)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  }
  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum) {
    errors.push(`${path}: below minimum ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && typeof value === "number" && value > schema.maximum) {
    errors.push(`${path}: above maximum ${schema.maximum}`);
  }
}

function checkObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  errors: string[]
): void {
  const properties = schema.properties ?? {};

  for (const key of schema.required ?? []) {
    // hasOwnProperty rather than `in` or a truthiness check: `in` walks the
    // prototype chain (so "constructor" would look present on any object),
    // and an explicit `false` or `0` is a supplied value, not a missing one.
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(`${path}${path ? "." : ""}${key}: required`);
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        errors.push(`${path}${path ? "." : ""}${key}: unknown field`);
      }
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const child = value[key];
    // An explicit `undefined` is treated as absent, matching how an omitted
    // key behaves after a JSON round trip.
    if (child === undefined) continue;
    checkValue(child, propertySchema, `${path}${path ? "." : ""}${key}`, errors);
  }
}

/**
 * Validates agent-supplied input against a tool's declared schema. Input
 * arrives from outside the application and is never trusted, whether or not
 * the browser or the calling agent claims to have checked it already.
 */
export function validateInput(
  input: unknown,
  schema: JsonSchema
): ValidationResult {
  const errors: string[] = [];

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: [`expected an object, got ${typeOf(input)}`] };
  }

  checkObject(input as Record<string, unknown>, schema, "", errors);

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as Record<string, unknown> };
}
