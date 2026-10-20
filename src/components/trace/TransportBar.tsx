import { CaretDownIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/IconButton";
import { BAR_ROW } from "./parts";
import { PACE_MODES, SPEEDS, type PaceMode, type Speed } from "./playback";
import { formatClock } from "./traceModel";
import { CHEVRON_WEIGHT } from "@/components/ui/chevron";

const PACE_LABEL: Record<PaceMode, string> = { realtime: "Real time", step: "Per step" };
const speedLabel = (speed: Speed): string => `${speed}×`;

interface MenuProps<T extends string> {
  /** Names the control: "Pace", "Speed". */
  title: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
}

/** A compact ghost button that opens a menu of choices; its label is the current one. */
function ChoiceMenu<T extends string>({ title, value, options, onChange }: MenuProps<T>) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="sm" aria-label={`${title}: ${current}`} className="gap-1 px-2 text-text-secondary">
            {current}
            <CaretDownIcon className="size-3" weight={CHEVRON_WEIGHT} />
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={4} className="w-auto min-w-32" aria-label={title}>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} closeOnClick>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const PACE_OPTIONS = PACE_MODES.map((value) => ({ value, label: PACE_LABEL[value] }));
const SPEED_OPTIONS = SPEEDS.map((value) => ({ value: String(value), label: speedLabel(value) }));

interface Props {
  playing: boolean;
  /** Playhead offset from the run start, and the run length, ms. */
  offset: number;
  span: number;
  speed: Speed;
  pace: PaceMode;
  onTogglePlay(): void;
  onSpeedChange(speed: Speed): void;
  onPaceChange(pace: PaceMode): void;
}

export function TransportBar({ playing, offset, span, speed, pace, onTogglePlay, onSpeedChange, onPaceChange }: Props) {
  const Icon = playing ? PauseIcon : PlayIcon;
  return (
    <div role="toolbar" aria-label="Playback" className={BAR_ROW}>
      <IconButton
        tooltip={playing ? "Pause" : "Play"}
        shortcut="Space"
        variant="secondary"
        size="icon"
        onClick={onTogglePlay}
      >
        <Icon className="size-4" weight="light" />
      </IconButton>
      <p className="px-1 text-xs tabular-nums text-text-muted" data-testid="playback-time" aria-label="Playhead time">
        <span className="text-text-secondary">{formatClock(offset)}</span> / {formatClock(span)}
      </p>
      <div className="ms-auto flex items-center gap-0.5">
        <ChoiceMenu title="Pace" value={pace} options={PACE_OPTIONS} onChange={onPaceChange} />
        <ChoiceMenu title="Speed" value={String(speed)} options={SPEED_OPTIONS} onChange={(v) => onSpeedChange(Number(v) as Speed)} />
      </div>
    </div>
  );
}
