import type { Node as PMNode } from "@tiptap/pm/model";
import { isDocColor, type DocColor } from "../docPalette";

// Pure helpers behind the property row's "Option" picker. A tag value is a value made only of background-
// highlighted text; its options are the distinct tags other rows with the same key already use.

export interface TagOccurrence {
  text: string;
  color: DocColor;
}

export interface TagOption extends TagOccurrence {
  count: number;
}

export const normalizeKey = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

const unescapePipes = (text: string): string => text.replace(/\\\|/g, "|");

/** Split a table line into cells at unescaped pipes; `null` unless it starts with one. */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const cells: string[] = [];
  let current = "";
  for (let i = 1; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && i + 1 < trimmed.length) {
      current += ch + trimmed[i + 1];
      i += 1;
    } else if (ch === "|") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) cells.push(current);
  return cells;
}

const OWN_HEADER = /^\|[ \t]{0,2}\|[ \t]{0,2}\|[ \t]*$/;
const DELIMITER = /^\|[ \t]*:?-+:?[ \t]*\|[ \t]*:?-+:?[ \t]*\|[ \t]*$/;
const SPAN = /<span\b([^>]*)>([^<]*)<\/span\s*>/gi;

/** Each `<span data-bg="NAME">Text</span>` of a cell that holds nothing else; `[]` for any other value. */
function tagsOfCell(cell: string): TagOccurrence[] {
  const out: TagOccurrence[] = [];
  const rest = cell.replace(SPAN, (_all, attrs: string, inner: string) => {
    const color = /\bdata-bg\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    const text = unescapePipes(inner).trim();
    if (text && isDocColor(color)) out.push({ text, color });
    return "";
  });
  return rest.trim() || out.length === 0 ? [] : out;
}

/** Every tag used as the value of a property row whose key is `key`, in document order. */
export function tagOccurrences(markdown: string, key: string): TagOccurrence[] {
  const wanted = normalizeKey(key);
  const lines = markdown.split(/\r?\n/);
  const out: TagOccurrence[] = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(```|~~~)/.test(lines[i])) fenced = !fenced;
    if (fenced || !OWN_HEADER.test(lines[i].trim()) || !DELIMITER.test((lines[i + 1] ?? "").trim())) continue;
    for (let r = i + 2; r < lines.length; r += 1) {
      const cells = splitRow(lines[r]);
      if (!cells) break;
      if (cells.length === 2 && normalizeKey(unescapePipes(cells[0])) === wanted) out.push(...tagsOfCell(cells[1]));
    }
  }
  return out;
}

/** Dedupe by text (case-insensitive), keep the first colour, order by frequency then alphabetically. */
export function rankTagOptions(occurrences: TagOccurrence[]): TagOption[] {
  const byText = new Map<string, TagOption>();
  for (const { text, color } of occurrences) {
    const id = text.toLowerCase();
    const known = byText.get(id);
    if (known) known.count += 1;
    else byText.set(id, { text, color, count: 1 });
  }
  return [...byText.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}

export function collectTagOptions(markdownDocs: string[], key: string): TagOption[] {
  return rankTagOptions(markdownDocs.flatMap((markdown) => tagOccurrences(markdown, key)));
}

/** Tags of the rows named `key` in a live document (adjacent runs with one background form one chip). */
export function docTagOccurrences(doc: PMNode, key: string): TagOccurrence[] {
  const wanted = normalizeKey(key);
  const out: TagOccurrence[] = [];
  doc.descendants((row) => {
    if (row.type.name !== "propertyRow") return row.type.name === "propertyList";
    const [keyNode, value] = [row.firstChild, row.lastChild];
    if (!keyNode || !value || normalizeKey(keyNode.textContent) !== wanted) return false;
    let chip: TagOccurrence | null = null;
    let allTagged = true;
    const chips: TagOccurrence[] = [];
    value.forEach((child) => {
      const color = child.marks.find((mark) => mark.type.name === "docColor")?.attrs.background;
      if (!child.isText || !isDocColor(color)) {
        allTagged = false;
        chip = null;
      } else if (chip?.color === color) {
        chip.text += child.text ?? "";
      } else {
        chip = { text: child.text ?? "", color };
        chips.push(chip);
      }
    });
    if (allTagged) out.push(...chips.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text));
    return false;
  });
  return out;
}

/** `YYYY-MM-DD` for a date value the row recognises, else `null` (times and ranges are not date-input values). */
export function toIsoDate(text: string): string | null {
  const trimmed = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(trimmed);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : parsedParts(trimmed);
  if (!parts) return null;
  const [y, m, d] = parts;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parsedParts(text: string): [number, number, number] | null {
  if (/→/.test(text) || !/[a-z]/i.test(text)) return null;
  const time = Date.parse(text);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}
