import {
  DECIDE_FOR_ME,
  type AskUserAnswer,
  type AskUserOutput,
  type AskUserQuestion,
} from "@/types/askUser";

export interface AnswerValue {
  value: string | string[];
  note: string;
}
export type AnswerState = Record<string, AnswerValue>;

export function initAnswerState(questions: AskUserQuestion[]): AnswerState {
  const state: AnswerState = {};
  for (const q of questions) {
    state[q.id] = { value: q.type === "multi" ? [] : "", note: "" };
  }
  return state;
}

export function isAnswered(q: AskUserQuestion, a: AnswerValue): boolean {
  if (a.note.trim() !== "") return true;
  if (q.type === "multi") return Array.isArray(a.value) && a.value.length > 0;
  return typeof a.value === "string" && a.value.trim() !== "";
}

export function allRequiredAnswered(
  questions: AskUserQuestion[],
  state: AnswerState,
): boolean {
  return questions.every((q) => !q.required || isAnswered(q, state[q.id]));
}

export function serializeAnswers(
  questions: AskUserQuestion[],
  state: AnswerState,
): string {
  const answers: AskUserAnswer[] = questions.map((q) => {
    const a = state[q.id];
    const answer: AskUserAnswer = { id: q.id, value: a.value };
    if (a.note.trim() !== "") answer.note = a.note.trim();
    return answer;
  });
  const out: AskUserOutput = { answers };
  return JSON.stringify(out);
}

function labelFor(q: AskUserQuestion, value: string): string {
  if (value === DECIDE_FOR_ME) return "Decide for me";
  return q.options?.find((o) => o.value === value)?.label ?? value;
}

export function summarizeAnswers(
  questions: AskUserQuestion[],
  state: AnswerState,
): { label: string; display: string }[] {
  return questions.map((q) => {
    const a = state[q.id];
    let display: string;
    if (Array.isArray(a.value)) {
      display = a.value.map((v) => labelFor(q, v)).join(", ");
    } else {
      display = a.value ? labelFor(q, a.value) : "";
    }
    if (a.note.trim() !== "") {
      display = display ? `${display} — ${a.note.trim()}` : a.note.trim();
    }
    return { label: q.label, display };
  });
}
