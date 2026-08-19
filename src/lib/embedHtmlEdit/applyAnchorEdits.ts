/**
 * Anchor-based text edits for embed HTML: each edit replaces an exact
 * substring. Matching is deliberately exact — no whitespace or quote
 * normalization — because a "smart" match silently hits the neighbouring
 * lookalike block, which is far more expensive than a failed edit.
 */

export interface AnchorEdit {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface AnchorEditResult {
  html: string;
  replacements: number;
}

export class AnchorEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorEditError";
  }
}

const CONTEXT_CHARS = 40;
const MAX_REPORTED_CONTEXTS = 3;

function countOccurrences(haystack: string, needle: string): number {
  // An empty needle would match at every position without advancing `from`.
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return count;
    count += 1;
    from = index + needle.length;
  }
}

/** Up to three "…text…" windows around the first occurrences, for error messages. */
function occurrenceContexts(haystack: string, needle: string): string[] {
  const contexts: string[] = [];
  let from = 0;
  while (contexts.length < MAX_REPORTED_CONTEXTS) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    const start = Math.max(0, index - CONTEXT_CHARS);
    const end = Math.min(haystack.length, index + needle.length + CONTEXT_CHARS);
    contexts.push(`…${haystack.slice(start, end)}…`);
    from = index + needle.length;
  }
  return contexts;
}

export function applyAnchorEdits(html: string, edits: AnchorEdit[]): AnchorEditResult {
  let current = html;
  let replacements = 0;

  edits.forEach((edit, i) => {
    const label = `Edit ${i + 1}`;
    if (edit.oldString.length === 0) {
      throw new AnchorEditError(`${label}: oldString must not be empty.`);
    }

    const occurrences = countOccurrences(current, edit.oldString);
    if (occurrences === 0) {
      throw new AnchorEditError(
        `${label}: oldString not found. Nothing was changed. ` +
          `Call read_embed_html with mode "grep" to get the exact text — matching is byte-exact.`,
      );
    }
    if (occurrences > 1 && !edit.replaceAll) {
      throw new AnchorEditError(
        `${label}: oldString occurs ${occurrences} times. Nothing was changed. ` +
          `Extend the anchor with surrounding text to make it unique, or pass replaceAll: true. ` +
          `Occurrences: ${occurrenceContexts(current, edit.oldString).join(" | ")}`,
      );
    }

    if (edit.replaceAll) {
      // split/join, not String.replace: `$&`/`$1` in newString are literal text here.
      current = current.split(edit.oldString).join(edit.newString);
      replacements += occurrences;
    } else {
      const index = current.indexOf(edit.oldString);
      current =
        current.slice(0, index) + edit.newString + current.slice(index + edit.oldString.length);
      replacements += 1;
    }
  });

  return { html: current, replacements };
}
