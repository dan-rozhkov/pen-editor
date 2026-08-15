/**
 * Materialize CSS pseudo-elements into real DOM nodes so downstream
 * processors (canvas renderers, HTML->design converters) can handle them.
 */
export function materializePseudoElements(root: Element): void {
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.dataset.embedPseudo === "before" || el.dataset.embedPseudo === "after") continue;
    materializeElementPseudo(el, "before");
    materializeElementPseudo(el, "after");
  }

  // Once a pseudo-element has been copied into a real span, the original
  // must stop participating in layout. Otherwise icon-font elements contain
  // both the original ::before glyph and the materialized glyph: flex/grid
  // centers their combined width, while the canvas walker only paints the
  // real span, shifting the visible icon by half a glyph.
  let suppression = root.querySelector<HTMLStyleElement>(
    ":scope > style[data-embed-pseudo-suppression]",
  );
  if (!suppression) {
    suppression = root.ownerDocument.createElement("style");
    suppression.dataset.embedPseudoSuppression = "true";
    root.prepend(suppression);
  }
  suppression.textContent =
    '[data-embed-materialized-before="true"]::before { content: none !important; }\n' +
    '[data-embed-materialized-after="true"]::after { content: none !important; }';
}

function materializeElementPseudo(el: HTMLElement, pseudoName: "before" | "after"): void {
  const existing = el.querySelector<HTMLElement>(
    `:scope > [data-embed-pseudo="${pseudoName}"][data-embed-generated-pseudo="true"]`,
  );
  if (existing) existing.remove();

  const marker = `data-embed-materialized-${pseudoName}`;
  // A previous materialization may already have installed the suppression
  // rule. Temporarily unmark this element so getComputedStyle can see the
  // source pseudo-element again when content is refreshed.
  el.removeAttribute(marker);

  const pseudo = window.getComputedStyle(el, `::${pseudoName}`);
  if (pseudo.content === "none") return;

  const pseudoEl = document.createElement("span");
  pseudoEl.dataset.embedPseudo = pseudoName;
  pseudoEl.dataset.embedGeneratedPseudo = "true";
  pseudoEl.setAttribute("aria-hidden", "true");

  for (let i = 0; i < pseudo.length; i++) {
    const prop = pseudo[i];
    const value = pseudo.getPropertyValue(prop);
    if (value) pseudoEl.style.setProperty(prop, value);
  }

  pseudoEl.textContent = parsePseudoContent(pseudo.content);
  if (!pseudoEl.textContent) return;

  if (pseudoName === "before") el.prepend(pseudoEl);
  else el.append(pseudoEl);
  el.setAttribute(marker, "true");
}

function parsePseudoContent(content: string): string {
  if (!content || content === "none" || content === "normal") return "";

  const quote = content[0];
  if ((quote !== "\"" && quote !== "'") || content[content.length - 1] !== quote) {
    return "";
  }

  return decodeCssStringValue(content.slice(1, -1));
}

function decodeCssStringValue(value: string): string {
  let out = "";

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }

    const next = value[i + 1];
    if (!next) break;

    if (next === "\n" || next === "\r" || next === "\f") {
      i += 1;
      continue;
    }

    if (/[0-9a-fA-F]/.test(next)) {
      let hex = "";
      let j = i + 1;
      while (j < value.length && hex.length < 6 && /[0-9a-fA-F]/.test(value[j])) {
        hex += value[j];
        j += 1;
      }
      const codePoint = parseInt(hex, 16);
      if (Number.isFinite(codePoint)) {
        out += String.fromCodePoint(codePoint);
      }
      if (j < value.length && /\s/.test(value[j])) j += 1;
      i = j - 1;
      continue;
    }

    out += next;
    i += 1;
  }

  return out;
}
