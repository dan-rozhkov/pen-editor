import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecentItem } from "@/lib/workspace/recent";

import { RecentList } from "../RecentList";

const DAY = 86_400_000;
const item = (id: string, updatedAt: number): RecentItem => ({ kind: "doc", id, title: id, updatedAt });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RecentList selection", () => {
  it("drops a selected row that the time tick ages out of the filter", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const now = Date.now();
    const items = [item("old", now - 7 * DAY + 30_000), item("new", now - 1000)];
    render(<RecentList items={items} onOpen={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Past 7 days" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select old" }));
    expect(screen.getByText("1 selected")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByRole("checkbox", { name: "Select old" })).toBeNull();
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("keeps the dialog mounted and its count while the list empties", async () => {
    const items = [item("a", Date.now())];
    const onDelete = vi.fn(async () => []);
    const { rerender } = render(<RecentList items={items} onOpen={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select a" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete 1 item?")).toBeTruthy();
    rerender(<RecentList items={[]} onOpen={vi.fn()} onDelete={onDelete} />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Delete 1 item?")).toBeTruthy();
    expect(screen.queryByText(/Delete 0 items/)).toBeNull();
  });
});
