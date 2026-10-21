import { useMemo, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { CalendarBlankIcon, CheckIcon, ListBulletsIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDoc, listDocs } from "@/lib/docs/docStore";
import { cn } from "@/lib/utils";
import { DOC_COLORS, type DocColor } from "../docPalette";
import { MENU_HOVER, MENU_INPUT } from "../ui/menuSurface";
import { clearProperty, setPropertyDate, setPropertyOption } from "./propertyEdits";
import { docTagOccurrences, rankTagOptions, tagOccurrences, toIsoDate, type TagOption } from "./propertyOptions";

const ITEM = cn(MENU_HOVER, "text-popover-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm");
const cap = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

function run(getRowPos: () => number | undefined, edit: (pos: number) => boolean): void {
  const pos = getRowPos();
  if (pos !== undefined) edit(pos);
}

/** Markdown of every stored document; never throws (storage may be blocked). */
function storedMarkdowns(): string[] {
  try {
    return listDocs().flatMap((meta) => getDoc(meta.id)?.markdown ?? []);
  } catch {
    return [];
  }
}

interface Props {
  editor: Editor;
  /** Read at commit time: earlier edits can shift the row. */
  getRowPos: () => number | undefined;
  keyText: string;
  valueText: string;
  currentTag: { text: string } | null;
  onDone: () => void;
}

type View = "menu" | "date" | "option";

/** Body of the popover behind the row icon: pick a value type (date / option) or clear the value. */
export function PropertyValueMenu(props: Props) {
  const [view, setView] = useState<View>("menu");
  const { editor, getRowPos, onDone } = props;
  return (
    <div className="doc-palette text-popover-foreground flex flex-col gap-0.5" onMouseDown={(event) => event.stopPropagation()}>
      {view === "menu" && (
        <div role="menu" aria-label="Value type" className="flex flex-col gap-0.5">
          <MenuItem icon={<CalendarBlankIcon size={16} />} label="Date" onPick={() => setView("date")} />
          <MenuItem icon={<ListBulletsIcon size={16} />} label="Option" onPick={() => setView("option")} />
          <MenuItem
            icon={<XIcon size={16} />}
            label="Clear"
            onPick={() => {
              run(getRowPos, (pos) => clearProperty(editor, pos));
              onDone();
            }}
          />
        </div>
      )}
      {view === "date" && <DatePicker {...props} />}
      {view === "option" && <OptionPicker {...props} />}
    </div>
  );
}

function MenuItem({ icon, label, onPick }: { icon: ReactNode; label: string; onPick: () => void }) {
  return (
    <button type="button" role="menuitem" className={ITEM} onClick={onPick}>
      <span className="text-popover-foreground/60 flex">{icon}</span>
      {label}
    </button>
  );
}

/** A complete YYYY-MM-DD with a four-digit year: a native date input reports "0002-05-03" while a year is typed. */
function isCommittableDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1000;
}

function DatePicker({ editor, getRowPos, valueText, onDone }: Props) {
  const [value, setValue] = useState(() => toIsoDate(valueText) ?? "");
  const valid = isCommittableDate(value);
  const commit = () => {
    if (!valid) return;
    run(getRowPos, (pos) => setPropertyDate(editor, pos, value));
    onDone();
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        type="date"
        className={MENU_INPUT}
        aria-label="Date"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
      />
      <Button type="button" size="sm" disabled={!valid} onClick={commit}>
        Set
      </Button>
    </div>
  );
}

function OptionPicker({ editor, getRowPos, keyText, currentTag, onDone }: Props) {
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<DocColor>("gray");
  // Computed once, when this view opens: the live document first (its colours win), then every stored one.
  const options = useMemo<TagOption[]>(
    () => rankTagOptions([...docTagOccurrences(editor.state.doc, keyText), ...storedMarkdowns().flatMap((md) => tagOccurrences(md, keyText))]),
    [editor, keyText],
  );
  const needle = query.trim().toLowerCase();
  const shown = options.filter((option) => option.text.toLowerCase().includes(needle));
  const canCreate = needle !== "" && !options.some((option) => option.text.toLowerCase() === needle);
  const pick = (text: string, tagColor: DocColor) => {
    run(getRowPos, (pos) => setPropertyOption(editor, pos, text, tagColor));
    onDone();
  };
  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        className={MENU_INPUT}
        aria-label="Filter options"
        placeholder="Search or create an option"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = shown[0];
          if (first) pick(first.text, first.color);
          else if (canCreate) pick(query, color);
        }}
      />
      <div role="listbox" aria-label="Options" className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        {shown.map((option) => {
          const selected = currentTag?.text.toLowerCase() === option.text.toLowerCase();
          return (
            <button key={option.text} type="button" role="option" aria-selected={selected} className={ITEM} onClick={() => pick(option.text, option.color)}>
              <span data-bg={option.color} className="doc-chip rounded px-1.5">
                {option.text}
              </span>
              {selected && <CheckIcon size={14} className="ml-auto" />}
            </button>
          );
        })}
        {shown.length === 0 && !canCreate && <span className="text-popover-foreground/60 px-2 py-1.5 text-xs">No options yet</span>}
      </div>
      {canCreate && (
        <>
          <button type="button" className={ITEM} onClick={() => pick(query, color)}>
            <PlusIcon size={14} />
            <span className="truncate">Create “{query.trim()}”</span>
          </button>
          <div role="group" aria-label="Colour" className="grid grid-cols-9 gap-1 px-2 pb-1">
            {DOC_COLORS.map((name) => (
              <button
                key={name}
                type="button"
                aria-label={cap(name)}
                aria-pressed={color === name}
                onClick={() => setColor(name)}
                className={cn("flex size-5 items-center justify-center rounded-md", color === name && "ring-accent-primary ring-2")}
              >
                <span data-bg={name} className="size-4 !p-0 ring-1 ring-popover-foreground/20" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
