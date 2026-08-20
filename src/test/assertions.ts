import { expect } from "vitest";

// Narrowing helpers for test bodies. Prefer these over an `if (...) return`
// / `if (...) throw` guard clause inside a test body: eslint-plugin vitest's
// no-conditional-in-test (and no-conditional-expect) flag any conditional
// inside a test callback, including the common "assert a discriminated
// union / nullable result, then narrow" idiom — these helpers move the
// conditional into a real (non-conditional-inside-test) assertion instead.

/** Fails the test unless `value` is non-null/non-undefined, then narrows. */
export function assertDefined<T>(
  value: T,
  message = "expected value to be defined",
): asserts value is NonNullable<T> {
  expect(value, message).not.toBeNull();
  expect(value, message).not.toBeUndefined();
}

/** Fails the test unless a `{ ok: boolean }` result is the `ok: true` branch, then narrows. */
export function assertOk<T extends { ok: boolean }>(
  result: T,
  message?: string,
): asserts result is Extract<T, { ok: true }> {
  expect(result.ok, message).toBe(true);
}

/** Fails the test unless a `{ ok: boolean }` result is the `ok: false` branch, then narrows. */
export function assertErr<T extends { ok: boolean }>(
  result: T,
  message?: string,
): asserts result is Extract<T, { ok: false }> {
  expect(result.ok, message).toBe(false);
}

/**
 * Fails the test unless a discriminated union's tag field equals `value`,
 * then narrows to that branch — e.g. `assertField(shape, "kind", "rect")`
 * for a `{ kind: "rect" | "picture" | ... }` union, `assertField(segment,
 * "type", "cubic")` for a `{ type: "cubic" | "arc" | ... }` one, or
 * `assertField(result, "notConfigured", false)` for a boolean-literal tag.
 *
 * (Note: an earlier version made `field` itself depend on `keyof T` —
 * `T extends Record<K, unknown>, K extends keyof T` — which hits a TS
 * inference limitation where a type parameter's constraint referencing
 * another type parameter derived from it can resolve to `never`. Declaring
 * `K` unconstrained-by-`T` up front, and constraining `T` from `K` instead,
 * sidesteps that.)
 */
export function assertField<
  K extends string,
  V extends string | number | boolean,
  T extends Record<K, string | number | boolean>,
>(obj: T, field: K, value: V, message?: string): asserts obj is Extract<T, Record<K, V>> {
  expect((obj as Record<K, unknown>)[field], message).toBe(value);
}
