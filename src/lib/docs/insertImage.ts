// Pure markdown logic for the agent's doc_insert_image tool: build an image line and splice it
// into a document as its own paragraph, at the end of a heading's section or at the end.

export type InsertImageResult = { ok: true; markdown: string } | { ok: false; error: string };

/**
 * `![alt](url "title")` with `[`, `]`, `\` and newlines in alt escaped, `"` and `\` in the title
 * escaped, and URLs with spaces, parens or angle brackets in `<...>`.
 */
export function buildImageMarkdown(alt: string, url: string, title?: string): string {
  const safeAlt = alt
    .replace(/\\/g, "\\\\")
    .replace(/[[\]]/g, (c) => `\\${c}`)
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
  const safeUrl = /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
  const safeTitle = title
    ? title.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s*[\r\n]+\s*/g, " ").trim()
    : "";
  return safeTitle ? `![${safeAlt}](${safeUrl} "${safeTitle}")` : `![${safeAlt}](${safeUrl})`;
}

interface HeadingLine {
  index: number;
  level: number;
  text: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

/** ATX headings outside fenced code blocks. */
function findHeadings(lines: string[]): HeadingLine[] {
  const out: HeadingLine[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
      return;
    }
    if (f) {
      fence = f[1];
      return;
    }
    const m = ATX.exec(line);
    if (m) out.push({ index, level: m[1].length, text: (m[2] ?? "").replace(/[ \t]+#+$/, "").trim() });
  });
  return out;
}

/**
 * Inserts `imageMarkdown` as its own paragraph. With `afterHeading` it goes at the end of the
 * first matching heading's section (before the next heading of the same or higher level); a
 * missing heading is an error. Without it, the image is appended at the end.
 */
export function insertImageIntoMarkdown(markdown: string, imageMarkdown: string, afterHeading?: string): InsertImageResult {
  const lines = markdown.split("\n");
  let at = lines.length;
  if (afterHeading !== undefined) {
    const wanted = afterHeading.replace(/^#+\s+/, "").replace(/[ \t]+#+$/, "").trim().toLowerCase();
    const headings = findHeadings(lines);
    const pos = headings.findIndex((h) => h.text.toLowerCase() === wanted);
    if (pos < 0) {
      const known = headings.map((h) => h.text).filter(Boolean);
      return {
        ok: false,
        error: `Heading "${afterHeading}" was not found in the document.${known.length ? ` Headings: ${known.map((t) => `"${t}"`).join(", ")}.` : " The document has no headings."}`,
      };
    }
    const next = headings.slice(pos + 1).find((h) => h.level <= headings[pos].level);
    at = next ? next.index : lines.length;
  }
  const before = lines.slice(0, at);
  while (before.length > 0 && before[before.length - 1].trim() === "") before.pop();
  const after = lines.slice(at);
  const head = before.length > 0 ? [...before, ""] : [];
  const tail = after.length > 0 && after.some((l) => l.trim() !== "") ? ["", ...after] : [""];
  return { ok: true, markdown: [...head, imageMarkdown, ...tail].join("\n") };
}
