import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ScheduleDialog } from "@/components/workflow/ScheduleDialog";
import { DEFAULT_SCHEDULE_CONFIG, getSchedule, recordScheduledRun, recordScheduledSkip, saveSchedule } from "@/lib/workflows/workflowSchedule";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const ID = "wf-1";

function renderDialog() {
  const onOpenChange = vi.fn();
  render(<ScheduleDialog workflowId={ID} open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

const choose = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

function seedSchedule(overrides: Partial<typeof DEFAULT_SCHEDULE_CONFIG> = {}) {
  saveSchedule({ ...DEFAULT_SCHEDULE_CONFIG, ...overrides, workflowId: ID });
}

describe("ScheduleDialog", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens with the defaults when no schedule exists", () => {
    renderDialog();
    expect(screen.getByRole("radio", { name: "Weekdays" }).getAttribute("aria-checked")).toBe("true");
    expect(field("Time").value).toBe(DEFAULT_SCHEDULE_CONFIG.time);
    expect(screen.queryByRole("button", { name: "Remove schedule" })).toBeNull();
    expect(screen.getByText(/Next run:/)).toBeTruthy();
  });

  it("saves the chosen frequency, time and message", () => {
    const onOpenChange = renderDialog();
    choose("Daily");
    fireEvent.change(field("Time"), { target: { value: "07:45" } });
    fireEvent.change(field("Opening message"), { target: { value: "Report back" } });
    save();
    expect(getSchedule(ID)).toMatchObject({ enabled: true, frequency: "daily", time: "07:45", message: "Report back" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves the weekday of a weekly schedule", () => {
    renderDialog();
    choose("Weekly");
    choose("Fri");
    save();
    expect(getSchedule(ID)).toMatchObject({ frequency: "weekly", weekday: 5 });
  });

  it("maps the minute of an hourly schedule into the time, keeping the hour", () => {
    renderDialog();
    choose("Hourly");
    fireEvent.change(field("Minute past the hour"), { target: { value: "5" } });
    save();
    expect(getSchedule(ID)).toMatchObject({ frequency: "hourly", time: "09:05" });
  });

  it("loads a stored schedule", () => {
    seedSchedule({ frequency: "hourly", time: "00:30", message: "Hi" });
    renderDialog();
    expect(field("Minute past the hour").value).toBe("30");
    expect(field("Opening message").value).toBe("Hi");
  });

  it("disables an existing schedule when Off is chosen and keeps its config", () => {
    seedSchedule({ frequency: "daily", time: "08:00" });
    renderDialog();
    choose("Off");
    save();
    expect(getSchedule(ID)).toMatchObject({ enabled: false, frequency: "daily", time: "08:00" });
  });

  it("saves nothing when Off is chosen and no schedule exists", () => {
    const onOpenChange = renderDialog();
    choose("Off");
    save();
    expect(getSchedule(ID)).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("removes the schedule", () => {
    seedSchedule();
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Remove schedule" }));
    expect(getSchedule(ID)).toBeNull();
  });

  it("shows the last run and a skip", () => {
    seedSchedule();
    recordScheduledRun(ID, { occurrenceAt: Date.now(), runAt: Date.now(), chatId: "c1" });
    recordScheduledSkip(ID, { occurrenceAt: Date.now(), at: Date.now(), reason: "previous-run-busy" });
    renderDialog();
    expect(screen.getByText(/Last run:/)).toBeTruthy();
    expect(screen.getByText("Skipped: the previous run was still working")).toBeTruthy();
  });

  it("keeps the hour when a schedule is saved hourly and switched back to daily", () => {
    seedSchedule({ frequency: "daily", time: "07:45" });
    renderDialog();
    choose("Hourly");
    fireEvent.change(field("Minute past the hour"), { target: { value: "10" } });
    save();
    expect(getSchedule(ID)).toMatchObject({ frequency: "hourly", time: "07:10" });
    cleanup();
    renderDialog();
    choose("Daily");
    expect(field("Time").value).toBe("07:10");
  });

  it("saves Off with the stored time when the time field is empty", () => {
    seedSchedule({ frequency: "daily", time: "08:00" });
    renderDialog();
    fireEvent.change(field("Time"), { target: { value: "" } });
    choose("Off");
    save();
    expect(getSchedule(ID)).toMatchObject({ enabled: false, frequency: "daily", time: "08:00" });
  });

  it("reports a storage error as a toast and stays open", () => {
    const onOpenChange = renderDialog();
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    save();
    setItem.mockRestore();
    expect(toast.error).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("reports a failed Remove as a toast and keeps the dialog open", () => {
    seedSchedule();
    const onOpenChange = renderDialog();
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove schedule" }));
    setItem.mockRestore();
    expect(toast.error).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(getSchedule(ID)).not.toBeNull();
  });

  it("starts Hourly from the minutes of the time field as edited, not the saved ones", () => {
    seedSchedule({ frequency: "daily", time: "07:45" });
    renderDialog();
    fireEvent.change(field("Time"), { target: { value: "07:20" } });
    choose("Hourly");
    expect(field("Minute past the hour").value).toBe("20");
  });

  it.each(["60", "-1", "5.5", ""])("shows an error and disables Save for the minute %j", (value) => {
    renderDialog();
    choose("Hourly");
    fireEvent.change(field("Minute past the hour"), { target: { value } });
    expect(screen.getByRole("alert").textContent).toContain("0 to 59");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(getSchedule(ID)).toBeNull();
  });

  it("a form for one workflow cannot save to another", () => {
    const { rerender } = render(<ScheduleDialog workflowId="wf-a" open onOpenChange={vi.fn()} />);
    choose("Daily");
    fireEvent.change(field("Opening message"), { target: { value: "for A" } });
    rerender(<ScheduleDialog workflowId="wf-b" open onOpenChange={vi.fn()} />);
    expect(field("Opening message").value).toBe("");
    save();
    expect(getSchedule("wf-a")).toBeNull();
    expect(getSchedule("wf-b")).toMatchObject({ message: "" });
  });
});
