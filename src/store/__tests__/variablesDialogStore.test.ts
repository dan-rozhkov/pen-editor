import { beforeEach, describe, expect, it } from "vitest";
import { useVariablesDialogStore } from "@/store/variablesDialogStore";

describe("variablesDialogStore", () => {
  beforeEach(() => {
    useVariablesDialogStore.setState({ open: false });
  });

  it("defaults to closed", () => {
    expect(useVariablesDialogStore.getState().open).toBe(false);
  });

  it("opens and closes", () => {
    useVariablesDialogStore.getState().setOpen(true);
    expect(useVariablesDialogStore.getState().open).toBe(true);
    useVariablesDialogStore.getState().setOpen(false);
    expect(useVariablesDialogStore.getState().open).toBe(false);
  });
});
