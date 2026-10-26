import { cn } from "@/lib/utils";
import type { SettingsSection } from "@/lib/openSettings";

import { SETTINGS_NAV } from "./settingsSections";

/** Left column (vertical list) at md and up; a horizontally scrollable row above the content below it. */
export function SettingsNav({
  active,
  onSelect,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <div className="shrink-0 border-b border-border-default bg-surface-panel md:w-[220px] md:overflow-y-auto md:border-r md:border-b-0">
      <h1 className="px-4 pt-3 pb-1 text-base font-semibold text-text-primary md:px-5 md:pt-5 md:pb-3">Settings</h1>
      <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:overflow-visible md:pb-4">
        {SETTINGS_NAV.map(({ id, label, icon: Icon }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelect(id)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2 rounded-control-lg px-2.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-[2px] focus-visible:ring-ring",
                isActive
                  ? "bg-surface-hover font-medium text-text-primary"
                  : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
              )}
            >
              <Icon className="size-4 shrink-0" weight={isActive ? "fill" : "regular"} aria-hidden />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
