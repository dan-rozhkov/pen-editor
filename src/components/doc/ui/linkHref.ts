import type { Editor } from "@tiptap/react";

/** Normalises what the user typed: bare domains get https://, empty means "remove". */
export function normalizeLinkHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return /^([a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(value) ? value : `https://${value}`;
}

export function applyLink(editor: Editor, raw: string): void {
  const href = normalizeLinkHref(raw);
  const chain = editor.chain().focus().extendMarkRange("link");
  (href ? chain.setLink({ href }) : chain.unsetLink()).run();
}
