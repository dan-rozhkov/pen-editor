import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, DotsSixVerticalIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { skipBaseUiOpen } from "@/components/doc/ui/baseUi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";
import type { WorkflowStep } from "@/lib/workflows/workflowStore";

export interface StepDragHandlers {
  dragging: boolean;
  over: boolean;
  onStart: (index: number) => void;
  onOver: (index: number) => void;
  onDrop: (index: number) => void;
  onEnd: () => void;
}

interface StepCardProps {
  step: WorkflowStep;
  index: number;
  count: number;
  registerInput: (id: string, el: HTMLTextAreaElement | null) => void;
  onChange: (id: string, text: string) => void;
  /** Enter: a new step goes after this one. */
  onEnter: (index: number) => void;
  /** Backspace in an empty step. */
  onBackspaceEmpty: (index: number) => void;
  onMove: (index: number, delta: number) => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  /** Arrow keys at the edge of the text hand focus to a neighbour. */
  onNeighbor: (index: number, delta: number) => void;
  drag: StepDragHandlers;
}

/**
 * One step: number tile, auto-growing text field and, as in the doc editor's block handle, a gutter
 * with "+" and a drag handle that opens the step menu on click.
 */
export function StepCard({ step, index, count, registerInput, onChange, onEnter, onBackspaceEmpty, onMove, onDuplicate, onRemove, onNeighbor, drag }: StepCardProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // An item moves focus itself (the canvas focuses the moved/new/neighbour step); only a keyboard
  // dismissal (Escape) hands focus back to the grip.
  const acted = useRef(false);
  const act = (action: () => void) => () => {
    acted.current = true;
    setMenuOpen(false);
    action();
  };
  const finalFocus = (closeType: string) => {
    const result = !acted.current && closeType === "keyboard";
    acted.current = false;
    return result;
  };
  const cardRef = useRef<HTMLDivElement>(null);
  const number = index + 1;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [step.text]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const el = event.currentTarget;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      onMove(index, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      onEnter(index);
      return;
    }
    if (event.key === "Backspace" && el.value === "") {
      event.preventDefault();
      onBackspaceEmpty(index);
      return;
    }
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "ArrowUp" && el.selectionStart === 0 && el.selectionEnd === 0) {
      event.preventDefault();
      onNeighbor(index, -1);
    } else if (event.key === "ArrowDown" && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
      event.preventDefault();
      onNeighbor(index, 1);
    }
  };

  const onDragStart = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", step.id);
    if (cardRef.current) event.dataTransfer.setDragImage(cardRef.current, 16, 16);
    drag.onStart(index);
  };

  return (
    <div
      ref={cardRef}
      data-step-card
      onDragOver={(event) => {
        event.preventDefault();
        drag.onOver(index);
      }}
      onDrop={(event) => {
        event.preventDefault();
        drag.onDrop(index);
      }}
      className={cn(
        "group/step relative flex w-full items-start gap-3 rounded-xl border border-border-default bg-surface-panel p-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-[border-color,opacity] has-[textarea:focus]:border-accent-light",
        drag.dragging && "opacity-40",
        drag.over && !drag.dragging && "border-accent-light",
      )}
    >
      <span
        aria-hidden
        className="flex size-8 shrink-0 select-none items-center justify-center rounded-lg bg-surface-hover text-xs font-medium text-text-secondary tabular-nums transition-colors group-has-[textarea:focus]/step:bg-accent-selection group-has-[textarea:focus]/step:text-accent-primary"
      >
        {number}
      </span>
      <textarea
        ref={(el) => {
          ref.current = el;
          registerInput(step.id, el);
        }}
        rows={1}
        aria-label={`Step ${number}`}
        placeholder="Describe this step"
        value={step.text}
        spellCheck={false}
        onChange={(event) => onChange(step.id, event.target.value.replace(/\n/g, " "))}
        onKeyDown={onKeyDown}
        className="block min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent py-1.5 text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted/60"
      />
      {/* Left gutter on wide screens; below sm there is no room, so it floats over the card's top edge. */}
      <div
        role="toolbar"
        aria-label={`Step ${number} actions`}
        className={cn(
          "absolute top-4 right-full flex gap-0.5 pr-1.5 opacity-0 transition-opacity group-hover/step:opacity-100 group-focus-within/step:opacity-100",
          "max-sm:-top-3.5 max-sm:right-2 max-sm:rounded-lg max-sm:border max-sm:border-border-default max-sm:bg-surface-panel max-sm:p-0.5 max-sm:shadow-sm",
          menuOpen && "opacity-100",
        )}
      >
        <IconButton tooltip="Add step below" aria-label={`Add step after step ${number}`} variant="ghost" size="icon-sm" className="text-text-muted" onClick={() => onEnter(index)}>
          <PlusIcon weight="light" />
        </IconButton>
        {/* Non-modal, and opened on click only: a modal menu opened on mousedown would put a backdrop under the drag. */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger
            render={
              <IconButton
                tooltip="Drag to move, click for menu"
                aria-label={`Step ${number} menu`}
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
                onDragStart={onDragStart}
                onDragEnd={drag.onEnd}
              >
                <DotsSixVerticalIcon weight="light" />
              </IconButton>
            }
          />
          <DropdownMenuContent align="start" side="bottom" finalFocus={finalFocus} className="w-auto min-w-44">
            <DropdownMenuItem disabled={index === 0} onClick={act(() => onMove(index, -1))}>
              <ArrowUpIcon weight="light" /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onClick={act(() => onMove(index, 1))}>
              <ArrowDownIcon weight="light" /> Move down
            </DropdownMenuItem>
            <DropdownMenuItem onClick={act(() => onDuplicate(index))}>
              <CopyIcon weight="light" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={act(() => onRemove(index))}>
              <TrashIcon weight="light" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
