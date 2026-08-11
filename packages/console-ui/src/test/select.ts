import { fireEvent, screen, within } from "@testing-library/react";

/**
 * Helpers for the Radix-backed `Select`.
 *
 * A native `<select>` keeps its options in the DOM at all times, so tests could read them off the
 * element and change it with one event. Radix mounts the list only while it is open, which is the
 * price of drawing our own surface — so reading options and choosing one both have to open it.
 */
export function openSelect(label: string): HTMLElement {
  // Close whatever is still open: jsdom does not always deliver the pointer events Radix uses to
  // dismiss, and two live listboxes make every later query ambiguous.
  for (const open of screen.queryAllByRole("listbox")) {
    fireEvent.keyDown(open, { key: "Escape" });
  }
  const trigger = screen.getByRole("combobox", { name: label });
  // Opened with the keyboard rather than a pointer: jsdom does not carry `button` through a
  // synthetic pointerdown, so Radix never treats it as a primary click. ArrowDown is synchronous,
  // which keeps these tests from having to become async just to read a list.
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

/** The label currently shown on the trigger — the closest equivalent of a native select's value. */
export function selectedOption(label: string): string {
  return screen.getByRole("combobox", { name: label }).textContent?.trim() ?? "";
}

/** Option labels in list order. Opens the list, reads it, then leaves it closed again. */
export function optionLabels(label: string): string[] {
  const listbox = openSelect(label);
  const labels = within(listbox)
    .getAllByRole("option")
    .map((option) => option.textContent?.trim() ?? "");
  fireEvent.keyDown(listbox, { key: "Escape" });
  return labels;
}

/** Picks an option by its visible text. */
export function chooseOption(label: string, optionName: string | RegExp): void {
  const listbox = openSelect(label);
  const option = within(listbox).getByRole("option", { name: optionName });
  fireEvent.click(option);
}
