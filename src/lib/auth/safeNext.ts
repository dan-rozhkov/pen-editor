// `?next=` is attacker-controllable, so only same-origin relative paths are
// followed: it must start with a single "/" (not "//" or "/\", which browsers
// resolve to another host) and contain no scheme, control characters or
// backslashes.
export function safeNext(raw: string | null | undefined, fallback = "/app"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, "http://same-origin.invalid");
    if (url.origin !== "http://same-origin.invalid") return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
