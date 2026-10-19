import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Strike from "@tiptap/extension-strike";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

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
  StarterKit.configure({ strike: false }),
  DocStrike,
  Markdown,
  Table,
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Image,
];
