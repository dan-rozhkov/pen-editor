import type { ReactNode } from "react";
import type { ChainedCommands, Editor } from "@tiptap/react";
import {
  CaretRightIcon,
  CodeBlockIcon,
  ListBulletsIcon,
  ListChecksIcon,
  ListNumbersIcon,
  QuotesIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  TextTIcon,
} from "@phosphor-icons/react";

export interface TurnIntoItem {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  icon: ReactNode;
  isActive: (editor: Editor) => boolean;
  /** Converts the block(s) at the selection. Starts with `clearNodes()` so any source block type works. */
  apply: (chain: ChainedCommands) => ChainedCommands;
}

/** The block types Notion's "Turn into" offers; the slash menu reuses them. */
export const TURN_INTO_ITEMS: TurnIntoItem[] = [
  {
    id: "text",
    label: "Text",
    hint: "Plain paragraph",
    keywords: ["paragraph", "plain"],
    icon: <TextTIcon />,
    isActive: (e) => e.isActive("paragraph") && !e.isActive("blockquote") && !e.isActive("listItem") && !e.isActive("taskItem"),
    apply: (c) => c.clearNodes().setParagraph(),
  },
  {
    id: "h1",
    label: "Heading 1",
    hint: "Big section heading",
    keywords: ["h1", "title", "heading"],
    icon: <TextHOneIcon />,
    isActive: (e) => e.isActive("heading", { level: 1 }),
    apply: (c) => c.clearNodes().setHeading({ level: 1 }),
  },
  {
    id: "h2",
    label: "Heading 2",
    hint: "Medium section heading",
    keywords: ["h2", "subtitle", "heading"],
    icon: <TextHTwoIcon />,
    isActive: (e) => e.isActive("heading", { level: 2 }),
    apply: (c) => c.clearNodes().setHeading({ level: 2 }),
  },
  {
    id: "h3",
    label: "Heading 3",
    hint: "Small section heading",
    keywords: ["h3", "heading"],
    icon: <TextHThreeIcon />,
    isActive: (e) => e.isActive("heading", { level: 3 }),
    apply: (c) => c.clearNodes().setHeading({ level: 3 }),
  },
  {
    id: "bullet",
    label: "Bulleted list",
    hint: "A simple list",
    keywords: ["ul", "unordered", "list", "bullets"],
    icon: <ListBulletsIcon />,
    isActive: (e) => e.isActive("bulletList"),
    apply: (c) => c.clearNodes().toggleBulletList(),
  },
  {
    id: "ordered",
    label: "Numbered list",
    hint: "A list with numbers",
    keywords: ["ol", "ordered", "list", "numbers"],
    icon: <ListNumbersIcon />,
    isActive: (e) => e.isActive("orderedList"),
    apply: (c) => c.clearNodes().toggleOrderedList(),
  },
  {
    id: "todo",
    label: "To-do list",
    hint: "Track tasks with checkboxes",
    keywords: ["task", "checkbox", "checklist", "todo"],
    icon: <ListChecksIcon />,
    isActive: (e) => e.isActive("taskList"),
    apply: (c) => c.clearNodes().toggleTaskList(),
  },
  {
    id: "toggle",
    label: "Toggle list",
    hint: "Hide content inside a toggle",
    keywords: ["details", "collapse", "accordion", "toggle"],
    icon: <CaretRightIcon />,
    isActive: (e) => e.isActive("details"),
    apply: (c) => c.clearNodes().setDetails(),
  },
  {
    id: "quote",
    label: "Quote",
    hint: "Capture a quote",
    keywords: ["blockquote", "citation"],
    icon: <QuotesIcon />,
    isActive: (e) => e.isActive("blockquote"),
    apply: (c) => c.clearNodes().setBlockquote(),
  },
  {
    id: "code",
    label: "Code",
    hint: "Code block",
    keywords: ["codeblock", "snippet", "pre"],
    icon: <CodeBlockIcon />,
    isActive: (e) => e.isActive("codeBlock"),
    apply: (c) => c.clearNodes().setCodeBlock(),
  },
];

/** Applies a turn-into item to the current selection (no-op when it is already that type). */
export function turnInto(editor: Editor, item: TurnIntoItem): void {
  if (item.isActive(editor)) return;
  item.apply(editor.chain().focus()).run();
}

/** The label of the block type at the selection, "Text" when nothing matches. */
export function activeBlockLabel(editor: Editor): string {
  const order = [...TURN_INTO_ITEMS].reverse(); // list/quote/code win over the inner paragraph
  return (order.find((item) => item.id !== "text" && item.isActive(editor)) ?? TURN_INTO_ITEMS[0]).label;
}
