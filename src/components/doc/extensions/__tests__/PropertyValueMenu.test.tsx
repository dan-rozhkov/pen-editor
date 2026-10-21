import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PropertyValueMenu } from "../PropertyValueMenu";
import { createDoc } from "@/lib/docs/docStore";
import { destroyLoaded, load } from "../../ui/__tests__/editorFixture";

const TAG = (c: string, t: string) => `<span data-bg="${c}">${t}</span>`;
const SRC = `|  |  |\n| --- | --- |\n| Status | ${TAG("green", "Done")} |\n| Owner | Ann |`;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  destroyLoaded();
});

function mount(markdown = SRC) {
  const editor = load(markdown);
  let closed = 0;
  render(
    <PropertyValueMenu editor={editor} getRowPos={() => 1} keyText="Status" valueText="Done" currentTag={{ text: "Done" }} onDone={() => (closed += 1)} />,
  );
  return { editor, closed: () => closed };
}

describe("PropertyValueMenu", () => {
  it("lists Date, Option and Clear", () => {
    mount();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["Date", "Option", "Clear"]);
  });

  it("clears the value from the menu", () => {
    const { editor, closed } = mount();
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear" }));
    expect(editor.getMarkdown()).toContain("| Status |  |");
    expect(closed()).toBe(1);
  });

  it("offers options from other stored documents and marks the current one", () => {
    createDoc({ title: "Other", markdown: `|  |  |\n| --- | --- |\n| Status | ${TAG("red", "Blocked")} |` }, "editor");
    mount();
    fireEvent.click(screen.getByRole("menuitem", { name: "Option" }));
    expect(screen.getAllByRole("option").map((el) => el.textContent)).toEqual(["Blocked", "Done"]);
    expect(screen.getByRole("option", { name: "Done" }).getAttribute("aria-selected")).toBe("true");
  });

  it("creates a new option with the chosen colour", () => {
    const { editor } = mount();
    fireEvent.click(screen.getByRole("menuitem", { name: "Option" }));
    fireEvent.change(screen.getByLabelText("Filter options"), { target: { value: "Review" } });
    fireEvent.click(screen.getByRole("button", { name: "Purple" }));
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    expect(editor.getMarkdown()).toContain('| Status | <span data-bg="purple">Review</span> |');
  });

  it("writes a picked date as YYYY-MM-DD on Set", () => {
    const { editor, closed } = mount();
    fireEvent.click(screen.getByRole("menuitem", { name: "Date" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-02" } });
    expect(editor.getMarkdown()).toContain('<span data-bg="green">Done</span>');
    expect(closed()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(editor.getMarkdown()).toContain("| Status | 2026-11-02 |");
    expect(closed()).toBe(1);
  });

  it("writes the date on Enter", () => {
    const { editor } = mount();
    fireEvent.click(screen.getByRole("menuitem", { name: "Date" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-02" } });
    fireEvent.keyDown(screen.getByLabelText("Date"), { key: "Enter" });
    expect(editor.getMarkdown()).toContain("| Status | 2026-11-02 |");
  });

  it.each([["0002-05-03"], [""]])("does not write the partial date %j", (value) => {
    const { editor, closed } = mount();
    fireEvent.click(screen.getByRole("menuitem", { name: "Date" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value } });
    fireEvent.keyDown(screen.getByLabelText("Date"), { key: "Enter" });
    expect(screen.getByRole("button", { name: "Set" }).hasAttribute("disabled")).toBe(true);
    expect(editor.getMarkdown()).toContain('<span data-bg="green">Done</span>');
    expect(closed()).toBe(0);
  });

  it("Enter picks the first visible match instead of creating the typed text", () => {
    const { editor } = mount();
    fireEvent.click(screen.getByRole("menuitem", { name: "Option" }));
    fireEvent.change(screen.getByLabelText("Filter options"), { target: { value: "Do" } });
    fireEvent.keyDown(screen.getByLabelText("Filter options"), { key: "Enter" });
    expect(editor.getMarkdown()).toContain('| Status | <span data-bg="green">Done</span> |');
  });

  it("Enter creates an option only when nothing matches", () => {
    const { editor } = mount();
    fireEvent.click(screen.getByRole("menuitem", { name: "Option" }));
    fireEvent.change(screen.getByLabelText("Filter options"), { target: { value: "Zzz" } });
    fireEvent.keyDown(screen.getByLabelText("Filter options"), { key: "Enter" });
    expect(editor.getMarkdown()).toContain("Zzz</span>");
  });
});
