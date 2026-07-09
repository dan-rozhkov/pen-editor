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
