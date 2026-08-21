/**
 * Bounded Levenshtein distance, shared by the two places that ask "is this
 * string a typo of one I know?" — repairing a mis-transcribed generate_image
 * URL, and suggesting a real Phosphor icon name for an unknown one.
 */

/**
 * Edit distance between `a` and `b`, giving up early once every possible
 * answer exceeds `limit`. Returns `limit + 1` in that case rather than the
 * true distance — callers only care whether it is close enough, and the
 * matrix is the expensive part.
 */
export function boundedLevenshtein(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr.push(value);
      if (value < rowMin) rowMin = value;
    }
    // Every future row can only grow, so once the whole row is past the limit
    // the answer is too — bail instead of finishing the matrix.
    if (rowMin > limit) return limit + 1;
    prev = curr;
  }
  return prev[b.length];
}
