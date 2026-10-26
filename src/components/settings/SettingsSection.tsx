import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The right column for one section: large title (+ intro line, + an action at
 * the right of the title), hairline, then its groups.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="settings-section-title">
      <div className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="settings-section-title" className="text-xl font-semibold tracking-tight text-text-primary">
            {title}
          </h2>
          {action}
        </div>
        {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      </div>
      <div className="border-t border-border-default">{children}</div>
    </section>
  );
}

/**
 * One setting: title (+ one-line description), then its control. With
 * `inline` the control sits at the right of the text (switches, selects);
 * otherwise it goes underneath (cards, lists).
 */
export function SettingsGroup({
  title,
  description,
  inline,
  children,
}: {
  title: string;
  description?: ReactNode;
  inline?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="settings-group"
      className={cn(
        "border-b border-border-default py-5 last:border-b-0",
        inline ? "flex items-center justify-between gap-4" : "flex flex-col gap-3",
      )}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
      </div>
      {children != null && <div className={cn(inline && "shrink-0")}>{children}</div>}
    </div>
  );
}

/** A sub-heading inside a section (e.g. "Dev mode"). */
export function SettingsSubheading({ children }: { children: ReactNode }) {
  return <h3 className="pt-6 pb-1 text-xs font-semibold tracking-wide text-text-muted uppercase">{children}</h3>;
}
