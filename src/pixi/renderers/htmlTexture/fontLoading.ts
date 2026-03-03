/** Dedup stylesheet loads for external web-font providers */
const pendingFontStylesheets = new Map<string, Promise<void>>();

function extractGoogleFontStylesheetUrls(html: string): string[] {
  const urls = new Set<string>();
  const patterns: [RegExp, number][] = [
    [/href=["'](https?:\/\/fonts\.googleapis\.com\/[^"']+)["']/gi, 1],
    [/@import\s+url\((['"]?)(https?:\/\/fonts\.googleapis\.com\/[^'")]+)\1\)/gi, 2],
  ];

  for (const [pattern, urlGroup] of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(html)) !== null) {
      const url = (match[urlGroup] ?? "").trim();
      if (url) urls.add(url);
    }
  }

  return [...urls];
}

function ensureFontStylesheetLoaded(url: string): Promise<void> {
  const pending = pendingFontStylesheets.get(url);
  if (pending) return pending;

  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  const tracked = promise.finally(() => { pendingFontStylesheets.delete(url); });
  pendingFontStylesheets.set(url, tracked);

  const existing = document.head.querySelector<HTMLLinkElement>(
    `link[data-embed-font-url="${CSS.escape(url)}"]`,
  );
  if (existing) {
    if ((existing.sheet as CSSStyleSheet | null) != null) {
      resolve();
    } else {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", resolve, { once: true });
    }
    return tracked;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.dataset.embedFontUrl = url;
  link.onload = resolve;
  link.onerror = resolve;
  document.head.appendChild(link);
  return tracked;
}

export async function ensureExternalFontStylesLoaded(html: string): Promise<void> {
  if (typeof document === "undefined") return;
  const urls = extractGoogleFontStylesheetUrls(html);
  if (urls.length === 0) return;

  await Promise.all(urls.map((url) => ensureFontStylesheetLoaded(url)));
}

function collectComputedFontFamilies(root: Element): string[] {
  const families = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const parent = node.parentElement;
    if (!parent) continue;
    const family = window.getComputedStyle(parent).fontFamily?.trim();
    if (family) families.add(family);
  }
  return [...families];
}

export async function waitForFontsUsedInTree(root: Element): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;

  const families = collectComputedFontFamilies(root);
  if (families.length === 0) return;

  const loadPromises = families.map((family) =>
    document.fonts.load(`16px ${family}`),
  );

  // Do not block rendering indefinitely on font providers.
  const timeoutMs = 1200;
  await Promise.race([
    Promise.allSettled(loadPromises),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
