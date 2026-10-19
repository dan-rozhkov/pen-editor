// Pure edit logic for the agent's doc_edit tool: ordered find-and-replace over
// a markdown string. Atomic: every edit is validated against the text produced
// by the edits before it, and the caller gets either the new text or one error.

export interface DocEdit {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export type ApplyDocEditsResult = { ok: true; markdown: string; applied: number } | { ok: false; error: string };

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

export function applyDocEdits(markdown: string, edits: readonly DocEdit[]): ApplyDocEditsResult {
  let text = markdown;
  for (let i = 0; i < edits.length; i++) {
    const { oldString, newString, replaceAll } = edits[i];
    if (typeof oldString !== "string" || typeof newString !== "string") {
      return { ok: false, error: `Edit ${i}: oldString and newString must be strings.` };
    }
    if (oldString === "") return { ok: false, error: `Edit ${i}: oldString must not be empty.` };
    const found = countOccurrences(text, oldString);
    if (found === 0) return { ok: false, error: `Edit ${i}: oldString was not found (0 matches). Nothing was changed.` };
    if (found > 1 && !replaceAll) {
      return {
        ok: false,
        error: `Edit ${i}: oldString was found ${found} times. Add more context to make it unique, or set replaceAll. Nothing was changed.`,
      };
    }
    // split/join replaces every occurrence literally ($ patterns in newString stay literal).
    text = replaceAll ? text.split(oldString).join(newString) : text.replace(oldString, () => newString);
  }
  return { ok: true, markdown: text, applied: edits.length };
}
