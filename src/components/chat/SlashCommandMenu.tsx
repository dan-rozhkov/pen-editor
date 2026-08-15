import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  Command,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { GearIcon } from "@phosphor-icons/react";
import { SLASH_COMMANDS, YOUR_SKILLS_CATEGORY, type SlashCommand } from "./slashCommands";
import { useUserSkillStore } from "@/store/userSkillStore";

interface SlashCommandMenuProps {
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  /** Opens the "Manage skills" modal, shown as a footer row below the list.
   * Omitted in contexts that don't offer skill management (keeps the
   * previous no-footer rendering intact). */
  onManageSkills?: () => void;
}

/** Sentinel selection value for the "Manage skills" footer row, so it can
 * share the same up/down/Enter navigation model as the command list instead
 * of being reachable only by mouse. */
const MANAGE_SKILLS_VALUE = "__manage_skills__";

const CATEGORIES = [
  "Diagnostic",
  "Quality",
  "Intensity",
  "Adaptation",
  "Enhancement",
  "System",
  YOUR_SKILLS_CATEGORY,
] as const;

export function SlashCommandMenu({ query, onSelect, onClose, onManageSkills }: SlashCommandMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Enabled custom skills, merged in alongside the built-in commands under
  // their own "Your skills" category. `slashCommands.ts`'s hardcoded list
  // stays the offline fallback/category source — this only adds to it, never
  // replaces it, and a custom skill can't collide with a built-in name (the
  // backend rejects that at creation time). Dedup against the store's real
  // `GET /api/skills` catalog when it's populated, since that's the source
  // of truth; fall back to the static list (also the offline fallback) when
  // the store hasn't hydrated yet.
  const userSkills = useUserSkillStore((s) => s.skills);
  const builtInSkills = useUserSkillStore((s) => s.builtIn);
  const allCommands = useMemo<SlashCommand[]>(() => {
    const builtInNames = new Set(
      (builtInSkills.length > 0 ? builtInSkills : SLASH_COMMANDS).map((c) => c.name),
    );
    const custom: SlashCommand[] = userSkills
      .filter((skill) => skill.enabled && !builtInNames.has(skill.name))
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        category: YOUR_SKILLS_CATEGORY,
      }));
    return [...SLASH_COMMANDS, ...custom];
  }, [userSkills, builtInSkills]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter(
      (cmd) =>
        cmd.name.includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [query, allCommands]);

  // Navigable row values: every filtered command, plus the "Manage skills"
  // footer row (when offered) as the last selectable stop — so keyboard
  // users can reach it with Down/Up without ever touching the mouse.
  const navItems = useMemo<readonly string[]>(() => {
    const names = filtered.map((c) => c.name);
    return onManageSkills ? [...names, MANAGE_SKILLS_VALUE] : names;
  }, [filtered, onManageSkills]);

  // Selection is derived: a user choice only applies to the nav list it was
  // made in. When the filter changes, selection falls back to the first match
  // (same reset behavior as before, without setState-in-effect).
  const [selection, setSelection] = useState<{ list: readonly string[]; value: string } | null>(null);
  const selectedValue =
    selection && selection.list === navItems ? selection.value : navItems[0] ?? "";
  const setSelectedValue = useCallback(
    (value: string) => setSelection({ list: navItems, value }),
    [navItems]
  );

  const selectCommand = useCallback(
    (name: string) => {
      const cmd = allCommands.find((c) => c.name === name);
      if (cmd) onSelect(cmd);
    },
    [onSelect, allCommands]
  );

  // Keyboard navigation (textarea keeps focus)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = navItems.findIndex((v) => v === selectedValue);
        const next =
          e.key === "ArrowDown"
            ? (idx + 1) % navItems.length
            : (idx - 1 + navItems.length) % navItems.length;
        setSelectedValue(navItems[next]);
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (navItems.length > 0) {
          e.preventDefault();
          if (selectedValue === MANAGE_SKILLS_VALUE) {
            onManageSkills?.();
            onClose();
          } else {
            selectCommand(selectedValue);
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [navItems, selectedValue, setSelectedValue, selectCommand, onClose, onManageSkills]);

  // Scroll the selected row into view — the footer row lives outside the
  // scrollable CommandList, so it gets its own ref/branch.
  const manageSkillsRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selectedValue === MANAGE_SKILLS_VALUE) {
      manageSkillsRef.current?.scrollIntoView({ block: "nearest" });
      return;
    }
    const el = listRef.current?.querySelector(`[data-value="${selectedValue}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedValue]);

  if (filtered.length === 0) return null;

  const groupedCategories = CATEGORIES.filter((cat) =>
    filtered.some((c) => c.category === cat)
  );

  return (
    <div className="absolute bottom-full left-3 right-3 mb-2 z-50">
      <Command shouldFilter={false} className="border border-border-default rounded-lg bg-white p-0 shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
        <CommandList ref={listRef} className="py-1">
          <CommandEmpty>No commands found.</CommandEmpty>
          {groupedCategories.map((category) => (
            <CommandGroup key={category} heading={category} className="p-0 px-1 pt-2 first:pt-0 **:[[cmdk-group-heading]]:text-[10px] **:[[cmdk-group-heading]]:tracking-wide **:[[cmdk-group-heading]]:text-text-muted **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:px-2">
              {filtered
                .filter((c) => c.category === category)
                .map((cmd) => (
                  <CommandItem
                    key={cmd.name}
                    value={cmd.name}
                    data-selected={cmd.name === selectedValue || undefined}
                    onMouseEnter={() => setSelectedValue(cmd.name)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelect(cmd);
                    }}
                    onSelect={() => onSelect(cmd)}
                    className="!py-1.5 !min-h-0 !px-2 overflow-hidden"
                  >
                    <span className="font-normal text-text-primary shrink-0">/{cmd.name}</span>
                    <span className="text-text-muted truncate">{cmd.description}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
        {onManageSkills && (
          <button
            ref={manageSkillsRef}
            type="button"
            data-testid="manage-skills-row"
            data-value={MANAGE_SKILLS_VALUE}
            data-selected={selectedValue === MANAGE_SKILLS_VALUE || undefined}
            onMouseEnter={() => setSelectedValue(MANAGE_SKILLS_VALUE)}
            onMouseDown={(e) => {
              // Keep the textarea focused/behaved the same way command items
              // do, and don't let the mousedown re-open the slash menu via
              // the input's own focus handling.
              e.preventDefault();
              onManageSkills();
              onClose();
            }}
            className={`flex w-full items-center gap-1.5 border-t border-border-default px-2.5 py-1.5 text-left text-xs text-text-muted hover:bg-secondary/60 ${
              selectedValue === MANAGE_SKILLS_VALUE ? "bg-secondary/60" : ""
            }`}
          >
            <GearIcon size={13} />
            Manage skills
          </button>
        )}
      </Command>
    </div>
  );
}
