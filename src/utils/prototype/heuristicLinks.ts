import type { PrototypeCandidate, PrototypeLink } from "./types";

export interface HeuristicScreen {
  slug: string;
  name: string;
  candidates: Pick<PrototypeCandidate, "protoId" | "text" | "ariaLabel" | "href">[];
}

/**
 * Labels too generic to trust for a fuzzy (word-boundary/contains) match —
 * e.g. a "Next" button shouldn't link to a screen literally named "Next"
 * unless the match is exact. Exact-name/slug matches bypass this list
 * entirely, so a screen genuinely named "Next" still links correctly.
 */
const GENERIC_LABELS = new Set([
  "click here", "learn more", "read more", "submit", "next", "back", "close",
  "cancel", "ok", "menu", "more", "continue", "go", "link", "button", "here",
]);

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isExactMatch(labelNorm: string, targetNorm: string): boolean {
  return targetNorm.length > 0 && labelNorm === targetNorm;
}

function isFuzzyMatch(labelNorm: string, targetNorm: string): boolean {
  if (!targetNorm || GENERIC_LABELS.has(labelNorm)) return false;
  const re = new RegExp(`\\b${escapeRegExp(targetNorm)}\\b`);
  return re.test(labelNorm);
}

/**
 * Deterministic fallback/complement to the LLM-resolved link graph: for each
 * clickable candidate, if its text or aria-label clearly names another
 * screen (by name or slug — exact match preferred, whole-word/contains as a
 * fallback), link to it. Conservative by design — only a clear, unambiguous
 * match produces a link; never a self-link; at most one link per candidate.
 */
export function heuristicPrototypeLinks(screens: HeuristicScreen[]): PrototypeLink[] {
  const links: PrototypeLink[] = [];

  for (const screen of screens) {
    for (const cand of screen.candidates) {
      const labels = [cand.text, cand.ariaLabel]
        .filter((t): t is string => !!t && t.trim().length > 0)
        .map(normalize);
      if (labels.length === 0) continue;

      // 0 = exact match (highest confidence), 1 = fuzzy contains match.
      let bestTier = Infinity;
      let bestTargets = new Set<string>();

      for (const other of screens) {
        if (other.slug === screen.slug) continue;
        const nameNorm = normalize(other.name);
        const slugNorm = normalize(other.slug.replace(/-/g, " "));

        for (const label of labels) {
          if (isExactMatch(label, nameNorm) || isExactMatch(label, slugNorm)) {
            if (bestTier > 0) {
              bestTier = 0;
              bestTargets = new Set();
            }
            bestTargets.add(other.slug);
          } else if (
            bestTier > 1 &&
            (isFuzzyMatch(label, nameNorm) || isFuzzyMatch(label, slugNorm))
          ) {
            bestTier = 1;
            bestTargets = new Set([other.slug]);
          } else if (bestTier === 1 && (isFuzzyMatch(label, nameNorm) || isFuzzyMatch(label, slugNorm))) {
            bestTargets.add(other.slug);
          }
        }
      }

      // Ambiguous (matches more than one screen at the best tier) — skip.
      if (bestTier !== Infinity && bestTargets.size === 1) {
        links.push({
          screenId: screen.slug,
          protoId: cand.protoId,
          targetScreenId: [...bestTargets][0]!,
        });
      }
    }
  }

  return links;
}
