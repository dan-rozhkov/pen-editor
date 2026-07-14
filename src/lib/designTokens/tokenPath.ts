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

/** Nest `token` under `segments` inside `root`, creating groups as needed. */
export function setTokenAtPath(root: DtcgGroup, segments: string[], token: DtcgToken): void {
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    const next = cursor[key];
    if (next == null || typeof next !== "object" || isToken(next as DtcgToken)) {
      const group: DtcgGroup = {};
      cursor[key] = group;
      cursor = group;
    } else {
      cursor = next as DtcgGroup;
    }
  }
  cursor[segments[segments.length - 1]] = token;
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
