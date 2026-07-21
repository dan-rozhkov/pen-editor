/** Shared validation helpers for the create/update/list_plugins handlers. */

export const MAX_PLUGIN_CODE_LENGTH = 100 * 1024;

export type UiArg = { width: number; height: number };

/**
 * Parse the `ui` tool argument. `undefined` (absent) and `null` both mean
 * "headless" per the backend schema (`ui = {width, height} | null`); an
 * object is validated for numeric `width`/`height`. Anything else is
 * reported as `"invalid"` so callers can surface a clear error instead of
 * silently installing a malformed plugin.
 */
export function parseUiArg(raw: unknown): UiArg | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as Record<string, unknown>).width === "number" &&
    typeof (raw as Record<string, unknown>).height === "number"
  ) {
    const { width, height } = raw as Record<string, number>;
    return { width, height };
  }
  return "invalid";
}
