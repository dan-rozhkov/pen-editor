/**
 * Turning a half-arrived SVG document into something that can be drawn.
 *
 * QuiverAI streams an SVG as token-sized deltas, so at any moment the text we
 * hold is an arbitrary prefix — very often one that stops in the middle of an
 * attribute (`<path d="m69.64 30.5`). SVG is XML, and a truncated element makes
 * the *whole* document unparseable, not just that element: rendering the raw
 * prefix would show nothing at all rather than a partial drawing.
 *
 * So we cut back to the last element that finished and close the root tag
 * ourselves. This is the same discipline `draw_vector` applies to whole command
 * lines and `batch_design` to whole operations — only complete units are ever
 * acted on.
 *
 * The scanner is deliberately hand-written rather than regex-based: `>` occurs
 * freely inside attribute values (`stroke-dasharray="4 2"` is fine, but
 * `content=">"` is legal too), comments may contain anything, and the model's
 * own output carries an XML comment right after the root tag. A regex that
 * splits on `>` gets all three wrong.
 */

export interface SvgStreamPrefix {
  /** A well-formed SVG document, or null while the root tag is still arriving. */
  svg: string | null;
  /**
   * How many top-level elements have fully arrived. The caller re-rasterizes
   * only when this grows, which is both far cheaper than redrawing on every
   * delta (~270 per icon) and the honest visual unit: one finished `<path>` is
   * one brush stroke appearing.
   */
  completeElements: number;
}

interface RootTag {
  /** Index just past the root `<svg ...>` open tag. */
  contentStart: number;
  /** True when the root tag itself is self-closing — an empty document. */
  selfClosing: boolean;
}

/** Locate the end of the root `<svg ...>` tag, respecting quoted attributes. */
function findRootTag(text: string): RootTag | null {
  const open = text.indexOf("<svg");
  if (open === -1) return null;

  let quote: string | null = null;
  for (let i = open + 4; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") {
      return { contentStart: i + 1, selfClosing: text[i - 1] === "/" };
    }
  }
  return null;
}

/**
 * Scan the root's children and report where the last fully-closed one ends.
 *
 * Nesting matters: `<defs><linearGradient><stop/></linearGradient></defs>` is a
 * single top-level element, and emitting it half-open would strip the gradient
 * every shape referencing it depends on.
 */
function scanChildren(
  text: string,
  from: number,
): { end: number; count: number } {
  let i = from;
  let depth = 0;
  let count = 0;
  let end = from;

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) break;

    // Comments and CDATA carry arbitrary text; skip them wholesale. An
    // unterminated one means the prefix ends inside it, so nothing further is
    // complete.
    if (text.startsWith("<!--", lt)) {
      const close = text.indexOf("-->", lt + 4);
      if (close === -1) break;
      i = close + 3;
      if (depth === 0) end = i;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const close = text.indexOf("]]>", lt + 9);
      if (close === -1) break;
      i = close + 3;
      continue;
    }

    const isClosing = text[lt + 1] === "/";

    // Walk to this tag's `>`, ignoring any that sit inside attribute values.
    let quote: string | null = null;
    let gt = -1;
    for (let j = lt + 1; j < text.length; j += 1) {
      const ch = text[j];
      if (quote !== null) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === ">") {
        gt = j;
        break;
      }
    }
    // The prefix stops inside this tag — nothing beyond the last recorded
    // boundary is usable.
    if (gt === -1) break;

    const selfClosing = text[gt - 1] === "/";

    if (isClosing) {
      // A `</svg>` at depth 0 is the document's own end, not a child's.
      if (depth === 0) break;
      depth -= 1;
      if (depth === 0) {
        end = gt + 1;
        count += 1;
      }
    } else if (!selfClosing) {
      depth += 1;
    } else if (depth === 0) {
      end = gt + 1;
      count += 1;
    }

    i = gt + 1;
  }

  return { end, count };
}

/**
 * Build the largest well-formed SVG document contained in `partial`.
 *
 * Returns `svg: null` until the root tag has arrived; after that the result is
 * always parseable, even when zero children are complete (an empty but valid
 * document, which renders as blank rather than as an error).
 */
export function buildRenderableSvgPrefix(partial: string): SvgStreamPrefix {
  const root = findRootTag(partial);
  if (root === null) return { svg: null, completeElements: 0 };
  if (root.selfClosing) {
    return { svg: partial.slice(0, root.contentStart), completeElements: 0 };
  }

  const { end, count } = scanChildren(partial, root.contentStart);
  return {
    svg: `${partial.slice(0, end)}</svg>`,
    completeElements: count,
  };
}
