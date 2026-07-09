/**
 * Fuzzy-ish match score for the command palette, passed as cmdk's `filter`
 * prop (`(value, search, keywords) => number`, 0 = no match). Matches are
 * case-insensitive substring checks against the item's `value` (its label)
 * and any `keywords`; a match at the start of the label scores highest so
 * e.g. "re" ranks "Rectangle" above "Copy properties".
 */
export function commandFilter(value: string, search: string, keywords?: string[]): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;

  const haystacks = [value, ...(keywords ?? [])].map((s) => s.toLowerCase());

  let best = 0;
  for (const haystack of haystacks) {
    if (haystack === query) {
      best = Math.max(best, 1);
    } else if (haystack.startsWith(query)) {
      best = Math.max(best, 0.8);
    } else if (haystack.includes(query)) {
      best = Math.max(best, 0.5);
    }
  }
  return best;
}
