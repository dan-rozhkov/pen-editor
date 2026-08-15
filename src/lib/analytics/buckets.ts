/**
 * Buckets a raw length (e.g. a chat message's character count) into a coarse
 * range string. Used instead of sending the raw number so we never leak
 * precision that could fingerprint content, and never the text itself.
 */
export function bucketLength(n: number): string {
  if (n <= 50) return "0-50";
  if (n <= 200) return "50-200";
  if (n <= 1000) return "200-1000";
  return "1000+";
}
