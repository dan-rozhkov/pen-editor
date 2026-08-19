/**
 * Partial read views over an embed's HTML, so the model can locate a fragment
 * without pulling the whole document into context.
 */

const OUTLINE_HEADER =
  "<!-- outline: text is truncated, deep subtrees are elided, and attribute quoting is " +
  "normalized (double quotes, inner quotes escaped as &quot;). For a byte-exact anchor to " +
  'pass to edit_embed_html, use read_embed_html mode "grep". -->';

const ELIDED_TAGS = new Set(["style", "script"]);

/**
 * Grep output caps. A single-line embed (everything the HTML capture path
 * produces) or a common pattern like `class=` would otherwise return the whole
 * document — exactly the context blow-up this tool exists to prevent.
 */
const LONG_LINE_CHARS = 400;
const WINDOW_CHARS = 200;
const MAX_BLOCKS = 30;
const MAX_OUTPUT_CHARS = 12_000;

/**
 * Outline caps. Depth elision alone does not bound a wide document — a list of
 * 40 cards is shallow but repeats forever — so siblings and total size are
 * capped too, or the outline can come out longer than the screen it describes.
 */
const GREP_NOTE =
  'Every line is prefixed with "N: " (or "N [chars a-b]: " for a windowed long line). ' +
  "Strip that prefix before passing text to edit_embed_html — the prefix is not part of the HTML.";

const MAX_CHILDREN = 12;
const MAX_OUTLINE_CHARS = 8_000;

function openingTag(el: Element): string {
  const attrs = Array.from(el.attributes)
    // A value containing a double quote would otherwise render as malformed
    // markup that reads like a verbatim anchor but is not one.
    .map((attr) => ` ${attr.name}="${attr.value.replaceAll('"', "&quot;")}"`)
    .join("");
  return `<${el.tagName.toLowerCase()}${attrs}>`;
}

function countDescendants(el: Element): number {
  return el.getElementsByTagName("*").length;
}

function truncate(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars)}…` : collapsed;
}

function outlineElement(
  el: Element,
  depth: number,
  maxDepth: number,
  maxTextChars: number,
  out: string[],
): void {
  const indent = "  ".repeat(depth);
  const tag = el.tagName.toLowerCase();

  if (ELIDED_TAGS.has(tag)) {
    out.push(`${indent}${openingTag(el)} /* ${el.textContent?.length ?? 0} chars omitted */ </${tag}>`);
    return;
  }

  const children = Array.from(el.children);

  if (children.length === 0) {
    const text = truncate(el.textContent ?? "", maxTextChars);
    out.push(`${indent}${openingTag(el)}${text}</${tag}>`);
    return;
  }

  if (depth >= maxDepth) {
    out.push(`${indent}${openingTag(el)} <!-- ${countDescendants(el)} nodes omitted --> </${tag}>`);
    return;
  }

  // Direct text of a container (before its first element child) still matters
  // for locating copy, so keep a truncated version of it.
  const ownText = truncate(
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3 /* TEXT_NODE */)
      .map((n) => n.textContent ?? "")
      .join(" "),
    maxTextChars,
  );

  out.push(`${indent}${openingTag(el)}${ownText}`);
  for (const child of children.slice(0, MAX_CHILDREN)) {
    outlineElement(child, depth + 1, maxDepth, maxTextChars, out);
  }
  if (children.length > MAX_CHILDREN) {
    out.push(`${indent}  <!-- ${children.length - MAX_CHILDREN} more siblings omitted -->`);
  }
  out.push(`${indent}</${tag}>`);
}

export function buildOutline(html: string, maxDepth = 4, maxTextChars = 40): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [OUTLINE_HEADER];
  // Walk head and body children rather than documentElement: the <html>/<body>
  // wrappers DOMParser synthesizes would eat two of the depth levels, collapsing
  // a real screen into "nodes omitted" at the default maxDepth.
  const roots = [...Array.from(doc.head.children), ...Array.from(doc.body.children)];
  const walk: Array<Element | null> = roots.length > 0 ? roots : [doc.documentElement];
  for (const el of walk) {
    if (el) outlineElement(el, 0, maxDepth, maxTextChars, out);
  }
  const outline = out.join("\n");
  if (outline.length <= MAX_OUTLINE_CHARS) return outline;
  return (
    `${outline.slice(0, MAX_OUTLINE_CHARS)}\n` +
    `<!-- outline truncated at ${MAX_OUTLINE_CHARS} chars. Narrow it with a smaller maxDepth, ` +
    'or use mode "grep" to find a specific fragment. -->'
  );
}

/** Every start index of `needle` in `haystack`. */
function occurrenceIndexes(haystack: string, needle: string): number[] {
  // An empty needle would match at every position without advancing `from`.
  if (needle.length === 0) return [];
  const indexes: number[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return indexes;
    indexes.push(index);
    from = index + needle.length;
  }
}

/**
 * Render one matching line. A long line (a minified or single-line embed) is
 * reduced to character windows around each match — each window is still an
 * exact substring, so it stays usable as an edit anchor.
 */
function renderHitLine(line: string, lineNumber: number, pattern: string): string[] {
  if (line.length <= LONG_LINE_CHARS) return [`${lineNumber}: ${line}`];

  const windows: Array<[number, number]> = [];
  for (const index of occurrenceIndexes(line, pattern)) {
    const start = Math.max(0, index - WINDOW_CHARS);
    const end = Math.min(line.length, index + pattern.length + WINDOW_CHARS);
    const last = windows[windows.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      windows.push([start, end]);
    }
  }
  return windows.map(
    ([start, end]) => `${lineNumber} [chars ${start}-${end}]: ${line.slice(start, end)}`,
  );
}

export function grepHtml(
  html: string,
  pattern: string,
  contextLines = 2,
): { matches: number; blocks: string[]; note: string; truncated?: true } {
  const lines = html.split("\n");
  const hits: number[] = [];
  let matches = 0;

  // A pattern spanning a line break can never match line-by-line, and model
  // written embeds are multi-line — so search the whole document and mark every
  // line a match spans as a hit.
  const spansLines = pattern.includes("\n");
  if (spansLines) {
    const lineStarts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      lineStarts.push(offset);
      offset += line.length + 1;
    }
    const lineOf = (index: number): number => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (lineStarts[mid] <= index) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const found = occurrenceIndexes(html, pattern);
    matches = found.length;
    const spanned = new Set<number>();
    for (const index of found) {
      const first = lineOf(index);
      const last = lineOf(index + pattern.length - 1);
      for (let i = first; i <= last; i += 1) spanned.add(i);
    }
    hits.push(...[...spanned].sort((a, b) => a - b));
  } else {
    lines.forEach((line, i) => {
      const count = occurrenceIndexes(line, pattern).length;
      if (count > 0) {
        hits.push(i);
        matches += count;
      }
    });
  }

  if (hits.length === 0) return { matches: 0, blocks: [], note: GREP_NOTE };

  // Merge overlapping context windows so adjacent hits read as one block.
  const ranges: Array<[number, number]> = [];
  for (const hit of hits) {
    const start = Math.max(0, hit - contextLines);
    const end = Math.min(lines.length - 1, hit + contextLines);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  const hitLines = new Set(hits);
  const blocks: string[] = [];
  let outputChars = 0;
  let truncated = false;

  for (const [start, end] of ranges) {
    if (blocks.length >= MAX_BLOCKS) {
      truncated = true;
      break;
    }
    const rendered: string[] = [];
    let blockChars = 0;

    for (let i = start; i <= end && !truncated; i += 1) {
      const line = lines[i];
      const pieces = hitLines.has(i) && !spansLines
        ? renderHitLine(line, i + 1, pattern)
        : // Context lines only orient the reader, so a long one is cut short.
          [`${i + 1}: ${line.length > LONG_LINE_CHARS ? `${line.slice(0, LONG_LINE_CHARS)}…` : line}`];

      for (const piece of pieces) {
        // The budget is checked per line, not per block: with contextLines
        // covering every line, all ranges merge into ONE block, so a
        // between-blocks check would never fire.
        if (outputChars + blockChars + piece.length > MAX_OUTPUT_CHARS) {
          truncated = true;
          break;
        }
        rendered.push(piece);
        blockChars += piece.length + 1;
      }
    }

    if (rendered.length > 0) {
      blocks.push(rendered.join("\n"));
      outputChars += blockChars;
    }
    if (truncated) break;
  }

  return { matches, blocks, note: GREP_NOTE, ...(truncated ? { truncated: true as const } : {}) };
}
