// External font-stylesheet hoisting now lives in a layering-neutral module under
// src/utils so every shadow-DOM mount (via mountHtmlWithBodyStyles) can share it.
// Re-exported here so the texture path (renderHtmlToTexture) keeps its import.
export {
  extractExternalFontStylesheetUrls,
  ensureExternalFontStylesLoaded,
} from "@/utils/fontStylesheets";

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
