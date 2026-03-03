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
}

function materializeElementPseudo(el: HTMLElement, pseudoName: "before" | "after"): void {
  const existing = el.querySelector<HTMLElement>(
    `:scope > [data-embed-pseudo="${pseudoName}"][data-embed-generated-pseudo="true"]`,
  );
  if (existing) existing.remove();

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

  if (pseudoName === "before") el.prepend(pseudoEl);
  else el.append(pseudoEl);
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
