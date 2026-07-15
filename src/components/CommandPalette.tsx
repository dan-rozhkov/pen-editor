import { useEffect } from "react";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { useCommandPaletteStore } from "@/store/commandPaletteStore";
import { useDevModeStore } from "@/store/devModeStore";
import { getCommands, commandFilter, type CommandGroupName } from "@/lib/commands/registry";
import { isTypingTarget } from "@/components/canvas/keyboardShortcutUtils";

const GROUP_ORDER: CommandGroupName[] = ["Tools", "Edit", "View", "File"];

/**
 * Global search overlay (Cmd+/ or Cmd+K) listing every tool and menu action
 * from the command registry (`@/lib/commands/registry`) — the same store
 * methods/events the toolbar, keyboard shortcuts, and context menu already
 * use, so nothing here is a second implementation of those actions.
 */
export function CommandPalette() {
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const isDevMode = useDevModeStore((s) => s.active);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey || e.repeat) return;
      if (e.code !== "Slash" && e.code !== "KeyK") return;
      // Don't hijack the shortcut while typing elsewhere — but once the palette
      // is open its own search input is a typing target, so still allow the
      // shortcut to toggle it closed (and to swallow the browser's native ⌘K).
      if (!useCommandPaletteStore.getState().open && isTypingTarget(e)) return;
      e.preventDefault();
      useCommandPaletteStore.getState().toggle();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Dev (inspect) mode is read-only — scene-mutating commands (delete, group,
  // paste, etc.) must not be reachable via ⌘K, mirroring the keyboard-shortcut
  // guard in keyboardCommands.ts. Undo/redo aren't flagged `mutatesScene` and
  // stay available (see PaletteCommand.mutatesScene doc).
  const commands = getCommands().filter((c) => !isDevMode || !c.mutatesScene);
  const groups = GROUP_ORDER.map((group) => ({
    group,
    commands: commands.filter((c) => c.group === group),
  })).filter((g) => g.commands.length > 0);

  const runCommand = (run: () => void) => {
    setOpen(false);
    run();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command filter={commandFilter}>
        <CommandInput placeholder="Search commands…" />
        <CommandList>
          <CommandEmpty>No matching commands.</CommandEmpty>
          {groups.map(({ group, commands: groupCommands }) => (
            <CommandGroup key={group} heading={group}>
              {groupCommands.map((command) => {
                const Icon = command.icon;
                return (
                  <CommandItem
                    key={command.id}
                    value={command.label}
                    keywords={command.keywords}
                    onSelect={() => runCommand(command.run)}
                  >
                    {Icon && <Icon className="size-3.5" />}
                    <span>{command.label}</span>
                    {command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
