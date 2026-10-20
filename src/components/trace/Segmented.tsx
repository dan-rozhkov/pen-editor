import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Option<T> {
  value: T;
  label: string;
}

interface Props<T> {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange(value: T): void;
  disabled?: boolean;
  /** Extra classes for every button. */
  itemClassName?: string;
}

/** A small segmented control: a group of toggle buttons, one pressed. */
export function Segmented<T extends string | number>({ label, options, value, onChange, disabled, itemClassName }: Props<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-secondary p-[3px]">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant="ghost"
          static
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn("h-6 rounded-md px-3", value === option.value && "bg-background text-foreground shadow-xs hover:bg-background dark:bg-surface-elevated", itemClassName)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
