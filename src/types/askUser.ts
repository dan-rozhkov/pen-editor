export const DECIDE_FOR_ME = "__auto__";

export type AskUserFieldType = "single" | "multi" | "select" | "text";

export interface AskUserOption {
  value: string;
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  id: string;
  label: string;
  hint?: string;
  type: AskUserFieldType;
  options?: AskUserOption[];
  required?: boolean;
  allowOther?: boolean;
  allowDecideForMe?: boolean;
  placeholder?: string;
}

export interface AskUserInput {
  title?: string;
  questions: AskUserQuestion[];
}

export interface AskUserAnswer {
  id: string;
  /** string for single/select/text, string[] for multi. */
  value: string | string[];
  /** free text from the "Other…" field, when provided. */
  note?: string;
}

export interface AskUserOutput {
  answers: AskUserAnswer[];
}
