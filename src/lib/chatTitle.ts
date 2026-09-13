const MAX_TITLE_LENGTH = 40;

// Markdown leaders that read as noise once hoisted into a plain-text title:
// heading hashes, blockquote markers, and list bullets — each followed by at
// least one space. A slash command (e.g. "/prototype …") is deliberately not
// in this set: it is meaningful on its own and should read as typed.
const MARKDOWN_LEADER = /^(?:#+|>|[-*])\s+/;

/**
 * Derives a short chat title from a user's first message. Returns null when
 * there is no usable text (empty or whitespace-only input) so callers can
 * leave the existing (default) title alone.
 */
export function deriveChatTitle(text: string): string | null {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;

  const collapsed = firstLine.replace(/\s+/g, " ").replace(MARKDOWN_LEADER, "");
  if (!collapsed) return null;

  if (collapsed.length <= MAX_TITLE_LENGTH) {
    return collapsed;
  }

  // Truncate to the last word boundary at or before the limit, so we never
  // cut a word in half.
  const slice = collapsed.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = slice.lastIndexOf(" ");
  const truncated = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${truncated}…`;
}
