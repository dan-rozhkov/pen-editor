import type { ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  CodeBlockIcon,
  CodeIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  QuotesIcon,
  TextBIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
} from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/IconButton";
import { formatShortcut } from "@/lib/commands/shortcutFormat";

interface Item {
  key: string;
  label: string;
  shortcut: string;
  icon: ReactNode;
  active: (e: Editor) => boolean;
  run: (e: Editor) => void;
}


const GROUPS: Item[][] = [
  [
    { key: "bold", label: "Bold", shortcut: formatShortcut(["mod","B"]), icon: <TextBIcon />, active: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
    { key: "italic", label: "Italic", shortcut: formatShortcut(["mod","I"]), icon: <TextItalicIcon />, active: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
    { key: "strike", label: "Strikethrough", shortcut: formatShortcut(["mod","shift","X"]), icon: <TextStrikethroughIcon />, active: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
    { key: "code", label: "Code", shortcut: formatShortcut(["mod","E"]), icon: <CodeIcon />, active: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
  ],
  [
    { key: "h1", label: "Heading 1", shortcut: formatShortcut(["mod","alt","1"]), icon: <TextHOneIcon />, active: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { key: "h2", label: "Heading 2", shortcut: formatShortcut(["mod","alt","2"]), icon: <TextHTwoIcon />, active: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { key: "h3", label: "Heading 3", shortcut: formatShortcut(["mod","alt","3"]), icon: <TextHThreeIcon />, active: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  ],
  [
    { key: "bullet", label: "Bulleted list", shortcut: formatShortcut(["mod","shift","8"]), icon: <ListBulletsIcon />, active: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
    { key: "ordered", label: "Numbered list", shortcut: formatShortcut(["mod","shift","7"]), icon: <ListNumbersIcon />, active: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { key: "quote", label: "Quote", shortcut: formatShortcut(["mod","shift","B"]), icon: <QuotesIcon />, active: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
    { key: "codeblock", label: "Code block", shortcut: formatShortcut(["mod","alt","C"]), icon: <CodeBlockIcon />, active: (e) => e.isActive("codeBlock"), run: (e) => e.chain().focus().toggleCodeBlock().run() },
  ],
];

export function DocToolbar({ editor }: { editor: Editor | null }) {
  // Re-render on every transaction so the active states follow the selection.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? GROUPS.flat().filter((i) => i.active(e)).map((i) => i.key).join(",") : ""),
  });
  const activeKeys = new Set((active ?? "").split(","));
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
      {GROUPS.map((group, index) => (
        <div key={group[0].key} className="flex items-center gap-0.5">
          {index > 0 && <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border-default" />}
          {group.map((item) => (
            <IconButton
              key={item.key}
              tooltip={item.label}
              shortcut={item.shortcut}
              variant="ghost"
              size="icon-sm"
              disabled={!editor}
              aria-pressed={activeKeys.has(item.key)}
              className={activeKeys.has(item.key) ? "bg-secondary text-foreground" : "text-text-muted"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor && item.run(editor)}
            >
              {item.icon}
            </IconButton>
          ))}
        </div>
      ))}
    </div>
  );
}
