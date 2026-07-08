/**
 * Write text to the system clipboard. Tries the async Clipboard API first,
 * then falls back to a hidden `<textarea>` + `document.execCommand("copy")`
 * for contexts where `navigator.clipboard` is unavailable or throws (e.g.
 * insecure origins, some embedded/webview contexts). Swallows and warns on
 * failure rather than throwing, so callers can treat the return value as
 * the single source of truth for success/failure.
 */
export async function writeTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn("[clipboard] navigator.clipboard.writeText failed, falling back:", error);
  }
  return fallbackCopy(text);
}

function fallbackCopy(value: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch (error) {
    console.warn("[clipboard] execCommand fallback failed:", error);
    return false;
  }
}
