/** Shared validation helpers for the create/update/list_plugins handlers. */

export const MAX_PLUGIN_CODE_LENGTH = 100 * 1024;

export type UiArg = { width: number; height: number };

/**
 * Parse the `ui` tool argument. `undefined` (absent) and `null` both mean
 * "headless" per the backend schema (`ui = {width, height} | null`); an
 * object is validated for finite, strictly-positive numeric `width`/`height`
 * — the backend zod schema requires `.positive()`, and since this tool is
 * client-executed, this is the only real enforcement of that constraint.
 * Anything else (missing/non-numeric/non-finite/zero/negative dimensions)
 * is reported as `"invalid"` so callers can surface a clear error instead of
 * silently installing a malformed plugin.
 */
export function parseUiArg(raw: unknown): UiArg | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return "invalid";

  const { width, height } = raw as Record<string, unknown>;
  if (
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return { width, height };
  }
  return "invalid";
}

export type NormalizeIconResult =
  | { ok: true; icon: string | undefined }
  | { ok: false };

/**
 * Validate + normalize an `icon` tool argument. `undefined` (absent) is
 * valid and normalizes to `undefined` (no icon). A present value must be a
 * string; an empty string normalizes to `undefined` too, so create/update
 * treat "" and omitted identically. Anything else (e.g. `null`, a number) is
 * reported as `{ok: false}` — the caller must return a validation error
 * rather than let a bad value fall through as `undefined`, which previously
 * let `update_plugin`'s own `{icon: undefined}` patch key silently wipe a
 * plugin's stored icon via `{...current, ...patch}` in pluginStore.
 *
 * Returns a discriminated `{ok, icon}` result rather than a string sentinel:
 * a bare `"invalid"` string return value would be indistinguishable from a
 * (perfectly legal) icon whose text literally reads "invalid".
 */
export function normalizeIcon(icon: unknown): NormalizeIconResult {
  if (icon === undefined) return { ok: true, icon: undefined };
  if (typeof icon !== "string") return { ok: false };
  return { ok: true, icon: icon ? icon : undefined };
}

/**
 * Validate `code` against the shared size cap. Returns an error message
 * string when `code` is over the limit, or `null` when it's within bounds.
 */
export function validateCodeLength(code: string): string | null {
  if (code.length > MAX_PLUGIN_CODE_LENGTH) {
    return `code is too long (${code.length} chars, max ${MAX_PLUGIN_CODE_LENGTH})`;
  }
  return null;
}
