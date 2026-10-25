import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_SCHEDULE_CONFIG,
  deleteSchedule,
  nextOccurrence,
  parseScheduleTime,
  saveSchedule,
  type ScheduleFrequency,
  type WorkflowSchedule,
} from "@/lib/workflows/workflowSchedule";
import { useWorkflowSchedule } from "@/components/workflow/useWorkflowSchedule";

type FrequencyChoice = "off" | ScheduleFrequency;

const FREQUENCY_OPTIONS: readonly SegmentedControlOption<FrequencyChoice>[] = [
  { value: "off", label: "Off" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
];

// Monday first; values are Date#getDay numbers as strings.
const WEEKDAY_OPTIONS: readonly SegmentedControlOption<string>[] = [
  { value: "1", label: "Mon" },
  { value: "2", label: "Tue" },
  { value: "3", label: "Wed" },
  { value: "4", label: "Thu" },
  { value: "5", label: "Fri" },
  { value: "6", label: "Sat" },
  { value: "0", label: "Sun" },
];

const WHEN_FORMAT: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

const formatWhen = (ms: number) => new Date(ms).toLocaleString(undefined, WHEN_FORMAT);

function initialFrequency(schedule: WorkflowSchedule | null): FrequencyChoice {
  if (!schedule) return DEFAULT_SCHEDULE_CONFIG.frequency;
  return schedule.enabled ? schedule.frequency : "off";
}

interface ScheduleFormProps {
  workflowId: string;
  schedule: WorkflowSchedule | null;
  onDone: () => void;
}

function ScheduleForm({ workflowId, schedule, onDone }: ScheduleFormProps) {
  const base = schedule ?? DEFAULT_SCHEDULE_CONFIG;
  const [frequency, setFrequency] = useState<FrequencyChoice>(() => initialFrequency(schedule));
  // A disabled schedule keeps its frequency; "Off" just hides the fields below.
  const [lastFrequency, setLastFrequency] = useState<ScheduleFrequency>(base.frequency);
  const [time, setTime] = useState(base.time);
  const [minute, setMinute] = useState(() => String(parseScheduleTime(base.time)?.minutes ?? 0));
  const [weekday, setWeekday] = useState(base.weekday);
  const [message, setMessage] = useState(base.message);

  const [now] = useState(() => Date.now());
  const active: ScheduleFrequency = frequency === "off" ? lastFrequency : frequency;
  // No silent clamping: anything but a whole number 0-59 is an error the user sees.
  const minuteValid = /^\d{1,2}$/.test(minute.trim()) && Number(minute) <= 59;
  const minuteValue = minuteValid ? Number(minute) : 0;
  // Hourly uses only the minutes, but keeps the hour of the time field so switching back shows it.
  const keptHours = parseScheduleTime(time)?.hours ?? 0;
  const effectiveTime = active === "hourly" ? `${String(keptHours).padStart(2, "0")}:${String(minuteValue).padStart(2, "0")}` : time;
  const timeValid = (active !== "hourly" || minuteValid) && parseScheduleTime(effectiveTime) !== null;
  const next = frequency !== "off" && timeValid ? nextOccurrence({ frequency: active, time: effectiveTime, weekday }, now) : null;

  const changeFrequency = (value: FrequencyChoice) => {
    // Switching to Hourly starts from the minutes of the time field as edited right now, not the saved one.
    if (value === "hourly" && active !== "hourly") {
      const edited = parseScheduleTime(time);
      if (edited) setMinute(String(edited.minutes));
    }
    setFrequency(value);
    if (value !== "off") setLastFrequency(value);
  };

  const save = () => {
    if (frequency === "off" && !schedule) {
      onDone();
      return;
    }
    try {
      // Off never fails on the time: an invalid one falls back to the stored (or default) time.
      const savedTime = timeValid ? effectiveTime : (schedule?.time ?? DEFAULT_SCHEDULE_CONFIG.time);
      saveSchedule({ workflowId, enabled: frequency !== "off", frequency: active, time: savedTime, weekday, message });
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the schedule.");
    }
  };

  const remove = () => {
    try {
      deleteSchedule(workflowId);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the schedule.");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Schedule</DialogTitle>
        <DialogDescription>Start a new chat that runs this workflow on a repeating schedule.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <SegmentedControl aria-label="Frequency" options={FREQUENCY_OPTIONS} value={frequency} onValueChange={changeFrequency} className="flex w-full *:flex-1" />

        {frequency !== "off" && active === "hourly" && (
          <div className="flex items-center gap-2">
            <Label htmlFor="schedule-minute">Minute past the hour</Label>
            <Input
              id="schedule-minute"
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(event) => setMinute(event.target.value)}
              aria-invalid={!minuteValid}
              aria-describedby={minuteValid ? undefined : "schedule-minute-error"}
              className="w-16"
            />
            {!minuteValid && (
              <p id="schedule-minute-error" role="alert" className="text-xs text-destructive">
                Enter a whole number from 0 to 59.
              </p>
            )}
          </div>
        )}

        {frequency !== "off" && active !== "hourly" && (
          <div className="flex items-center gap-2">
            <Label htmlFor="schedule-time">Time</Label>
            <Input id="schedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className="w-28 dark:[color-scheme:dark]" />
          </div>
        )}

        {frequency === "weekly" && (
          <SegmentedControl
            aria-label="Day of the week"
            options={WEEKDAY_OPTIONS}
            value={String(weekday)}
            onValueChange={(value) => setWeekday(Number(value))}
            className="flex w-full *:flex-1"
          />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-message">Opening message</Label>
          <Textarea
            id="schedule-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Optional. Sent before the workflow steps, e.g. context or what to report back."
            className="min-h-20"
          />
        </div>

        <dl className="flex flex-col gap-0.5 text-xs text-text-muted">
          {next !== null && (
            <div className="flex gap-1">
              <dt>Next run:</dt>
              <dd>{formatWhen(next)}</dd>
            </div>
          )}
          {schedule?.lastRunAt !== undefined && (
            <div className="flex gap-1">
              <dt>Last run:</dt>
              <dd>{formatWhen(schedule.lastRunAt)}</dd>
            </div>
          )}
          {schedule?.lastSkip && <div>Skipped: the previous run was still working</div>}
        </dl>

        <p className="text-xs text-text-muted">
          Runs only while the Sideform desktop app is open and the computer is awake. A missed run starts once when the computer wakes.
        </p>
      </div>

      <DialogFooter>
        {schedule && (
          <Button variant="outline" onClick={remove} className="sm:mr-auto">
            Remove schedule
          </Button>
        )}
        <Button onClick={save} disabled={frequency !== "off" && !timeValid}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

interface ScheduleDialogProps {
  workflowId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Sets, changes or removes the schedule of a workflow. The form starts from the stored schedule each time it opens. */
export function ScheduleDialog({ workflowId, open, onOpenChange }: ScheduleDialogProps) {
  const schedule = useWorkflowSchedule(workflowId);
  return (
    <Dialog open={open && workflowId !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {workflowId !== null && <ScheduleForm key={workflowId} workflowId={workflowId} schedule={schedule} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
