import { afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AskUserForm } from "../AskUserForm";
import type { AskUserInput } from "@/types/askUser";

afterEach(() => cleanup());

const input: AskUserInput = {
  title: "A couple of questions",
  questions: [
    { id: "audience", label: "Audience?", type: "single", required: true,
      options: [{ value: "devs", label: "Developers" }, { value: "biz", label: "Business" }],
      allowDecideForMe: true },
    { id: "name", label: "Project name?", type: "text", required: true, placeholder: "Acme" },
  ],
};

it("renders title, questions and disables submit until required answered", () => {
  render(<AskUserForm input={input} onSubmit={() => {}} />);
  expect(screen.getByText("A couple of questions")).toBeTruthy();
  expect(screen.getByText("Audience?")).toBeTruthy();
  const submit = screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
});

it("collects answers and calls onSubmit with serialized JSON", () => {
  const onSubmit = vi.fn();
  render(<AskUserForm input={input} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole("button", { name: "Developers" }));
  fireEvent.change(screen.getByPlaceholderText("Acme"), { target: { value: "Acme" } });
  const submit = screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement;
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  const out = JSON.parse(onSubmit.mock.calls[0][0]);
  expect(out.answers).toEqual([
    { id: "audience", value: "devs" },
    { id: "name", value: "Acme" },
  ]);
});

it("renders a read-only summary when state is output", () => {
  const onSubmit = vi.fn();
  render(<AskUserForm input={input} state="output" onSubmit={onSubmit} />);
  expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
});
