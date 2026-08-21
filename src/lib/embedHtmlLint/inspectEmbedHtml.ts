import { boundedLevenshtein } from "@/utils/editDistance";
import { PHOSPHOR_ICON_NAMES, PHOSPHOR_WEB_VERSION } from "./phosphorIconNames";

/**
 * Static checks over generated/edited embed HTML, run in-process (no DOM,
 * no store) so they can execute on every batch_design write.
 *
 * Why this exists: an icon-font class with no matching glyph (a typo'd
 * Phosphor name, e.g. `ph-stopwatch` instead of `ph-timer`) renders as blank
 * space — no console error, no broken-image icon, nothing visible on the
 * canvas that distinguishes it from an unrelated styling bug. A real agent
 * session burned roughly ten model turns cycling icon names in response to
 * "the icon is not visible" before landing on one that happened to exist,
 * because nothing told it the class itself was the problem. This module
 * turns that silent failure into an explicit warning the model reads back
 * from the tool result.
 */

const ICON_WEIGHT_FAMILIES = new Set([
  "ph",
  "ph-fill",
  "ph-bold",
  "ph-duotone",
  "ph-thin",
  "ph-light",
]);

const MAX_WARNINGS = 5;
/** Beyond this edit distance a suggestion is more likely to mislead than help. */
const MAX_SUGGESTION_DISTANCE = 3;
/** Shortest shared substring worth treating as a naming-family match (e.g. "watch" inside "stopwatch"). */
const MIN_SHARED_SUBSTRING = 4;

const CLASS_ATTR_RE = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Closest known icon name, or undefined when nothing is close enough to be
 * useful. Two cheap heuristics, tried in order:
 *
 * 1. Shared substring — catches names built by tacking a word onto/around a
 *    real icon word (e.g. "stopwatch" containing "watch"), which plain edit
 *    distance scores as far apart even though it's an obvious naming-family
 *    match. Picks the known name with the smallest length difference from
 *    `unknown` among those that share a substring of at least
 *    `MIN_SHARED_SUBSTRING` characters.
 * 2. Edit distance — catches straightforward typos/transpositions.
 */
function suggestIconName(unknown: string): string | undefined {
  let substringBest: string | undefined;
  let substringBestDelta = Infinity;

  let distanceBest: string | undefined;
  let distanceBestValue = MAX_SUGGESTION_DISTANCE + 1;

  for (const known of PHOSPHOR_ICON_NAMES) {
    if (known.length >= MIN_SHARED_SUBSTRING && unknown.includes(known)) {
      const delta = unknown.length - known.length;
      if (delta < substringBestDelta) {
        substringBestDelta = delta;
        substringBest = known;
      }
    } else if (unknown.length >= MIN_SHARED_SUBSTRING && known.includes(unknown)) {
      const delta = known.length - unknown.length;
      if (delta < substringBestDelta) {
        substringBestDelta = delta;
        substringBest = known;
      }
    }

    const distance = boundedLevenshtein(unknown, known, distanceBestValue - 1);
    if (distance < distanceBestValue) {
      distanceBestValue = distance;
      distanceBest = known;
    }
  }

  if (substringBest) return substringBest;
  return distanceBestValue <= MAX_SUGGESTION_DISTANCE ? distanceBest : undefined;
}

/**
 * Extract `ph-*` tokens that look like icon names (i.e. excluding the
 * weight-family tokens `ph`/`ph-fill`/`ph-bold`/`ph-duotone`/`ph-thin`/
 * `ph-light`) from every `class="..."`/`class='...'` attribute in the HTML.
 * Order of first appearance is preserved; duplicates are not deduped here
 * (the caller dedupes by name when building warnings).
 */
function extractPhosphorIconClasses(html: string): string[] {
  const found: string[] = [];
  let match: RegExpExecArray | null;
  CLASS_ATTR_RE.lastIndex = 0;
  while ((match = CLASS_ATTR_RE.exec(html)) !== null) {
    const attrValue = match[1] ?? match[2] ?? "";
    for (const token of attrValue.split(/\s+/)) {
      if (!token.startsWith("ph-")) continue;
      if (ICON_WEIGHT_FAMILIES.has(token)) continue;
      found.push(token.slice("ph-".length));
    }
  }
  return found;
}

/**
 * Inspect embed HTML for problems that would otherwise render silently
 * (currently: unknown Phosphor icon-font class names). Returns human-readable
 * warning strings meant to flow straight into the tool result the model
 * reads — never throws, never mutates its input.
 */
export function inspectEmbedHtml(html: string): string[] {
  if (!html) return [];

  const warnings: string[] = [];
  const reported = new Set<string>();

  for (const name of extractPhosphorIconClasses(html)) {
    if (warnings.length >= MAX_WARNINGS) break;
    if (reported.has(name)) continue;
    if (PHOSPHOR_ICON_NAMES.has(name)) continue;

    reported.add(name);
    const suggestion = suggestIconName(name);
    const suggestionText = suggestion ? ` Did you mean "ph-${suggestion}"?` : "";
    warnings.push(
      `Unknown Phosphor icon "ph-${name}" — it renders as blank space.${suggestionText} (icon set: @phosphor-icons/web@${PHOSPHOR_WEB_VERSION})`,
    );
  }

  return warnings;
}
