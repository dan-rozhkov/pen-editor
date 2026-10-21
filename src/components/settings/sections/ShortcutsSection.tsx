import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { CommandGroupName, PaletteCommand } from "@/lib/commands/registry";
import { splitShortcut } from "@/lib/commands/shortcutFormat";

import { SettingsSection } from "../SettingsSection";

const GROUP_ORDER: CommandGroupName[] = ["Tools", "Edit", "View", "File", "Plugins"];

/** Read-only: every palette command that has a shortcut, grouped as the palette groups them. */
export function ShortcutsSection() {
  const [query, setQuery] = useState("");
  // The command registry drags the editor's module graph (stores, pixi) along, so it loads
  // on demand instead of sitting in the Settings chunk.
  const [commands, setCommands] = useState<PaletteCommand[] | null>(null);
  useEffect(() => {
    let live = true;
    void import("@/lib/commands/registry").then((m) => {
      if (live) setCommands(m.getCommands());
    });
    return () => {
      live = false;
    };
  }, []);
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const withKeys = (commands ?? []).filter((c) => c.shortcut && c.label.toLowerCase().includes(needle));
    return GROUP_ORDER.map((name) => ({ name, commands: withKeys.filter((c) => c.group === name) })).filter(
      (g) => g.commands.length > 0,
    );
  }, [query, commands]);

  return (
    <SettingsSection title="Keyboard shortcuts">
      <div className="py-4">
        <Input
          type="search"
          aria-label="Search shortcuts"
          placeholder="Search shortcuts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {commands === null && <p className="py-4 text-sm text-text-muted">Loading…</p>}
      {commands !== null && groups.length === 0 && <p className="py-4 text-sm text-text-muted">No shortcuts match.</p>}
      {groups.map((group) => (
        <div key={group.name} className="border-t border-border-default py-3 first:border-t-0">
          <h3 className="pb-1 text-xs font-semibold tracking-wide text-text-muted uppercase">{group.name}</h3>
          <ul>
            {group.commands.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 py-1.5 text-sm text-text-primary">
                <span className="min-w-0 truncate">{c.label}</span>
                <KbdGroup>
                  {splitShortcut(c.shortcut ?? "").map((key, i) => (
                    <Kbd key={`${key}-${i}`}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </SettingsSection>
  );
}
