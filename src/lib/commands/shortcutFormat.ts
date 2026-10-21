/**
 * Formats a keyboard shortcut for display, platform-aware (⌘ on Mac,
 * Ctrl on everything else — matching how browsers/OSes commonly present
 * modifier keys). `parts` are combined in order, e.g.
 * `formatShortcut(["mod", "shift", "Z"])` → "⌘⇧Z" on Mac, "Ctrl+Shift+Z"
 * elsewhere.
 */
export type ShortcutPart = "mod" | "shift" | "alt" | string;

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform || navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
};

const OTHER_LABELS: Record<string, string> = {
  mod: "Ctrl",
  shift: "Shift",
  alt: "Alt",
};

export function formatShortcut(parts: ShortcutPart[], isMac = isMacPlatform()): string {
  if (isMac) {
    return parts.map((p) => MAC_SYMBOLS[p] ?? p).join("");
  }
  return parts.map((p) => OTHER_LABELS[p] ?? p).join("+");
}

const MAC_MODIFIER_SYMBOLS = new Set(["⌘", "⇧", "⌥", "⌃"]);

/** Splits a string produced by `formatShortcut` back into its key labels ("⌘⇧Z" -> ⌘, ⇧, Z; "Ctrl+Z" -> Ctrl, Z). */
export function splitShortcut(shortcut: string): string[] {
  if (shortcut.length > 1 && shortcut.includes("+")) {
    // A trailing "+" is the plus key itself ("Ctrl++").
    const keys = shortcut.endsWith("++") ? [...shortcut.slice(0, -2).split("+"), "+"] : shortcut.split("+");
    return keys.filter(Boolean);
  }
  const chars = [...shortcut];
  const keys: string[] = [];
  let i = 0;
  while (i < chars.length - 1 && MAC_MODIFIER_SYMBOLS.has(chars[i])) keys.push(chars[i++]);
  keys.push(chars.slice(i).join(""));
  return keys;
}
