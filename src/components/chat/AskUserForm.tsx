import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectWithOptions } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DECIDE_FOR_ME, type AskUserInput, type AskUserQuestion } from "@/types/askUser";
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
  const allowAuto = q.allowDecideForMe ?? (q.type === "single" || q.type === "multi");
  const arr = Array.isArray(value) ? value : [];

  return (
    <div className="space-y-1.5">
      <Label className="block text-text-primary">{q.label}</Label>
      {q.hint && <div className="text-[11px] text-text-muted">{q.hint}</div>}

      {q.type === "single" && (
        <div className="flex flex-wrap gap-1.5">
          {q.options?.map((o) => (
            <Button
              key={o.value}
              size="sm"
              variant={value === o.value ? "secondary" : "outline"}
              onClick={() => onValue(o.value)}
            >
              {o.label}
            </Button>
          ))}
          {allowAuto && (
            <Button
              size="sm"
              variant={value === DECIDE_FOR_ME ? "secondary" : "outline"}
              onClick={() => onValue(DECIDE_FOR_ME)}
            >
              Decide for me
            </Button>
          )}
        </div>
      )}

      {q.type === "multi" && (
        <div className="flex flex-col gap-1.5">
          {q.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5">
              <Checkbox
                checked={arr.includes(o.value)}
                onCheckedChange={(next) =>
                  onValue(
                    next
                      ? [...arr.filter((v) => v !== DECIDE_FOR_ME), o.value]
                      : arr.filter((v) => v !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          ))}
          {allowAuto && (
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={arr.includes(DECIDE_FOR_ME)}
                onCheckedChange={(next) => onValue(next ? [DECIDE_FOR_ME] : [])}
              />
              Decide for me
            </label>
          )}
        </div>
      )}

      {q.type === "select" && (
        <SelectWithOptions
          value={typeof value === "string" ? value : ""}
          options={[
            ...(q.options ?? []),
            ...(allowAuto ? [{ value: DECIDE_FOR_ME, label: "Decide for me" }] : []),
          ]}
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
  const [answers, setAnswers] = useState(() => initAnswerState(input.questions));
  const [submitted, setSubmitted] = useState(state === "output");
  const readOnly = submitted || state === "output" || disabled;

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
      <div className="w-full rounded-lg border border-border-default bg-surface-panel/60 p-3 space-y-1.5">
        <div className="font-semibold text-text-primary">Questions answered</div>
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            <span className="text-text-muted">{row.label}</span>
            <Badge variant="secondary">{row.display || "—"}</Badge>
          </div>
        ))}
      </div>
    );
  }

  const canSubmit = allRequiredAnswered(input.questions, answers);

  return (
    <div className="w-full rounded-lg border border-border-default bg-surface-panel/60 p-3 space-y-4">
      {input.title && <div className="font-semibold text-text-primary">{input.title}</div>}
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
