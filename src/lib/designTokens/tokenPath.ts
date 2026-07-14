// src/lib/designTokens/tokenPath.ts
import type { DtcgGroup, DtcgToken } from "./dtcgTypes";
import { isToken } from "./dtcgTypes";

/** "brand/500" → ["brand","500"]; trims each segment and drops empties. */
export function nameToSegments(name: string): string[] {
  return name
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** ["brand","500"] → "{brand.500}" (DTCG alias syntax). */
export function segmentsToAlias(segments: string[]): string {
  return `{${segments.join(".")}}`;
}

/**
 * Nest `token` under `segments` inside `root`, creating groups as needed.
 * Returns `true` if the token landed in a previously-empty slot, `false` if
 * it overwrote an existing token (last-writer-wins) or an intermediate
 * segment already held a token and had to be replaced with a fresh group
 * (a name collision, e.g. two styles named "primary", or a variable named
 * "fill" colliding with the "fill" group). The write always happens either way.
 */
export function setTokenAtPath(root: DtcgGroup, segments: string[], token: DtcgToken): boolean {
  let cursor = root;
  let collided = false;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    const next = cursor[key];
    if (next != null && typeof next === "object" && isToken(next as DtcgToken)) {
      collided = true;
    }
    if (next == null || typeof next !== "object" || isToken(next as DtcgToken)) {
      const group: DtcgGroup = {};
      cursor[key] = group;
      cursor = group;
    } else {
      cursor = next as DtcgGroup;
    }
  }
  const finalKey = segments[segments.length - 1];
  const wasEmpty = cursor[finalKey] == null;
  cursor[finalKey] = token;
  return collided ? false : wasEmpty;
}

/** Depth-first visit every token, ignoring $-prefixed group metadata. */
export function walkTokens(
  root: DtcgGroup,
  visit: (token: DtcgToken, segments: string[]) => void,
  trail: string[] = [],
): void {
  for (const key of Object.keys(root)) {
    if (key.startsWith("$")) continue;
    const node = root[key];
    if (node == null || typeof node !== "object") continue;
    const segments = [...trail, key];
    if (isToken(node as DtcgToken)) {
      visit(node as DtcgToken, segments);
    } else {
      walkTokens(node as DtcgGroup, visit, segments);
    }
  }
}
