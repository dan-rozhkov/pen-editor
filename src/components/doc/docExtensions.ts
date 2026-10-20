import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Strike from "@tiptap/extension-strike";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { DocTableFilter } from "./table/tableFilter";
import { DocCodeBlock } from "./extensions/docCodeBlock";
import { DocColorMark, getActiveDocColor } from "./extensions/docColor";
import { DocPropertyKeys, DocTable, PropertyKey, PropertyList, PropertyRow, PropertyValue } from "./extensions/docProperties";
import { DocDetails, DocDetailsContent, DocDetailsSummary } from "./extensions/docDetails";

// Cmd+Shift+S is the desktop menu's "Export as .json". Strike's default chord is
// exactly that, and `extend` replaces (not merges) its shortcuts, so strike moves to
// Mod-Shift-x and Mod-Shift-s stays unbound.
export const DocStrike = Strike.extend({
  addKeyboardShortcuts() {
    return { "Mod-Shift-x": () => this.editor.commands.toggleStrike() };
  },
});

/** Everything the agent can write as GFM markdown must survive a load/save round trip. */
export const DOC_EXTENSIONS = [
  StarterKit.configure({ strike: false, codeBlock: false }),
  DocCodeBlock,
  DocStrike,
  Markdown,
  // The editor's own node view (TableView, used while `resizable` is off) already renders the
  // div.tableWrapper that scrolls sideways when the columns outgrow the document column.
  DocTable,
  TableRow,
  TableHeader,
  TableCell,
  DocTableFilter,
  TaskList,
  TaskItem.configure({ nested: true }),
  Image,
  DocDetails,
  DocDetailsSummary,
  DocDetailsContent,
  DocColorMark,
  PropertyList,
  PropertyRow,
  PropertyKey,
  PropertyValue,
  DocPropertyKeys,
];

export { getActiveDocColor };
export { MERMAID_SAMPLE } from "./extensions/docCodeBlock";
