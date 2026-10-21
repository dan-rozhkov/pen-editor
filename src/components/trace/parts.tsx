import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TABS_TRIGGER_ACTIVE_CLASS, tabsListVariants } from "@/components/ui/tabs";
import { TONE_ICON } from "./tone";
import type { Tone } from "./traceModel";

/** Toolbar row shared by the trace header, transport bar, frame bar and inspector tabs. Its 16px gutter lines up with the filmstrip, the steps and the details panel. */
export const BAR_ROW = "flex items-center gap-1 px-4 py-1.5";

/** A frame screenshot's surface: white page, hairline outline that reads in light and dark. */
export const FRAME_SURFACE = "bg-white outline outline-1 -outline-offset-1 outline-[oklch(0_0_0/0.1)] dark:outline-[oklch(1_0_0/0.1)]";

/** The tone's filled icon. `label` names it for screen readers; without one it is decorative. */
export function ToneIcon({ tone, label, className }: { tone: Tone; label?: string; className?: string }) {
  const { Icon, className: toneClass } = TONE_ICON[tone];
  return <Icon weight="fill" {...(label ? { "aria-label": label } : { "aria-hidden": true })} className={cn(toneClass, className)} />;
}

/** The run outcome (or a verdict) as a bordered chip: tone icon plus label. Extra props, such as a test id, go on the chip. */
export function OutcomeBadge({
  tone,
  label,
  size = "md",
  className,
  ...rest
}: { tone: Tone; label: string; size?: "sm" | "md" } & Omit<ComponentProps<"span">, "children">) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-panel px-2 text-xs font-medium whitespace-nowrap text-text-primary dark:bg-secondary/30",
        size === "sm" ? "h-6" : "h-7",
        className,
      )}
      {...rest}
    >
      <ToneIcon tone={tone} className="size-3.5" />
      {label}
    </span>
  );
}

const DOT_TONE: Record<"danger" | "warning", string> = { danger: "bg-destructive", warning: "bg-amber-500" };

/** A small round marker. Position, size and ring come from `className`. */
export function StatusDot({ tone, className, ...rest }: { tone: "danger" | "warning" } & ComponentProps<"span">) {
  return <span className={cn("rounded-full", DOT_TONE[tone], className)} {...rest} />;
}

/** Muted "nothing here" note: title, then an optional hint. */
export function EmptyNote({ title, hint, className }: { title: string; hint?: string; className?: string }) {
  return (
    <p className={cn("text-xs text-text-muted", className)}>
      {title}
      {hint && ` · ${hint}`}
    </p>
  );
}

/** A number next to a label. */
export function Count({ n }: { n: number }) {
  return <span className="tabular-nums text-text-muted">{n}</span>;
}

/** Small section title, optionally with a count. */
export function SectionHeading({ as: Tag = "h3", count, className, children }: { as?: "h2" | "h3"; count?: number; className?: string; children: ReactNode }) {
  return (
    <Tag className={cn("text-xs font-medium text-text-muted", className)}>
      {children}
      {count !== undefined && (
        <>
          {" "}
          <Count n={count} />
        </>
      )}
    </Tag>
  );
}

/** A selectable list row: focus ring, hover tint, selected fill. Layout classes come from the call site. */
export function RowButton({ active, className, ...rest }: { active: boolean } & Omit<ComponentProps<"button">, "type">) {
  return (
    <button
      type="button"
      data-space-plays
      aria-current={active ? "step" : undefined}
      className={cn(
        "w-full rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-accent-selection" : "enabled:hover:bg-secondary dark:enabled:hover:bg-secondary/50",
        className,
      )}
      {...rest}
    />
  );
}

/** A small pill switch between a few options (one pressed at a time). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cn(tabsListVariants(), "h-8 shrink-0")}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            // Same look as the TabsList pills in ui/tabs.tsx.
            "inline-flex h-6 items-center justify-center rounded-md border border-transparent px-2 text-xs/relaxed font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:text-foreground disabled:opacity-50",
            value === option.value && TABS_TRIGGER_ACTIVE_CLASS,
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
