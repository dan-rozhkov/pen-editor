export interface PrototypeFile {
  name: string;
  content: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Wrap a screen's linked body HTML into a standalone, self-contained
 * document so each `.html` file in the zip opens correctly on its own via
 * `file://`. `headHtml` carries the screen's `<head>` content (styles/links
 * the parser hoisted out of the fragment) so the prototype keeps its CSS. */
export function wrapAsDocument(
  bodyHtml: string,
  title: string,
  headHtml = "",
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${headHtml}
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** Plan the final set of prototype files: one standalone document per
 * screen (named `<slug>.html`) plus an `index.html` that meta-refresh
 * redirects to the start screen. No JS injection — works from `file://`. */
export function planPrototypeFiles(
  screens: { id: string; name: string; linkedHtml: string; headHtml?: string }[],
  startId: string,
  slugs: Map<string, string>,
): PrototypeFile[] {
  const files: PrototypeFile[] = screens.map((s) => ({
    name: `${slugs.get(s.id)!}.html`,
    content: wrapAsDocument(s.linkedHtml, s.name, s.headHtml),
  }));
  const startSlug = slugs.get(startId)!;
  files.push({
    name: "index.html",
    content: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${startSlug}.html"></head><body></body></html>`,
  });
  return files;
}
