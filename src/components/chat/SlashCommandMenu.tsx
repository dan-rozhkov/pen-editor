import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  Command,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { SLASH_COMMANDS, type SlashCommand } from "./slashCommands";

interface SlashCommandMenuProps {
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

const CATEGORIES = [
  "Diagnostic",
  "Quality",
  "Intensity",
  "Adaptation",
  "Enhancement",
  "System",
] as const;

export function SlashCommandMenu({ query, onSelect, onClose }: SlashCommandMenuProps) {
  const [selectedValue, setSelectedValue] = useState(SLASH_COMMANDS[0]?.name ?? "");
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.name.includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [query]);

  // Reset selection when filter changes
  useEffect(() => {
    if (filtered.length > 0) {
      setSelectedValue(filtered[0].name);
    }
  }, [filtered]);

  const selectCommand = useCallback(
    (name: string) => {
      const cmd = SLASH_COMMANDS.find((c) => c.name === name);
      if (cmd) onSelect(cmd);
    },
    [onSelect]
  );

  // Keyboard navigation (textarea keeps focus)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = filtered.findIndex((c) => c.name === selectedValue);
        const next =
          e.key === "ArrowDown"
            ? (idx + 1) % filtered.length
            : (idx - 1 + filtered.length) % filtered.length;
        setSelectedValue(filtered[next].name);
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered.length > 0) {
          e.preventDefault();
          selectCommand(selectedValue);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [filtered, selectedValue, selectCommand, onClose]);

  // Scroll selected item into view
  useEffect(() => {
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
      </Command>
    </div>
  );
}
