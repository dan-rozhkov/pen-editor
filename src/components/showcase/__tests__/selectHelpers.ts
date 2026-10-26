import { fireEvent, screen } from "@testing-library/react";

/** Opens a base-ui Select trigger by accessible name. */
export function openSelect(name: string) {
  const trigger = screen.getByRole("combobox", { name });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
  return trigger;
}

/** Opens the named select and clicks the option with the given label. */
export async function chooseOption(selectName: string, optionName: string) {
  openSelect(selectName);
  const option = await screen.findByRole("option", { name: optionName });
  clickOption(option);
}

/** Selects an already-visible option the way a mouse does. */
export function clickOption(option: HTMLElement) {
  fireEvent.pointerDown(option, { button: 0, pointerType: "mouse" });
  fireEvent.mouseDown(option, { button: 0 });
  fireEvent.pointerUp(option, { button: 0, pointerType: "mouse" });
  fireEvent.mouseUp(option, { button: 0 });
  fireEvent.click(option);
}

/** Text of the select's displayed value (excludes the chevron icon). */
export function selectedLabel(name: string) {
  const trigger = screen.getByRole("combobox", { name });
  return trigger.querySelector('[data-slot="select-value"]')?.textContent;
}
