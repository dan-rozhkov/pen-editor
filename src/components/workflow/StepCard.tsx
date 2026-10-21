import { useLayoutEffect, useRef, type DragEvent, type KeyboardEvent } from "react";
import { ArrowDownIcon, ArrowUpIcon, DotsSixVerticalIcon, TrashIcon } from "@phosphor-icons/react";
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
  onRemove: (index: number) => void;
  /** Arrow keys at the edge of the text hand focus to a neighbour. */
  onNeighbor: (index: number, delta: number) => void;
  drag: StepDragHandlers;
}

const ACTION_CLASS = "text-text-muted hover:text-text-primary";

/** One step: number tile, auto-growing text field and a hover toolbar (drag, move, delete). */
export function StepCard({ step, index, count, registerInput, onChange, onEnter, onBackspaceEmpty, onMove, onRemove, onNeighbor, drag }: StepCardProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
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
        "group/step relative flex w-full items-start gap-3 rounded-2xl border border-border-default bg-surface-panel p-3 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_6px_16px_-6px_rgba(0,0,0,0.1)] transition-[border-color,opacity] focus-within:border-text-muted",
        drag.dragging && "opacity-40",
        drag.over && !drag.dragging && "border-text-muted",
      )}
    >
      <span
        aria-hidden
        className="flex size-8 shrink-0 select-none items-center justify-center rounded-lg bg-surface-hover text-xs font-medium text-text-secondary tabular-nums"
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
      <div
        role="toolbar"
        aria-label={`Step ${number} actions`}
        className="absolute -top-3 right-2 flex items-center rounded-lg border border-border-default bg-surface-panel p-0.5 opacity-0 shadow-sm transition-opacity group-hover/step:opacity-100 group-focus-within/step:opacity-100"
      >
        <IconButton
          variant="ghost"
          size="icon-xs"
          tooltip="Drag to reorder"
          aria-label={`Drag step ${number}`}
          draggable
          onDragStart={onDragStart}
          onDragEnd={drag.onEnd}
          className={cn(ACTION_CLASS, "cursor-grab active:cursor-grabbing")}
        >
          <DotsSixVerticalIcon weight="light" />
        </IconButton>
        <IconButton variant="ghost" size="icon-xs" tooltip="Move up" aria-label={`Move step ${number} up`} disabled={index === 0} onClick={() => onMove(index, -1)} className={ACTION_CLASS}>
          <ArrowUpIcon weight="light" />
        </IconButton>
        <IconButton variant="ghost" size="icon-xs" tooltip="Move down" aria-label={`Move step ${number} down`} disabled={index === count - 1} onClick={() => onMove(index, 1)} className={ACTION_CLASS}>
          <ArrowDownIcon weight="light" />
        </IconButton>
        <IconButton variant="ghost" size="icon-xs" tooltip="Delete step" aria-label={`Delete step ${number}`} onClick={() => onRemove(index)} className={ACTION_CLASS}>
          <TrashIcon weight="light" />
        </IconButton>
      </div>
    </div>
  );
}
