import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import { CopyIcon, DotsSixVerticalIcon, PaletteIcon, PlusIcon, TextTIcon, TrashIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/IconButton";
import { TURN_INTO_ITEMS, turnInto } from "../ui/blockTransforms";
import { skipBaseUiOpen } from "../ui/baseUi";
import { ColorPanel } from "../ui/ColorPanel";
import { firstLineHeight, handleTop, nearBlock, topLevelChild } from "./blockGeometry";
import { blockHasText, deleteBlock, resolveBlockPos, duplicateBlock, endBlockDrag, insertBelowAndOpenSlash, selectBlockText, startBlockDrag } from "./blockCommands";

interface Target {
  /** The hovered top-level block element; its document position is re-resolved on every use. */
  el: HTMLElement;
  top: number;
}

interface Props {
  editor: Editor;
  /** The `relative` element that wraps the editor; the handle sits in its left gutter. */
  containerRef: RefObject<HTMLElement | null>;
}

/** The top-level block under the pointer: from the event target, else from the pointer's y over the text column. */
function hoveredBlock(editor: Editor, event: MouseEvent): HTMLElement | null {
  const { view } = editor;
  const direct = topLevelChild(view.dom, event.target);
  // Widgets, gapcursors and other decorations are direct children too; only real blocks resolve.
  if (direct) return resolveBlockPos(editor, direct) !== null ? direct : null;
  const column = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({ left: column.left + 4, top: event.clientY });
  if (!hit) return null;
  const $pos = view.state.doc.resolve(hit.pos);
  const blockPos = $pos.depth >= 1 ? $pos.before(1) : $pos.nodeAfter ? hit.pos : -1;
  const dom = blockPos >= 0 ? view.nodeDOM(blockPos) : null;
  return dom instanceof HTMLElement && nearBlock(dom.getBoundingClientRect(), event.clientY) ? dom : null;
}

function isTopLevel(editor: Editor, el: HTMLElement): boolean {
  return el.isConnected && el.parentElement === editor.view.dom && resolveBlockPos(editor, el) !== null;
}

const WRAPPERS = new Set(["UL", "OL", "LI", "BLOCKQUOTE"]);

/** The element holding the block's first text line: lists and quotes wrap it in a padded paragraph. */
function firstLineElement(el: HTMLElement): HTMLElement {
  let line = el;
  while (WRAPPERS.has(line.tagName) && line.firstElementChild instanceof HTMLElement && line.firstElementChild.tagName !== "LABEL") {
    line = line.firstElementChild;
  }
  return line;
}

function targetFor(el: HTMLElement, container: HTMLElement): Target {
  const line = firstLineElement(el);
  const style = getComputedStyle(line);
  // Blocks are padded (Notion rhythm, code-block insets): centre on the text, not the border box.
  const textTop = line.getBoundingClientRect().top + (parseFloat(style.paddingTop) || 0);
  const top = handleTop(textTop, container.getBoundingClientRect().top, firstLineHeight(style.lineHeight, style.fontSize));
  return { el, top };
}

/** Notion's hover handle: "+" (insert below, opens the slash menu) and a grip (drag, block menu). */
export function BlockHandle({ editor, containerRef }: Props) {
  const [target, setTarget] = useState<Target | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Bumped on every document change while a target exists, so the block's node (type, text) is re-read. */
  const [, setVersion] = useState(0);
  const locked = useRef(false);
  const targetRef = useRef<Target | null>(null);
  // The ref is written synchronously with the state, so transaction listeners never read a stale target.
  const setTargetBoth = useCallback((next: Target | null | ((prev: Target | null) => Target | null)) => {
    const value = typeof next === "function" ? next(targetRef.current) : next;
    targetRef.current = value;
    setTarget(value);
  }, []);
  useEffect(() => {
    locked.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const onMove = (event: MouseEvent) => {
      if (locked.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = hoveredBlock(editor, event);
        if (!el) return;
        const next = targetFor(el, container);
        setTargetBoth((prev) => (prev && prev.el === el && prev.top === next.top ? prev : next));
      });
    };
    const hide = () => {
      if (!locked.current) setTargetBoth(null);
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      hide();
    };
    // Any document change (typing, agent writes with emitUpdate:false, undo) can move or delete the block.
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return;
      const prev = targetRef.current;
      if (!prev) return;
      if (!isTopLevel(editor, prev.el)) {
        setTargetBoth(null);
        setMenuOpen(false);
        return;
      }
      const next = targetFor(prev.el, container);
      if (next.top !== prev.top) setTargetBoth(next);
      setVersion((v) => v + 1);
    };
    const dom = editor.view.dom;
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    dom.addEventListener("keydown", hide);
    editor.on("transaction", onTransaction);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      dom.removeEventListener("keydown", hide);
      editor.off("transaction", onTransaction);
    };
  }, [editor, containerRef, setTargetBoth]);

  if (!target) return null;
  // Every command resolves the block's CURRENT position when it runs, never a cached number.
  const withPos = (action: (pos: number) => void) => () => {
    const pos = resolveBlockPos(editor, target.el);
    if (pos !== null) action(pos);
  };
  const closeAnd = (action: (pos: number) => void) => () => {
    withPos(action)();
    setMenuOpen(false);
  };
  const onBlock = (action: () => void) =>
    closeAnd((pos) => {
      selectBlockText(editor, pos);
      action();
    });
  const current = resolveBlockPos(editor, target.el);
  const textual = current !== null && blockHasText(editor, current);

  return (
    <div
      data-testid="block-handle"
      className="absolute right-full z-10 hidden gap-0.5 pr-1.5 sm:flex"
      style={{ top: target.top }}
    >
      <IconButton
        tooltip="Add block below"
        variant="ghost"
        size="icon-sm"
        className="text-text-muted"
        onMouseDown={(event) => event.preventDefault()}
        onClick={withPos((pos) => insertBelowAndOpenSlash(editor, pos))}
      >
        <PlusIcon />
      </IconButton>
      {/* Non-modal, and opened on click only: a modal menu opened on mousedown would put a backdrop under the drag. */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger
          render={
            <IconButton
              tooltip="Drag to move, click for menu"
              variant="ghost"
              size="icon-sm"
              className="text-text-muted cursor-grab active:cursor-grabbing"
              draggable
              onPointerDown={skipBaseUiOpen}
              onMouseDown={skipBaseUiOpen}
              onClick={(event: unknown) => {
                skipBaseUiOpen(event);
                setMenuOpen((open) => !open);
              }}
              onDragStart={(event: DragEvent) => withPos((pos) => startBlockDrag(editor, pos, event))()}
              onDragEnd={() => {
                endBlockDrag(editor);
              }}
            >
              <DotsSixVerticalIcon />
            </IconButton>
          }
        />
        <DropdownMenuContent align="start" side="bottom" finalFocus={false} className="w-auto min-w-44">
          <DropdownMenuItem onClick={closeAnd((pos) => deleteBlock(editor, pos))}>
            <TrashIcon /> Delete
          </DropdownMenuItem>
          <DropdownMenuItem onClick={closeAnd((pos) => duplicateBlock(editor, pos))}>
            <CopyIcon /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!textual}>
              <TextTIcon /> Turn into
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent finalFocus={false}>
              {TURN_INTO_ITEMS.map((item) => (
                <DropdownMenuItem key={item.id} onClick={onBlock(() => turnInto(editor, item))}>
                  {item.icon} {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!textual}>
              <PaletteIcon /> Colour
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent finalFocus={false} className="p-0">
              <ColorPanel
                onText={(color) => onBlock(() => editor.chain().focus().setDocColor({ color }).run())()}
                onBackground={(background) => onBlock(() => editor.chain().focus().setDocColor({ background }).run())()}
                onClear={onBlock(() => editor.chain().focus().unsetDocColor().run())}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
