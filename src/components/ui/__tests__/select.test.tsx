import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

afterEach(() => cleanup());

describe("SelectItem", () => {
  it("keeps the right padding that reserves room for the check indicator", () => {
    render(
      <Select open value="a">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
        </SelectContent>
      </Select>,
    );
    const item = screen.getAllByText("Alpha").map((el) => el.closest("[data-slot='select-item']")).find(Boolean);
    expect(item).toBeTruthy();
    expect(item!.className).toContain("pr-8");
    expect(item!.className).toContain("pl-2.5");
  });
});
