/** Lowercase, drop `[Area]` tags, punctuation and extra spaces, so "Bug: [Checkout] Total" matches "Bug - Total". */
function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesMatch(heading: string, title: string): boolean {
  const a = normalizeTitle(heading);
  const b = normalizeTitle(title);
  if (a === "" || b === "") return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * The doc page shows the title in its own field, so a body that also starts with `# Title` shows it twice.
 * Removes a leading ATX H1 (a single `#`) and the blank lines after it, but only when it repeats `title`
 * (equal after normalizing, or one contains the other). Without `title`, any leading H1 is removed.
 * Returns the markdown unchanged when the first non-blank line is not such an H1.
 * `title` in the result is the H1 text, or undefined when nothing was removed.
 */
export function stripLeadingTitle(markdown: string, title?: string): { markdown: string; title?: string } {
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const match = i < lines.length ? /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*\r?$/.exec(lines[i]) : null;
  if (!match) return { markdown };
  const heading = match[1].trim();
  if (title !== undefined && title.trim() !== "" && !titlesMatch(heading, title)) return { markdown };
  let next = i + 1;
  while (next < lines.length && lines[next].trim() === "") next++;
  return { markdown: lines.slice(next).join("\n"), title: heading };
}
