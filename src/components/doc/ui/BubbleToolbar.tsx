import { useEffect, useMemo, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  CaretDownIcon,
  CodeIcon,
  PaletteIcon,
  TextBIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatShortcut } from "@/lib/commands/shortcutFormat";
import { getActiveDocColor } from "../docExtensions";
import { bubbleVisible, createHolds } from "./bubbleRules";
import { activeBlockLabel, TURN_INTO_ITEMS, turnInto } from "./blockTransforms";
import { ColorPanel } from "./ColorPanel";
import { LinkPopover } from "./LinkPopover";
import { MENU_SURFACE, POPOVER_SURFACE } from "./menuSurface";
import { cn } from "@/lib/utils";

const MARKS = [
  { name: "bold", label: "Bold", keys: ["mod", "B"], icon: <TextBIcon />, run: (e: Editor) => e.chain().focus().toggleBold().run() },
  { name: "italic", label: "Italic", keys: ["mod", "I"], icon: <TextItalicIcon />, run: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { name: "strike", label: "Strikethrough", keys: ["mod", "shift", "X"], icon: <TextStrikethroughIcon />, run: (e: Editor) => e.chain().focus().toggleStrike().run() },
  { name: "code", label: "Code", keys: ["mod", "E"], icon: <CodeIcon />, run: (e: Editor) => e.chain().focus().toggleCode().run() },
] as const;

/**
 * Selection toolbar (Notion style): Turn into, Bold, Italic, Strike, Code, Link, Colour.
 * Popups render in portals, so while one is open the bubble must not hide on blur.
 */
export function BubbleToolbar({ editor }: { editor: Editor }) {
  const [holds] = useState(createHolds);
  const [linkOpen, setLinkOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  // One open path for the Link button and Mod-K, so both hold the bubble open.
  const changeLink = useMemo(() => holds.handler("link", setLinkOpen), [holds]);
  const changeColor = useMemo(() => holds.handler("color", setColorOpen), [holds]);
  const changeTurn = useMemo(() => holds.handler("turn"), [holds]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: activeBlockLabel(e),
      marks: MARKS.filter((m) => e.isActive(m.name)).map((m) => m.name),
      link: e.isActive("link"),
      colors: getActiveDocColor(e),
    }),
  });

  // Mod-K opens the link popover for the current selection.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        if (!bubbleVisible(editor.state, true, editor.isEditable)) return;
        event.preventDefault();
        changeLink(true);
      }
    };
    const dom = editor.view.dom;
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editor, changeLink]);

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ state: s, view, element }) =>
        bubbleVisible(s, view.hasFocus() || holds.any() || element.contains(document.activeElement), editor.isEditable)
      }
    >
      <div role="toolbar" aria-label="Text formatting" className={cn(MENU_SURFACE, "flex items-center gap-0.5 p-1")}>
        <DropdownMenu onOpenChange={changeTurn}>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label="Turn into" className="text-popover-foreground" />}>
            {state.block} <CaretDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" finalFocus={false} className="w-auto min-w-44">
            {TURN_INTO_ITEMS.map((item) => (
              <DropdownMenuItem key={item.id} onClick={() => turnInto(editor, item)}>
                {item.icon} {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span aria-hidden className="bg-popover-foreground/20 mx-0.5 h-4 w-px" />
        {MARKS.map((mark) => {
          const active = state.marks.includes(mark.name);
          return (
            <IconButton
              key={mark.name}
              tooltip={mark.label}
              shortcut={formatShortcut([...mark.keys])}
              variant="ghost"
              size="icon-sm"
              aria-pressed={active}
              className={active ? "bg-accent-primary text-white hover:bg-accent-primary/90 hover:text-white" : "text-popover-foreground/70"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => mark.run(editor)}
            >
              {mark.icon}
            </IconButton>
          );
        })}
        <LinkPopover
          editor={editor}
          active={state.link}
          open={linkOpen}
          onOpenChange={changeLink}
        />
        <Popover
          open={colorOpen}
          onOpenChange={changeColor}
        >
          <PopoverTrigger
            render={
              <IconButton tooltip="Colour" variant="ghost" size="icon-sm" className="text-popover-foreground/70">
                <PaletteIcon />
              </IconButton>
            }
          />
          <PopoverContent side="bottom" align="start" sideOffset={6} className={cn(POPOVER_SURFACE, "p-0")}>
            <ColorPanel
              activeText={state.colors.color}
              activeBackground={state.colors.background}
              onText={(color) => editor.chain().focus().setDocColor({ color }).run()}
              onBackground={(background) => editor.chain().focus().setDocColor({ background }).run()}
              onClear={() => editor.chain().focus().unsetDocColor().run()}
            />
          </PopoverContent>
        </Popover>
      </div>
    </BubbleMenu>
  );
}
