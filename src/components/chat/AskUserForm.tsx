import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectWithOptions } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AskUserInput, type AskUserQuestion } from "@/types/askUser";
import {
  initAnswerState,
  allRequiredAnswered,
  serializeAnswers,
  summarizeAnswers,
} from "./askUserAnswers";

interface QuestionFieldProps {
  q: AskUserQuestion;
  value: string | string[];
  note: string;
  onValue: (v: string | string[]) => void;
  onNote: (n: string) => void;
}

function QuestionField({ q, value, note, onValue, onNote }: QuestionFieldProps) {
  const allowOther = q.allowOther ?? q.type !== "text";
  const arr = Array.isArray(value) ? value : [];

  return (
    <div className="space-y-1.5">
      <Label className="block font-normal leading-normal text-text-primary">{q.label}</Label>
      {q.hint && <div className="text-[11px] text-text-muted">{q.hint}</div>}

      {q.type === "single" && (
        <div className="flex flex-wrap gap-1.5">
          {q.options?.map((o) => (
            <Button
              key={o.value}
              size="sm"
              variant="outline"
              onClick={() => onValue(o.value)}
              className={
                value === o.value
                  ? "h-auto min-h-6 max-w-full border-accent-primary bg-accent-primary py-0.5 text-left font-normal !text-white whitespace-normal break-words hover:bg-accent-primary hover:!text-white"
                  : "h-auto min-h-6 max-w-full whitespace-normal break-words py-0.5 text-left font-normal"
              }
            >
              {o.label}
            </Button>
          ))}
        </div>
      )}

      {q.type === "multi" && (
        <div className="flex flex-col gap-1.5">
          {q.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5 text-xs leading-normal">
              <Checkbox
                className="data-checked:!bg-accent-primary data-checked:!text-white"
                checked={arr.includes(o.value)}
                onCheckedChange={(next) =>
                  onValue(
                    next
                      ? [...arr, o.value]
                      : arr.filter((v) => v !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </div>
      )}

      {q.type === "select" && (
        <SelectWithOptions
          value={typeof value === "string" ? value : ""}
          options={q.options ?? []}
          onValueChange={(v) => onValue(v ?? "")}
          size="sm"
          className="w-full"
        />
      )}

      {q.type === "text" && (
        <Input
          value={typeof value === "string" ? value : ""}
          placeholder={q.placeholder}
          onChange={(e) => onValue(e.target.value)}
        />
      )}

      {allowOther && q.type !== "text" && (
        <Input
          value={note}
          placeholder={q.placeholder ?? "Other…"}
          onChange={(e) => onNote(e.target.value)}
        />
      )}
    </div>
  );
}

export function AskUserForm({
  input,
  state = "input",
  disabled,
  onSubmit,
}: {
  input: AskUserInput;
  state?: "input" | "output";
  disabled?: boolean;
  onSubmit: (output: string) => void;
}) {
  const { questions } = input;
  const [answers, setAnswers] = useState(() => initAnswerState(questions ?? []));
  const [submitted, setSubmitted] = useState(state === "output");
  const readOnly = submitted || state === "output" || disabled;

  if (!questions?.length) return null;

  const setValue = (id: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], value } }));
  };
  const setNote = (id: string, note: string) => {
    setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], note } }));
  };

  const handleSubmit = () => {
    setSubmitted(true);
    onSubmit(serializeAnswers(input.questions, answers));
  };

  if (readOnly) {
    const rows = summarizeAnswers(input.questions, answers);
    return (
      <div className="mt-3 w-full space-y-3 rounded-lg border border-border-default bg-surface-panel/60 p-3 text-xs">
        <div className="font-medium text-text-primary">Questions answered</div>
        {rows.map((row, i) => (
          <div key={i} className="space-y-1">
            <div className="font-normal text-text-muted">{row.label}</div>
            <span className="inline-flex min-h-6 max-w-full items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs leading-tight font-normal !text-secondary-foreground whitespace-normal break-words">
              {row.display || "—"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const canSubmit = allRequiredAnswered(input.questions, answers);

  return (
    <div className="mt-3 w-full space-y-4 rounded-lg border border-border-default bg-surface-panel/60 p-3">
      {input.title && <div className="text-xs font-semibold text-text-primary">{input.title}</div>}
      {input.questions.map((q) => (
        <QuestionField
          key={q.id}
          q={q}
          value={answers[q.id].value}
          note={answers[q.id].note}
          onValue={(v) => setValue(q.id, v)}
          onNote={(n) => setNote(q.id, n)}
        />
      ))}
      <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
        Continue
      </Button>
    </div>
  );
}
