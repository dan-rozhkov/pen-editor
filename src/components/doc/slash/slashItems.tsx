import type { ReactNode } from "react";
import type { Editor, Range } from "@tiptap/react";
import type { ResolvedPos } from "@tiptap/pm/model";
import { ImageIcon, ListDashesIcon, MinusIcon, TableIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { TURN_INTO_ITEMS } from "../ui/blockTransforms";

/** The image URL popover (`ImagePrompt`) listens for this on the editor DOM. */
export const IMAGE_PROMPT_EVENT = "doc-image-prompt";

export interface SlashItem {
  id: string;
  title: string;
  hint: string;
  keywords: string[];
  icon: ReactNode;
  /** Cannot live inside a table cell or header (a nested table, or a list that would split the table). */
  hideInTable?: boolean;
  /** The caller removes the "/query" range first (`runSlashItem`). */
  run: (editor: Editor, chain: ReturnType<Editor["chain"]>) => void;
}

const TURN_INTO_SLASH: SlashItem[] = TURN_INTO_ITEMS.map((item) => ({
  id: item.id,
  title: item.label,
  hint: item.hint,
  keywords: item.keywords,
  icon: item.icon,
  run: (_editor, chain) => item.apply(chain).run(),
}));

function byId(id: string): SlashItem {
  return TURN_INTO_SLASH.find((item) => item.id === id)!;
}

export const SLASH_ITEMS: SlashItem[] = [
  byId("text"),
  byId("h1"),
  byId("h2"),
  byId("h3"),
  byId("bullet"),
  byId("ordered"),
  byId("todo"),
  byId("toggle"),
  byId("quote"),
  {
    id: "divider",
    title: "Divider",
    hint: "Visually divide blocks",
    keywords: ["hr", "rule", "line", "separator"],
    icon: <MinusIcon />,
    run: (_editor, chain) => chain.setHorizontalRule().run(),
  },
  byId("code"),
  {
    id: "mermaid",
    title: "Mermaid diagram",
    hint: "Flowchart from text",
    keywords: ["diagram", "chart", "flowchart", "graph"],
    icon: <TreeStructureIcon />,
    run: (_editor, chain) => chain.insertMermaid().run(),
  },
  {
    id: "table",
    title: "Table",
    hint: "3 × 3 with a header row",
    keywords: ["grid", "rows", "columns"],
    hideInTable: true,
    icon: <TableIcon />,
    run: (_editor, chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "properties",
    title: "Properties",
    hint: "Field and value pairs",
    keywords: ["properties", "fields", "property", "key value", "свойства"],
    hideInTable: true,
    icon: <ListDashesIcon />,
    run: (_editor, chain) => chain.insertPropertyList().run(),
  },
  {
    id: "image",
    title: "Image",
    hint: "Embed from a link",
    keywords: ["picture", "photo", "img", "url"],
    icon: <ImageIcon />,
    run: (editor, chain) => {
      chain.run();
      editor.view.dom.dispatchEvent(new CustomEvent(IMAGE_PROMPT_EVENT));
    },
  },
];

/** The items that make sense at `$pos`: block items that cannot live in a table cell are dropped there. */
export function slashItemsAt($pos: ResolvedPos, items: SlashItem[] = SLASH_ITEMS): SlashItem[] {
  let inTable = false;
  for (let depth = $pos.depth; depth > 0; depth -= 1) inTable = inTable || TABLE_CELLS.has($pos.node(depth).type.name);
  return inTable ? items.filter((item) => !item.hideInTable) : items;
}

const TABLE_CELLS = new Set(["tableCell", "tableHeader"]);

/** Case-insensitive; title prefix first, then title substring, then keywords. */
export function filterSlashItems(query: string, items: SlashItem[] = SLASH_ITEMS): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const rank = (item: SlashItem): number => {
    const title = item.title.toLowerCase();
    if (title.startsWith(q)) return 0;
    if (title.split(" ").some((word) => word.startsWith(q))) return 1;
    if (title.includes(q)) return 2;
    return item.keywords.some((keyword) => keyword.startsWith(q)) ? 3 : -1;
  };
  return items
    .map((item, index) => ({ item, index, score: rank(item) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.item);
}

/** Removes the typed "/query" and runs the item as one undo step. */
export function runSlashItem(editor: Editor, range: Range, item: SlashItem): void {
  item.run(editor, editor.chain().focus().deleteRange(range));
}
