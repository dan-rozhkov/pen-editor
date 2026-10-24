import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ListNumbersIcon, PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/IconButton";
import { newStepId, type WorkflowStep } from "@/lib/workflows/workflowStore";
import { StepCard } from "./StepCard";
import { insertStepAt, moveStep, removeStep } from "./stepOps";

interface WorkflowCanvasProps {
  steps: readonly WorkflowStep[];
  setSteps: (update: (steps: readonly WorkflowStep[]) => readonly WorkflowStep[]) => void;
}

/** A thin solid connector ending in an open arrow head; `onInsert` adds a hover "+" in its middle. */
function Connector({ label, onInsert }: { label?: string; onInsert?: () => void }) {
  return (
    <div className="group/connector relative flex h-10 w-full justify-center" data-connector>
      <div aria-hidden className="relative flex h-full flex-col items-center py-1 text-border-hover">
        <span className="w-px flex-1 bg-current" />
        <svg viewBox="0 0 8 4.5" className="-mt-[3.5px] h-[4.5px] w-2 overflow-visible fill-none stroke-current" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round">
          <path d="M0.5 0.5 4 4l3.5-3.5" />
        </svg>
      </div>
      {onInsert && (
        <IconButton
          variant="outline"
          size="icon-xs"
          tooltip="Insert step"
          aria-label={label}
          onClick={onInsert}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface-panel text-text-muted opacity-0 transition-opacity group-hover/connector:opacity-100 focus-visible:opacity-100"
        >
          <PlusIcon weight="light" />
        </IconButton>
      )}
    </div>
  );
}

/** The step chain: one centred column of cards joined by connectors, ending in a round "+" button. */
export function WorkflowCanvas({ steps, setSteps }: WorkflowCanvasProps) {
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const focusId = useRef<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Focus requested by an edit lands after the render that holds the new step.
  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    const el = inputs.current.get(id);
    if (el) {
      focusId.current = null;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [steps]);

  const registerInput = useCallback((id: string, el: HTMLTextAreaElement | null) => {
    if (el) inputs.current.set(id, el);
    else inputs.current.delete(id);
  }, []);

  const addAt = useCallback(
    (index: number) => {
      const step: WorkflowStep = { id: newStepId(), text: "" };
      focusId.current = step.id;
      setSteps((current) => insertStepAt(current, index, step));
    },
    [setSteps],
  );

  const changeText = useCallback(
    (id: string, text: string) => setSteps((current) => current.map((s) => (s.id === id ? { ...s, text } : s))),
    [setSteps],
  );

  const move = useCallback(
    (index: number, delta: number) => {
      focusId.current = steps[index]?.id ?? null;
      setSteps((current) => moveStep(current, index, delta));
    },
    [steps, setSteps],
  );

  const duplicate = useCallback(
    (index: number) => {
      const id = newStepId();
      focusId.current = id;
      setSteps((current) => {
        const source = current[index];
        return source ? insertStepAt(current, index + 1, { id, text: source.text }) : current;
      });
    },
    [setSteps],
  );

  const remove = useCallback(
    (index: number) => {
      focusId.current = (steps[index - 1] ?? steps[index + 1])?.id ?? null;
      setSteps((current) => removeStep(current, index));
    },
    [steps, setSteps],
  );

  const neighbor = useCallback(
    (index: number, delta: number) => {
      const target = steps[index + delta];
      if (target) inputs.current.get(target.id)?.focus();
    },
    [steps],
  );

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  if (steps.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[460px] flex-col items-center rounded-xl border border-dashed border-border-light bg-surface-panel px-6 py-10">
        <EmptyState
          icon={<ListNumbersIcon weight="light" />}
          title="No steps yet"
          description="A workflow is a list of steps the agent completes in order."
          action={
            <Button variant="outline" onClick={() => addAt(0)}>
              <PlusIcon weight="light" /> Add first step
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <ol className="mx-auto flex w-full max-w-[460px] flex-col items-center" aria-label="Workflow steps">
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          {index > 0 && (
            <li className="w-full list-none">
              <Connector label={`Insert step after step ${index}`} onInsert={() => addAt(index)} />
            </li>
          )}
          <li className="w-full list-none">
            <StepCard
              step={step}
              index={index}
              count={steps.length}
              registerInput={registerInput}
              onChange={changeText}
              onEnter={(i) => addAt(i + 1)}
              onBackspaceEmpty={(i) => {
                if (steps.length > 1) remove(i);
              }}
              onMove={move}
              onDuplicate={duplicate}
              onRemove={remove}
              onNeighbor={neighbor}
              drag={{
                dragging: dragIndex === index,
                over: overIndex === index,
                onStart: setDragIndex,
                onOver: setOverIndex,
                onDrop: (to) => {
                  if (dragIndex !== null && dragIndex !== to) {
                    focusId.current = steps[dragIndex].id;
                    setSteps((current) => moveStep(current, dragIndex, to - dragIndex));
                  }
                  endDrag();
                },
                onEnd: endDrag,
              }}
            />
          </li>
        </Fragment>
      ))}
      <li aria-hidden className="w-full list-none">
        <Connector />
      </li>
      <li className="list-none">
        <IconButton
          variant="outline"
          size="icon-lg"
          tooltip="Add step"
          onClick={() => addAt(steps.length)}
          className="size-10 rounded-full bg-surface-panel text-text-muted shadow-[0_1px_3px_rgba(0,0,0,0.08)] hover:text-text-primary"
        >
          <PlusIcon weight="light" />
        </IconButton>
      </li>
    </ol>
  );
}
