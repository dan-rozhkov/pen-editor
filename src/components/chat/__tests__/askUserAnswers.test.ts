import { it, expect } from "vitest";
import {
  initAnswerState,
  isAnswered,
  allRequiredAnswered,
  serializeAnswers,
  summarizeAnswers,
} from "../askUserAnswers";
import { DECIDE_FOR_ME, type AskUserQuestion } from "@/types/askUser";

const single: AskUserQuestion = {
  id: "audience", label: "Audience?", type: "single",
  options: [{ value: "devs", label: "Developers" }, { value: "biz", label: "Business" }],
  required: true,
};
const multi: AskUserQuestion = {
  id: "focus", label: "Focus?", type: "multi",
  options: [{ value: "speed", label: "Speed" }, { value: "cost", label: "Cost" }],
};
const text: AskUserQuestion = { id: "name", label: "Name?", type: "text", required: true };

it("initializes empty state per question type", () => {
  const s = initAnswerState([single, multi, text]);
  expect(s.audience.value).toBe("");
  expect(s.focus.value).toEqual([]);
  expect(s.name.value).toBe("");
});

it("isAnswered handles each type, notes and decide-for-me", () => {
  expect(isAnswered(single, { value: "", note: "" })).toBe(false);
  expect(isAnswered(single, { value: "devs", note: "" })).toBe(true);
  expect(isAnswered(single, { value: DECIDE_FOR_ME, note: "" })).toBe(true);
  expect(isAnswered(single, { value: "", note: "students" })).toBe(true);
  expect(isAnswered(multi, { value: [], note: "" })).toBe(false);
  expect(isAnswered(multi, { value: ["speed"], note: "" })).toBe(true);
  expect(isAnswered(text, { value: "  ", note: "" })).toBe(false);
  expect(isAnswered(text, { value: "Acme", note: "" })).toBe(true);
});

it("allRequiredAnswered gates on required questions only", () => {
  const state = initAnswerState([single, multi, text]);
  expect(allRequiredAnswered([single, multi, text], state)).toBe(false);
  state.audience.value = "devs";
  state.name.value = "Acme";
  expect(allRequiredAnswered([single, multi, text], state)).toBe(true);
});

it("serializeAnswers emits explicit values (incl. empty) keyed by id", () => {
  const state = initAnswerState([single, multi, text]);
  state.audience.value = "devs";
  state.focus.value = ["speed", "cost"];
  const out = JSON.parse(serializeAnswers([single, multi, text], state));
  expect(out.answers).toEqual([
    { id: "audience", value: "devs" },
    { id: "focus", value: ["speed", "cost"] },
    { id: "name", value: "" },
  ]);
});

it("serializeAnswers includes note when present", () => {
  const state = initAnswerState([single]);
  state.audience.value = DECIDE_FOR_ME;
  state.audience.note = "but keep it simple";
  const out = JSON.parse(serializeAnswers([single], state));
  expect(out.answers[0]).toEqual({ id: "audience", value: "__auto__", note: "but keep it simple" });
});

it("summarizeAnswers maps option values to labels for read-only display", () => {
  const state = initAnswerState([single, multi]);
  state.audience.value = "devs";
  state.focus.value = ["speed", "cost"];
  const rows = summarizeAnswers([single, multi], state);
  expect(rows[0]).toEqual({ label: "Audience?", display: "Developers" });
  expect(rows[1]).toEqual({ label: "Focus?", display: "Speed, Cost" });
});
